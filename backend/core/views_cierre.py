"""Cierre de mes: ventas del mes con sus cobros y documentos tributarios, y la
importación del Registro de Compras y Ventas del SII.

Tres cosas distintas que nunca se dan por hechas una a partir de otra:
- venta: el pedido (no anulado) y sus líneas.
- cobro: plata recibida (Cobro). Un pedido "Pagado" sin cobros se informa.
- documento: boleta/factura emitida en el SII (DocumentoTributario). Las
  boletas se pueden emitir desde aquí con OpenFactura; las del ambiente de
  pruebas se muestran pero no cuentan.
"""
import base64
import json
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from django.core.files.base import ContentFile
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import openfactura, sii
from .contabilidad import factor_iva
from .models import (MEDIOS_PAGO, TIPOS_DTE, Cobro, ConfiguracionContable, DetallePedido,
                     DocumentoTributario, ImportacionSII, Pedido, Vendedor)
from .views_tesoreria import _decimal, _error

ZONA = ZoneInfo('America/Santiago')
TOLERANCIA = Decimal('2')
TIPOS_VENTA = {33, 34, 39, 41}
NOMBRE_TIPO = dict(TIPOS_DTE)


def _mes_param(request):
    mes = request.query_params.get('mes') or date.today().strftime('%Y-%m')
    try:
        anio, m = map(int, mes.split('-'))
        return anio, m
    except ValueError:
        return None


def _rango_mes(anio, mes):
    inicio = datetime(anio, mes, 1, tzinfo=ZONA)
    fin = datetime(anio + (mes == 12), mes % 12 + 1, 1, tzinfo=ZONA)
    return inicio, fin


def _redondo(valor):
    return Decimal(valor).quantize(Decimal('1'))


def _cobro_json(c):
    return {
        'id': c.id, 'pedido': c.pedido_id, 'fecha': c.fecha, 'monto': c.monto, 'medio': c.medio,
        'receptor': c.receptor, 'vendedor': c.vendedor_id,
        'vendedor_nombre': c.vendedor.nombre if c.vendedor else None,
        'desde_banco': c.asignacion_id is not None, 'automatico': c.automatico,
        'comprobante': c.comprobante.url if c.comprobante else None,
        'comentario': c.comentario,
        'usuario': c.usuario.username if c.usuario else None, 'creado': c.creado,
    }


def _documento_json(d):
    return {
        'id': d.id, 'tipo': d.tipo, 'tipo_nombre': NOMBRE_TIPO.get(d.tipo, str(d.tipo)), 'folio': d.folio,
        'fecha_emision': d.fecha_emision, 'pedido': d.pedido_id, 'rut_receptor': d.rut_receptor,
        'razon_social': d.razon_social, 'exento': d.exento, 'neto': d.neto, 'iva': d.iva, 'total': d.total,
        'origen': d.origen, 'ambiente': d.ambiente, 'estado_sii': d.estado_sii,
        'pdf': d.pdf.url if d.pdf else None, 'comentario': d.comentario,
        'usuario': d.usuario.username if d.usuario else None, 'creado': d.creado,
    }


def estado_cobro(total, cobrado):
    if cobrado >= total - TOLERANCIA:
        return 'pagado'
    return 'parcial' if cobrado > 0 else 'pendiente'


def estado_tributario(pedido, documentos):
    """emitido / pendiente / por_revisar, más el motivo cuando hay que revisar."""
    documentos = [d for d in documentos if d.ambiente == 'produccion']
    ventas = [d for d in documentos if d.tipo in TIPOS_VENTA]
    if not ventas:
        return 'pendiente', None
    emitido = sum((d.total for d in ventas), Decimal('0')) - sum(
        (d.total for d in documentos if d.tipo == 61), Decimal('0'))
    if abs(emitido - pedido.total) > TOLERANCIA:
        return 'por_revisar', 'El monto del documento no coincide con el pedido'
    es_factura = any(d.tipo in (33, 34) for d in ventas)
    if pedido.tipo_recibo == 'Factura' and not es_factura:
        return 'por_revisar', 'Se pidió factura y se emitió boleta'
    if pedido.tipo_recibo == 'Boleta' and es_factura:
        return 'por_revisar', 'Se pidió boleta y se emitió factura'
    return 'emitido', None


class VentasMesView(APIView):
    """GET ?mes=YYYY-MM&vendedor=<id>: una fila por pedido con sus líneas, cobros,
    documentos y estados, y el resumen del mes."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        mes = _mes_param(request)
        if not mes:
            return _error('Mes inválido, usa AAAA-MM')
        inicio, fin = _rango_mes(*mes)
        vendedor_id = request.query_params.get('vendedor')
        iva_rate = factor_iva()

        pedidos = (Pedido.objects.exclude(estado='Anulado').filter(fecha__gte=inicio, fecha__lt=fin)
                   .select_related('cliente', 'vendedor')
                   .prefetch_related(
                       Prefetch('detalles', queryset=DetallePedido.objects.exclude(estado='Cancelado')
                                .select_related('producto')),
                       Prefetch('cobros', queryset=Cobro.objects.select_related('vendedor', 'usuario')),
                       Prefetch('documentos', queryset=DocumentoTributario.objects.select_related('usuario')))
                   .order_by('fecha', 'id'))
        if vendedor_id:
            pedidos = pedidos.filter(vendedor_id=vendedor_id)

        filas = []
        r = {k: Decimal('0') for k in ('ventas_total', 'ventas_netas', 'iva_debito_teorico', 'cobrado',
                                       'saldo_pendiente', 'costo', 'margen')}
        conteo = {'cantidad': 0, 'con_documento': 0, 'sin_documento': 0, 'por_revisar': 0,
                  'pagados': 0, 'parciales': 0, 'pendientes_cobro': 0, 'pagado_sin_cobro': 0,
                  'cobros_por_confirmar': 0}
        por_vendedor = {}

        for p in pedidos:
            lineas = list(p.detalles.all())
            cobros = list(p.cobros.all())
            documentos = list(p.documentos.all())
            total = p.total
            neto = _redondo(total / iva_rate)
            costo = sum((l.total_costo for l in lineas), Decimal('0'))
            margen = neto - costo
            cobrado = sum((c.monto for c in cobros), Decimal('0'))
            est_cobro = estado_cobro(total, cobrado)
            est_trib, motivo = estado_tributario(p, documentos)

            alertas = []
            if p.estado == 'Pagado' and not cobros:
                alertas.append('Marcado Pagado sin cobro registrado')
                conteo['pagado_sin_cobro'] += 1
            if any(c.automatico for c in cobros):
                alertas.append('Cobro registrado al marcar Pagado: confirma la fecha y el medio de pago')
                conteo['cobros_por_confirmar'] += 1
            if motivo:
                alertas.append(motivo)
            if any(l.total_costo == 0 for l in lineas):
                alertas.append('Hay productos sin costo')

            r['ventas_total'] += total
            r['ventas_netas'] += neto
            r['iva_debito_teorico'] += total - neto
            r['cobrado'] += min(cobrado, total)
            r['saldo_pendiente'] += max(total - cobrado, Decimal('0'))
            r['costo'] += costo
            r['margen'] += margen
            conteo['cantidad'] += 1
            conteo[{'emitido': 'con_documento', 'pendiente': 'sin_documento', 'por_revisar': 'por_revisar'}[est_trib]] += 1
            conteo[{'pagado': 'pagados', 'parcial': 'parciales', 'pendiente': 'pendientes_cobro'}[est_cobro]] += 1

            v = por_vendedor.setdefault(p.vendedor_id, {
                'vendedor': p.vendedor_id, 'nombre': p.vendedor.nombre if p.vendedor else 'Sin vendedor',
                'ventas_total': Decimal('0'), 'cobrado': Decimal('0'), 'saldo_pendiente': Decimal('0'),
                'margen': Decimal('0'), 'cantidad': 0})
            v['ventas_total'] += total
            v['cobrado'] += min(cobrado, total)
            v['saldo_pendiente'] += max(total - cobrado, Decimal('0'))
            v['margen'] += margen
            v['cantidad'] += 1

            filas.append({
                'id': p.id, 'fecha': p.fecha.astimezone(ZONA).date(), 'estado': p.estado,
                'cliente': {'id': p.cliente_id, 'nombre': p.cliente.nombre, 'tipo': p.cliente.tipo_cliente,
                            'rut': p.cliente.rut, 'razon_social': p.cliente.razon_social},
                'vendedor': {'id': p.vendedor_id, 'nombre': p.vendedor.nombre, 'sigla': p.vendedor.sigla} if p.vendedor else None,
                'documento_requerido': p.tipo_recibo,
                'total': total, 'neto': neto, 'iva': total - neto, 'costo': costo, 'margen': margen,
                'margen_pct': _redondo(margen / neto * 100) if neto else None,
                'cobrado': cobrado, 'saldo': max(total - cobrado, Decimal('0')), 'estado_cobro': est_cobro,
                'estado_tributario': est_trib, 'alertas': alertas, 'observaciones': p.observaciones,
                'lineas': [{
                    'id': l.id, 'producto': l.producto.nombre, 'kilos': l.cantidad_kilos,
                    'unidades': l.cantidad_unidades, 'venta_por_unidad': l.producto.venta_por_unidad,
                    'precio_venta': l.precio_venta, 'total': l.total_venta, 'costo': l.total_costo,
                    'margen': _redondo(l.total_venta / iva_rate) - l.total_costo,
                } for l in lineas],
                'cobros': [_cobro_json(c) for c in cobros],
                'documentos': [_documento_json(d) for d in documentos],
            })

        # Lo emitido en el mes según los documentos (lo que va al F29), aparte
        # de la cifra teórica que sale de las ventas.
        docs_mes = DocumentoTributario.objects.filter(ambiente='produccion',
                                                      **sii.filtro_mes('fecha_emision', f'{mes[0]}-{mes[1]:02d}'))
        iva_documentos = Decimal('0')
        sin_pedido = []
        for d in docs_mes.select_related('usuario'):
            iva_documentos += -d.iva if d.tipo == 61 else d.iva
            if not d.pedido_id:
                sin_pedido.append(_documento_json(d))

        cobros_mes = Cobro.objects.filter(fecha__gte=inicio.date(), fecha__lt=fin.date())
        if vendedor_id:
            cobros_mes = cobros_mes.filter(pedido__vendedor_id=vendedor_id)
        recibido = {}
        for c in cobros_mes.select_related('vendedor'):
            clave = 'Cuenta de la empresa' if c.receptor == 'empresa' else (c.vendedor.nombre if c.vendedor else 'Sin indicar')
            recibido[clave] = recibido.get(clave, Decimal('0')) + c.monto

        config = ConfiguracionContable.actual()
        r['margen_pct'] = _redondo(r['margen'] / r['ventas_netas'] * 100) if r['ventas_netas'] else None
        return Response({
            'mes': f'{mes[0]}-{mes[1]:02d}',
            'resumen': {**r, **conteo, 'iva_debito_documentos': iva_documentos,
                        'cobros_recibidos_mes': sum(recibido.values(), Decimal('0'))},
            'recibido_por': [{'nombre': k, 'monto': v} for k, v in sorted(recibido.items())],
            'por_vendedor': sorted(por_vendedor.values(), key=lambda v: v['nombre']),
            'pedidos': filas,
            'documentos_sin_pedido': sin_pedido,
            'config': {'tasa_iva': config.tasa_iva, 'receptor_cobro': config.receptor_cobro,
                       'emision': {'habilitada': openfactura.habilitada(), 'ambiente': openfactura.ambiente()}},
        })


def _datos_cobro(data, actual=None):
    datos = {}
    if actual is None or 'monto' in data:
        datos['monto'] = _decimal(data.get('monto'), 'El monto')
        if datos['monto'] <= 0:
            raise ValueError('El monto debe ser mayor a 0')
    if actual is None or 'fecha' in data:
        from .cartola import parse_fecha
        datos['fecha'] = parse_fecha(data.get('fecha')) or date.today()
    if 'medio' in data:
        if data['medio'] not in dict(MEDIOS_PAGO):
            raise ValueError('Medio de pago inválido')
        datos['medio'] = data['medio']
    if 'receptor' in data:
        if data['receptor'] not in ('vendedor', 'empresa'):
            raise ValueError('Receptor inválido')
        datos['receptor'] = data['receptor']
    if 'vendedor' in data:
        datos['vendedor'] = Vendedor.objects.filter(pk=data['vendedor']).first() if data['vendedor'] else None
    if 'comentario' in data:
        datos['comentario'] = data.get('comentario') or ''
    return datos


class CobroListView(APIView):
    """POST: registra un cobro. Si no se indica quién recibió la plata, va al
    receptor configurado (hoy el vendedor del pedido)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        pedido = Pedido.objects.filter(pk=request.data.get('pedido')).select_related('vendedor').first()
        if not pedido or pedido.estado == 'Anulado':
            return _error('Pedido no encontrado o anulado')
        try:
            datos = _datos_cobro(request.data)
        except ValueError as e:
            return _error(str(e))
        config = ConfiguracionContable.actual()
        datos.setdefault('receptor', config.receptor_cobro)
        if datos['receptor'] == 'vendedor':
            datos.setdefault('vendedor', pedido.vendedor)
        else:
            datos['vendedor'] = None
        with transaction.atomic():
            cobro = Cobro.objects.create(pedido=pedido, usuario=request.user,
                                         comprobante=request.FILES.get('comprobante'), **datos)
            if str(request.data.get('marcar_pagado')).lower() in ('true', '1'):
                cobrado = sum((c.monto for c in pedido.cobros.all()), Decimal('0'))
                if cobrado >= pedido.total - TOLERANCIA and pedido.estado != 'Pagado':
                    pedido.estado = 'Pagado'
                    pedido.save(update_fields=['estado'])
        return Response(_cobro_json(cobro), status=status.HTTP_201_CREATED)


class CobroDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        cobro = Cobro.objects.filter(pk=pk).first()
        if not cobro:
            return _error('Cobro no encontrado', status.HTTP_404_NOT_FOUND)
        if cobro.asignacion_id and {'monto', 'fecha'} & set(request.data):
            return _error('Este cobro viene de la cartola: el monto y la fecha se cambian desde Tesorería')
        try:
            datos = _datos_cobro(request.data, actual=cobro)
        except ValueError as e:
            return _error(str(e))
        if datos.get('receptor') == 'empresa':
            datos['vendedor'] = None
        elif datos.get('receptor') == 'vendedor' and 'vendedor' not in datos and not cobro.vendedor_id:
            datos['vendedor'] = cobro.pedido.vendedor
        for k, v in datos.items():
            setattr(cobro, k, v)
        # Revisarlo lo confirma: deja de ajustarse solo con el pedido.
        if cobro.automatico:
            cobro.automatico = False
            if cobro.comentario.startswith(('Registrado al marcar', 'El pedido ya estaba Pagado')):
                cobro.comentario = ''
        if request.FILES.get('comprobante'):
            cobro.comprobante = request.FILES['comprobante']
        cobro.save()
        return Response(_cobro_json(cobro))

    def delete(self, request, pk):
        cobro = Cobro.objects.filter(pk=pk).first()
        if not cobro:
            return _error('Cobro no encontrado', status.HTTP_404_NOT_FOUND)
        if cobro.asignacion_id:
            return _error('Este cobro viene de la cartola: quita la asociación desde Tesorería')
        if cobro.automatico:
            return _error('Este cobro se registró al marcar el pedido Pagado. Corrígelo, o cambia el estado del pedido si no está pagado')
        cobro.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _datos_documento(data, actual=None):
    datos = {}
    if actual is None:
        try:
            datos['tipo'] = int(data.get('tipo'))
            datos['folio'] = int(data.get('folio'))
        except (TypeError, ValueError):
            raise ValueError('Tipo y folio son obligatorios')
        if datos['tipo'] not in NOMBRE_TIPO:
            raise ValueError('Tipo de documento inválido')
        if datos['folio'] <= 0:
            raise ValueError('Folio inválido')
    # Lo que viene del SII no se edita a mano (fecha y montos); solo el pedido
    # asociado y el comentario.
    editable_montos = actual is None or actual.origen == 'manual'
    if editable_montos and (actual is None or 'fecha_emision' in data):
        from .cartola import parse_fecha
        fecha = parse_fecha(data.get('fecha_emision'))
        if not fecha:
            raise ValueError('Indica la fecha real de emisión')
        if fecha > date.today():
            raise ValueError('La fecha de emisión no puede ser futura')
        datos['fecha_emision'] = fecha
    if editable_montos and (actual is None or 'total' in data):
        datos['total'] = _decimal(data.get('total'), 'El total')
        tipo = datos.get('tipo', actual.tipo if actual else None)
        if tipo in (34, 41):
            datos['exento'], datos['neto'], datos['iva'] = datos['total'], Decimal('0'), Decimal('0')
        else:
            datos['neto'] = _redondo(datos['total'] / factor_iva())
            datos['iva'] = datos['total'] - datos['neto']
    if 'pedido' in data:
        datos['pedido'] = Pedido.objects.filter(pk=data['pedido']).first() if data['pedido'] else None
    for campo in ('rut_receptor', 'razon_social', 'comentario'):
        if campo in data and (editable_montos or campo == 'comentario'):
            datos[campo] = data.get(campo) or ''
    return datos


class DocumentoListView(APIView):
    """GET ?mes=YYYY-MM&sin_pedido=1 / POST: registra un documento emitido."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        docs = DocumentoTributario.objects.select_related('usuario')
        mes = request.query_params.get('mes')
        if mes:
            docs = docs.filter(**sii.filtro_mes('fecha_emision', mes))
        if request.query_params.get('sin_pedido'):
            docs = docs.filter(pedido__isnull=True)
        return Response([_documento_json(d) for d in docs[:500]])

    def post(self, request):
        try:
            datos = _datos_documento(request.data)
        except ValueError as e:
            return _error(str(e))
        pedido = datos.get('pedido')
        if pedido and not datos.get('rut_receptor'):
            datos['rut_receptor'] = pedido.cliente.rut
            datos['razon_social'] = pedido.cliente.razon_social or pedido.cliente.nombre
        try:
            doc = DocumentoTributario.objects.create(usuario=request.user, origen='manual', **datos)
        except IntegrityError:
            return _error(f"Ya existe {NOMBRE_TIPO[datos['tipo']].lower()} folio {datos['folio']}")
        return Response(_documento_json(doc), status=status.HTTP_201_CREATED)


class DocumentoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        doc = DocumentoTributario.objects.filter(pk=pk).first()
        if not doc:
            return _error('Documento no encontrado', status.HTTP_404_NOT_FOUND)
        try:
            datos = _datos_documento(request.data, actual=doc)
        except ValueError as e:
            return _error(str(e))
        for k, v in datos.items():
            setattr(doc, k, v)
        doc.save()
        return Response(_documento_json(doc))

    def delete(self, request, pk):
        doc = DocumentoTributario.objects.filter(pk=pk).first()
        if not doc:
            return _error('Documento no encontrado', status.HTTP_404_NOT_FOUND)
        if doc.origen == 'sii':
            return _error('Este documento viene del SII; no se puede borrar, solo desasociar del pedido')
        if doc.origen == 'openfactura' and doc.ambiente == 'produccion':
            return _error('Esta boleta ya fue emitida en el SII; para anularla hay que emitir una nota de crédito')
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _importacion_json(i):
    return {'id': i.id, 'nombre_archivo': i.nombre_archivo, 'tipo': i.tipo, 'mes': i.mes, 'filas': i.filas,
            'nuevos': i.nuevos, 'actualizados': i.actualizados, 'resultado': i.resultado,
            'usuario': i.usuario.username if i.usuario else None, 'subida': i.subida}


class ImportacionSIIView(APIView):
    """GET: importaciones anteriores. POST multipart 'archivo': un CSV del RCV
    (detalle de ventas, detalle de compras o resumen)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([_importacion_json(i) for i in ImportacionSII.objects.select_related('usuario')[:50]])

    def post(self, request):
        archivo = request.FILES.get('archivo')
        if not archivo:
            return _error('Sube el archivo CSV descargado del SII')
        try:
            datos = sii.leer_rcv(archivo.read(), archivo.name)
        except ValueError as e:
            return _error(str(e))
        mes = request.data.get('mes') or datos['mes']
        if not datos['filas']:
            return _error('El archivo no trae documentos')
        if datos['tipo'] == 'resumen' and not mes:
            return _error('Indica el mes del resumen')

        with transaction.atomic():
            importacion = ImportacionSII.objects.create(
                nombre_archivo=archivo.name, tipo=datos['tipo'], mes=mes, filas=len(datos['filas']),
                usuario=request.user)
            if datos['tipo'] == 'ventas':
                resultado = sii.importar_ventas(datos['filas'], importacion, request.user)
                importacion.nuevos, importacion.actualizados = resultado['nuevos'], resultado['actualizados']
            elif datos['tipo'] == 'compras':
                resultado = sii.cruzar_compras(datos['filas'], mes)
            else:
                resultado = sii.resumen_boletas(datos['filas'], mes)
            importacion.resultado = json.loads(json.dumps(resultado, cls=DjangoJSONEncoder))
            importacion.save()
        return Response(_importacion_json(importacion), status=status.HTTP_201_CREATED)


def _rut_sii(rut):
    """'76.123.456-7' -> '76123456-7' (formato que espera el SII)."""
    limpio = sii.normalizar_rut(rut)
    return f'{limpio[:-1]}-{limpio[-1]}' if len(limpio) > 1 else ''


def dte_boleta(pedido, iva_rate):
    """Arma la boleta (DTE 39) de un pedido. Cada producto va como una línea de
    cantidad 1 con su monto final, y el peso en el nombre: así el monto de cada
    línea es exactamente lo que se cobró (precio por kilo y descuentos ya
    aplicados), sin diferencias de redondeo."""
    lineas = [l for l in pedido.detalles.all() if l.estado != 'Cancelado']
    if not lineas:
        raise ValueError('El pedido no tiene productos')
    detalle = []
    for i, l in enumerate(lineas, start=1):
        monto = int(Decimal(l.total_venta).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if monto <= 0:
            raise ValueError(f'"{l.producto.nombre}" no tiene monto: pesa el producto antes de emitir')
        cantidad = (f'{int(l.cantidad_unidades)} u.' if l.producto.venta_por_unidad and l.cantidad_unidades
                    else f'{Decimal(l.cantidad_kilos).normalize():f} kg'.replace('.', ','))
        detalle.append({'NroLinDet': i, 'NmbItem': f'{l.producto.nombre} ({cantidad})'[:80],
                        'QtyItem': 1, 'PrcItem': monto, 'MontoItem': monto})
    total = sum(d['MontoItem'] for d in detalle)
    if abs(total - pedido.total) > TOLERANCIA:
        raise ValueError(f'Las líneas suman {total} y el pedido dice {pedido.total:.0f}; revisa el pedido')
    neto = int((Decimal(total) / iva_rate).quantize(Decimal('1'), rounding=ROUND_HALF_UP))

    rut = _rut_sii(pedido.cliente.rut)
    receptor = {'RUTRecep': rut or '66666666-6'}
    if rut and (pedido.cliente.razon_social or pedido.cliente.nombre):
        receptor['RznSocRecep'] = (pedido.cliente.razon_social or pedido.cliente.nombre)[:100]
    return {
        'Encabezado': {
            # IndServicio 3: boleta de ventas y servicios.
            'IdDoc': {'TipoDTE': 39, 'Folio': 0, 'FchEmis': date.today().isoformat(), 'IndServicio': 3},
            'Emisor': openfactura.emisor_boleta(),
            'Receptor': receptor,
            'Totales': {'MntNeto': neto, 'IVA': total - neto, 'MntTotal': total},
        },
        'Detalle': detalle,
    }


class EmitirBoletaView(APIView):
    """POST: emite la boleta electrónica del pedido en OpenFactura y la registra
    como documento con su PDF. Un pedido emite una sola boleta: la clave de
    idempotencia hace que un reintento devuelva la misma en vez de otra."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not openfactura.habilitada():
            return _error('La emisión de boletas no está configurada (falta OPENFACTURA_API_KEY)')
        pedido = (Pedido.objects.filter(pk=pk).select_related('cliente')
                  .prefetch_related(Prefetch('detalles', queryset=DetallePedido.objects.select_related('producto')))
                  .first())
        if not pedido or pedido.estado == 'Anulado':
            return _error('Pedido no encontrado o anulado', status.HTTP_404_NOT_FOUND)
        if pedido.estado not in ('Preparado', 'Pagado'):
            return _error('Solo se emite la boleta de un pedido Preparado o Pagado (con todo pesado)')
        ambiente = openfactura.ambiente()
        previos = pedido.documentos.filter(tipo__in=TIPOS_VENTA, ambiente=ambiente)
        if previos.exists():
            d = previos.first()
            return _error(f'El pedido ya tiene {NOMBRE_TIPO[d.tipo].lower()} N° {d.folio}')
        try:
            dte = dte_boleta(pedido, factor_iva())
            clave = f'meatme-{pedido.pk}-{int(pedido.fecha.timestamp())}-39'
            r = openfactura.emitir(dte, clave)
        except ValueError as e:
            return _error(str(e))
        except openfactura.OpenFacturaError as e:
            return _error(f'OpenFactura: {e}', status.HTTP_502_BAD_GATEWAY)

        totales = dte['Encabezado']['Totales']
        doc = DocumentoTributario(
            tipo=39, folio=r['folio'], fecha_emision=date.fromisoformat(dte['Encabezado']['IdDoc']['FchEmis']),
            pedido=pedido, rut_receptor=dte['Encabezado']['Receptor']['RUTRecep'],
            razon_social=dte['Encabezado']['Receptor'].get('RznSocRecep', ''),
            neto=totales['MntNeto'], iva=totales['IVA'], total=totales['MntTotal'],
            origen='openfactura', ambiente=ambiente, token=r['token'], usuario=request.user,
            comentario='; '.join(f'{k}: {v}' for w in r['advertencias'] for k, v in w.items()),
        )
        if r['pdf']:
            doc.pdf.save(f'boleta-{r["folio"]}.pdf', ContentFile(base64.b64decode(r['pdf'])), save=False)
        try:
            doc.estado_sii = openfactura.estado(r['token'])
        except openfactura.OpenFacturaError:
            pass  # se puede consultar después
        try:
            doc.save()
        except IntegrityError:
            # Ya estaba registrada (reintento que recuperó el mismo folio).
            doc = DocumentoTributario.objects.get(tipo=39, folio=r['folio'], ambiente=ambiente)
        return Response(_documento_json(doc), status=status.HTTP_201_CREATED)


class EstadoDocumentoView(APIView):
    """POST: consulta en OpenFactura el estado del documento ante el SII."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        doc = DocumentoTributario.objects.filter(pk=pk, origen='openfactura').first()
        if not doc:
            return _error('Documento no encontrado', status.HTTP_404_NOT_FOUND)
        try:
            doc.estado_sii = openfactura.estado(doc.token)
        except openfactura.OpenFacturaError as e:
            return _error(f'OpenFactura: {e}', status.HTTP_502_BAD_GATEWAY)
        doc.save(update_fields=['estado_sii'])
        return Response(_documento_json(doc))
