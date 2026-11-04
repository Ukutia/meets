"""Conciliación sobre DocumentoTributario, Pedido, Factura, Gasto y NotaCredito.

Fuentes y límites tributarios documentados en docs/conciliacion-sii.md.
"""
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (CierreTributario, ConfiguracionContable, DocumentoTributario,
                     Factura, Gasto, HistorialConciliacion, ImportacionSII, NotaCredito, Pedido)
from .sii import COLUMNAS, TOLERANCIA, _monto, _norm, json_seguro, normalizar_rut, validar_mes

CERO = Decimal('0')
ZONA = ZoneInfo('America/Santiago')
VINCULOS = ('pedido', 'factura', 'gasto', 'nota_compra')


def pesos(valor):
    return Decimal(valor).quantize(Decimal('1'), rounding=ROUND_HALF_UP)


def instantanea(doc):
    datos = {c: getattr(doc, c) for c in (
        'tipo', 'folio', 'rut_emisor', 'rut_receptor', 'fecha_emision', 'periodo_tributario',
        'estado_sii', 'estado_conciliacion', 'credito_validado', 'anticipo_validado', 'justificacion')}
    datos.update({c: str(Decimal(getattr(doc, c)).quantize(Decimal('.01'))) for c in
                  ('neto', 'iva', 'total', 'exento', 'anticipo', 'otros_impuestos', 'iva_no_recuperable', 'iva_uso_comun')})
    datos.update({c: getattr(doc, c + '_id') for c in VINCULOS})
    campo, obj = registro(doc)
    datos['registro_fecha_comercial'] = fecha_comercial(obj) if obj else None
    datos['registro_fecha_entrega'] = obj.fecha_entrega if campo == 'pedido' else None
    datos['registro_estado'] = obj.estado if campo == 'pedido' else None
    datos['diferencias'] = diferencias(doc)
    return json_seguro(datos)


def auditar(doc, accion, antes, usuario):
    HistorialConciliacion.objects.create(documento=doc, accion=accion, antes=antes,
                                        despues=instantanea(doc), usuario=usuario)


def registro(doc):
    for campo in VINCULOS:
        obj = getattr(doc, campo)
        if obj:
            return campo, obj
    return None, None


def fecha_comercial(obj):
    return obj.fecha.astimezone(ZONA).date() if isinstance(obj, Pedido) else obj.fecha


def diferencias(doc):
    campo, obj = registro(doc)
    resultado = {'monto': None, 'dias': None, 'periodo': False, 'motivos': []}
    if obj:
        fecha = fecha_comercial(obj)
        resultado.update(monto=doc.total - obj.total, dias=(doc.fecha_emision - fecha).days,
                         periodo=doc.fecha_emision.strftime('%Y-%m') != fecha.strftime('%Y-%m'))
        if abs(resultado['monto']) > TOLERANCIA:
            resultado['motivos'].append('Total distinto')
        if resultado['dias']:
            resultado['motivos'].append('Fecha comercial distinta de emisión')
        if isinstance(obj, Factura):
            for campo_interno, campo_doc in [('subtotal', 'neto'), ('iva', 'iva'), ('anticipo_iva', 'anticipo'), ('otros_impuestos', 'otros_impuestos'), ('exento', 'exento')]:
                if abs(getattr(obj, campo_interno) - getattr(doc, campo_doc)) > TOLERANCIA:
                    resultado['motivos'].append(f'{campo_doc} distinto')
        elif isinstance(obj, (Gasto, NotaCredito)):
            for campo in ('neto', 'iva'):
                if abs(getattr(obj, campo) - getattr(doc, campo)) > TOLERANCIA:
                    resultado['motivos'].append(f'{campo} distinto')
        if isinstance(obj, Pedido) and obj.estado == 'Anulado':
            resultado['motivos'].append('Pedido anulado después del vínculo')
        if isinstance(obj, Factura) and normalizar_rut(obj.proveedor.rut) != normalizar_rut(doc.rut_emisor):
            resultado['motivos'].append('RUT proveedor distinto')
        if isinstance(obj, Factura) and obj.tipo_documento != doc.tipo:
            resultado['motivos'].append('Tipo DTE de compra distinto')
    suma = doc.neto + doc.exento + doc.iva + doc.anticipo + doc.otros_impuestos + doc.iva_no_recuperable + doc.iva_uso_comun
    if abs(doc.total - suma) > TOLERANCIA:
        resultado['motivos'].append('Total no cuadra con desglose tributario; revisar retenciones/base')
    if columnas_pendientes(doc):
        resultado['motivos'].append('Columnas monetarias sin tratamiento validado')
    return resultado


def columnas_pendientes(doc):
    conocidas = {n for nombres in COLUMNAS.values() for n in nombres}
    pendientes = []
    for nombre, valor in doc.datos_originales.items():
        normal = _norm(nombre)
        if normal in conocidas or not any(p in normal for p in ('monto', 'impuesto', 'retenido')):
            continue
        try:
            if _monto(valor):
                pendientes.append(nombre)
        except ValueError:
            pendientes.append(nombre)
    return pendientes


def coincidencia_exacta(doc, usuario):
    """Solo folio + RUT proveedor + tipo; jamás monto como identificación."""
    if doc.operacion != 'compras' or doc.tipo not in (33, 34, 61):
        return 0
    if doc.tipo == 61:
        opciones = [('nota_compra', n) for n in NotaCredito.objects.filter(numero=str(doc.folio)).select_related('factura__proveedor')
                    if normalizar_rut(n.factura.proveedor.rut) == normalizar_rut(doc.rut_emisor)]
    else:
        opciones = [('factura', f) for f in Factura.objects.filter(numero_factura=str(doc.folio)).select_related('proveedor')
                    if f.proveedor.rut and normalizar_rut(f.proveedor.rut) == normalizar_rut(doc.rut_emisor)
                    and doc.tipo == f.tipo_documento]
    if len(opciones) != 1:
        doc.estado_conciliacion = 'sin_coincidencia'
        doc.save(update_fields=['estado_conciliacion'])
        return 0
    campo, obj = opciones[0]
    if DocumentoTributario.objects.filter(**{campo: obj}, operacion='compras', ambiente='produccion').exclude(pk=doc.pk).exists():
        return 0
    setattr(doc, campo, obj)
    doc.estado_conciliacion = 'por_revisar' if diferencias(doc)['motivos'] else 'conciliado'
    doc.conciliado_por, doc.conciliado_el = usuario, timezone.now()
    doc.save()
    return 1


def candidato_json(campo, obj, doc):
    nombre = (obj.cliente.razon_social or obj.cliente.nombre) if campo == 'pedido' else (
        obj.proveedor.nombre if campo == 'factura' else obj.descripcion if campo == 'gasto' else obj.factura.proveedor.nombre)
    return {'registro_tipo': campo, 'registro_id': obj.pk, 'nombre': nombre,
            'fecha': fecha_comercial(obj), 'fecha_entrega': obj.fecha_entrega if campo == 'pedido' else None,
            'total': obj.total, 'diferencia': doc.total - obj.total}


def candidatos(doc):
    desde, hasta = doc.fecha_emision - timedelta(days=60), doc.fecha_emision + timedelta(days=60)
    opciones = []
    if doc.operacion == 'ventas':
        qs = Pedido.objects.exclude(estado='Anulado').filter(fecha__date__range=(desde, hasta)).select_related('cliente')
        contraparte = normalizar_rut(doc.rut_receptor)
        nombre = _norm(doc.razon_social)
        for p in qs:
            rut = contraparte and contraparte == normalizar_rut(p.cliente.rut)
            alias = nombre and nombre in {_norm(p.cliente.nombre), _norm(p.cliente.razon_social), _norm(p.cliente.contacto)}
            monto = abs(p.total - doc.total) <= TOLERANCIA
            if rut or alias or monto:
                opciones.append({**candidato_json('pedido', p, doc),
                                 'motivos': [x for ok, x in [(rut, 'RUT'), (alias, 'Nombre/razón social'), (monto, 'Monto')] if ok]})
    else:
        for f in Factura.objects.filter(Q(fecha__range=(desde, hasta)) | Q(numero_factura=str(doc.folio))).select_related('proveedor') if doc.tipo in (33, 34, 46) else []:
            rut = normalizar_rut(f.proveedor.rut) == normalizar_rut(doc.rut_emisor)
            alias = _norm(f.proveedor.nombre) == _norm(doc.razon_social)
            monto = abs(f.total - doc.total) <= TOLERANCIA
            if rut or alias or monto or f.numero_factura == str(doc.folio):
                opciones.append({**candidato_json('factura', f, doc), 'motivos': ['Proveedor/folio/fecha/monto: validar']})
        for g in Gasto.objects.filter(fecha__range=(desde, hasta), total__gte=doc.total - TOLERANCIA, total__lte=doc.total + TOLERANCIA):
            opciones.append({**candidato_json('gasto', g, doc), 'motivos': ['Monto: validar proveedor y documento']})
        if doc.tipo == 61:
            for n in NotaCredito.objects.filter(numero=str(doc.folio)).select_related('factura__proveedor'):
                opciones.append({**candidato_json('nota_compra', n, doc), 'motivos': ['Folio: validar emisor']})
    opciones.sort(key=lambda c: (abs(c['diferencia']), str(c['registro_id'])))
    return opciones[:30]


@transaction.atomic
def vincular(doc_id, data, usuario):
    doc = DocumentoTributario.objects.select_for_update().get(pk=doc_id)
    antes = instantanea(doc)
    motivo = str(data.get('justificacion') or '').strip()
    if not motivo:
        raise ValueError('Registra una justificación para conservar la trazabilidad')
    if 'registro_tipo' in data:
        campo = data['registro_tipo']
        for c in VINCULOS:
            setattr(doc, c, None)
        if campo:
            modelos = {'pedido': Pedido, 'factura': Factura, 'gasto': Gasto, 'nota_compra': NotaCredito}
            if campo not in modelos or (campo == 'pedido') != (doc.operacion == 'ventas'):
                raise ValueError('Tipo de registro incompatible con la operación')
            if campo == 'nota_compra' and doc.tipo != 61:
                raise ValueError('Solo una nota de crédito puede vincularse con nota de compra')
            if campo == 'factura' and doc.tipo not in (33, 34, 46):
                raise ValueError('Tipo DTE incompatible con factura de compra')
            obj = modelos[campo].objects.select_for_update().filter(pk=data.get('registro_id')).first()
            if not obj or (campo == 'pedido' and obj.estado == 'Anulado'):
                raise ValueError('Registro interno no encontrado o anulado')
            if doc.tipo in (33, 34, 39, 41, 46) and DocumentoTributario.objects.filter(
                    **{campo: obj}, operacion=doc.operacion, ambiente=doc.ambiente,
                    tipo__in=(33, 34, 39, 41, 46)).exclude(pk=doc.pk).exists():
                raise ValueError('El registro ya tiene un documento de venta/compra; revisa antes de duplicar el respaldo')
            setattr(doc, campo, obj)
    for campo in ('credito_validado', 'anticipo_validado'):
        if campo in data:
            if not isinstance(data[campo], bool):
                raise ValueError(f'{campo} debe ser verdadero o falso')
            if data[campo] and (doc.operacion != 'compras' or doc.estado_sii != 'registrado'):
                raise ValueError('No se puede utilizar crédito ni anticipo de un documento pendiente/reclamado')
            setattr(doc, campo, data[campo])
    doc.justificacion = motivo
    doc.estado_conciliacion = 'conciliado' if registro(doc)[1] else 'sin_coincidencia'
    doc.conciliado_por, doc.conciliado_el = usuario, timezone.now()
    doc.save()
    auditar(doc, 'revisar' if registro(doc)[1] else 'desvincular', antes, usuario)
    return doc


def fila_documento(doc):
    campo, obj = registro(doc)
    dif = diferencias(doc)
    estado = doc.estado_conciliacion
    # Una diferencia no justificada o un cambio interno posterior vuelve a requerir revisión.
    ultimo = doc.historial_conciliacion.first()
    if estado == 'conciliado' and ultimo:
        actual = instantanea(doc)
        if any(ultimo.despues.get(c) != actual.get(c) for c in
               ('diferencias', 'registro_fecha_comercial', 'registro_fecha_entrega', 'registro_estado')):
            estado = 'por_revisar'
    return {**instantanea(doc), 'id': doc.pk, 'operacion': doc.operacion,
            'diferencias': dif,
            'columnas_pendientes': columnas_pendientes(doc),
            'datos_originales': doc.datos_originales,
            'razon_social': doc.razon_social, 'origen': doc.origen,
            'registro_tipo': campo, 'registro_id': obj.pk if obj else None,
            'monto_plataforma': obj.total if obj else None,
            'total_pagadero_plataforma': obj.monto_pagadero() if campo == 'factura' else None,
            'fecha_comercial': fecha_comercial(obj) if obj else None,
            'fecha_entrega': obj.fecha_entrega if campo == 'pedido' else None,
            'estado_conciliacion': estado, 'conciliado_por': doc.conciliado_por.username if doc.conciliado_por else None,
            'conciliado_el': doc.conciliado_el, 'actualizado': doc.actualizado,
            'datos_actualizados_al': doc.importacion.datos_actualizados_al if doc.importacion else None}


def ventas_declaradas(mes):
    """Débitos de los pedidos marcados como declarados en el mes (cierre de
    ventas). Cada pedido aporta sus documentos de venta de producción; si aún no
    tiene, su IVA teórico según el documento pedido (factura o boleta)."""
    from .contabilidad import factor_iva
    iva_rate = factor_iva()
    pedidos = (Pedido.objects.exclude(estado='Anulado')
               .filter(mes_declaracion=date.fromisoformat(mes + '-01'), declarado=True)
               .prefetch_related('documentos'))
    lineas, sin_documento, ids = [], [], set()
    for p in pedidos:
        ids.add(p.pk)
        docs = [d for d in p.documentos.all() if d.ambiente == 'produccion' and d.operacion == 'ventas'
                and d.tipo in (33, 34, 39, 41, 56, 61)]
        if docs:
            lineas += [SimpleNamespace(tipo=d.tipo, iva=d.iva, neto=d.neto + d.exento) for d in docs]
        else:
            neto = pesos(p.total / iva_rate)
            lineas.append(SimpleNamespace(tipo=33 if p.tipo_recibo == 'Factura' else 39, iva=p.total - neto, neto=neto))
            sin_documento.append(p.pk)
    return lineas, sin_documento, ids


def compras_internas(mes):
    """Facturas de compra, notas de crédito y gastos con factura ingresados en la
    plataforma en el mes, que aún no tienen un documento del RCV vinculado (los
    que sí lo tienen ya se cuentan por el RCV)."""
    anio, m = int(mes[:4]), int(mes[5:])
    mismo_mes = {'fecha__year': anio, 'fecha__month': m}
    docs = []
    for f in Factura.objects.filter(**mismo_mes).exclude(documentos_sii__operacion='compras'):
        docs.append(SimpleNamespace(tipo=f.tipo_documento, iva=f.iva, neto=f.subtotal, exento=f.exento, anticipo=f.anticipo_iva,
                                    credito_validado=True, anticipo_validado=True, interno=True))
    for n in NotaCredito.objects.filter(**mismo_mes).exclude(documentos_sii__operacion='compras'):
        docs.append(SimpleNamespace(tipo=61, iva=n.iva, neto=n.neto, exento=CERO, anticipo=CERO,
                                    credito_validado=True, anticipo_validado=True, interno=True))
    for g in Gasto.objects.filter(con_factura=True, **mismo_mes).exclude(documentos_sii__operacion='compras'):
        docs.append(SimpleNamespace(tipo=33, iva=g.iva, neto=g.neto, exento=CERO, anticipo=CERO,
                                    credito_validado=True, anticipo_validado=True, interno=True))
    for d in docs:
        d.estado_sii = 'registrado'
    return docs


def propuesta_f29(mes, ventas_mes, compras, cierre, config):
    """Propuesta F29 con los códigos del formulario. Los débitos salen solo de los
    pedidos declarados en el cierre de ventas del mes; los créditos y el anticipo,
    de las compras registradas en el RCV del período, como en la propuesta del SII.
    La estimación validada es f29_estimado."""
    def linea(docs, tipos, campo='iva'):
        sel = [d for d in docs if d.tipo in tipos]
        return len(sel), pesos(sum((getattr(d, campo) for d in sel), CERO))

    ventas, sin_documento, declarados = ventas_declaradas(mes)
    # Documentos de venta del período que no son de un pedido declarado este mes.
    fuera = [d for d in ventas_mes if d.pedido_id not in declarados]
    internas = compras_internas(mes)
    registradas = [d for d in compras if d.estado_sii == 'registrado'] + internas
    n_fact, d_fact = linea(ventas, (33, 34))
    n_bol, d_bol = linea(ventas, (39, 41))
    n_nd, d_nd = linea(ventas, (56,))
    n_nc, d_nc = linea(ventas, (61,))
    debitos = d_fact + d_bol + d_nd - d_nc

    con_credito = [d for d in registradas if d.credito_validado]
    n_rec, c_fact = linea(con_credito, (33, 46))
    n_ndr, c_nd = linea(con_credito, (56,))
    n_ncr, c_nc = linea(con_credito, (61,))
    remanente = pesos(cierre.remanente_anterior or CERO)
    creditos = remanente + c_fact + c_nd - c_nc
    signo = lambda d: -1 if d.tipo == 61 else 1
    exentas = pesos(sum((signo(d) * d.exento for d in registradas), CERO))

    iva = max(debitos - creditos, CERO)
    signo_neto = sum((signo(d) * d.neto for d in ventas), CERO)
    base_ppm = cierre.base_ppm if cierre.base_ppm is not None else signo_neto
    tasa = cierre.tasa_ppm if cierre.tasa_ppm is not None else config.tasa_ppm
    ppm = pesos(max(base_ppm, CERO) * Decimal(str(tasa)) / 100)
    anticipo = pesos(sum((signo(d) * d.anticipo for d in registradas), CERO))
    anticipo_sin_validar = pesos(sum((signo(d) * d.anticipo for d in registradas if not d.anticipo_validado), CERO))
    total_anticipo = anticipo + pesos(cierre.remanente_anticipo_anterior or CERO)
    imputado = min(max(total_anticipo, CERO), iva)
    otros, retenciones = pesos(cierre.otros_impuestos), pesos(cierre.retenciones)
    determinado = iva + ppm - imputado + otros - retenciones
    return {
        'debitos': {'facturas': {'cantidad': n_fact, 'monto': d_fact}, 'boletas': {'cantidad': n_bol, 'monto': d_bol},
                    'notas_debito': {'cantidad': n_nd, 'monto': d_nd}, 'notas_credito': {'cantidad': n_nc, 'monto': d_nc},
                    'total': debitos, 'pedidos_declarados': len(declarados),
                    'pedidos_sin_documento': sin_documento,
                    'documentos_no_declarados': {'cantidad': len(fuera), 'iva': pesos(sum((signo(d) * d.iva for d in fuera), CERO))}},
        'creditos': {'con_derecho': c_fact + c_nd - c_nc, 'exentas': exentas, 'remanente_anterior': remanente,
                     'facturas': {'cantidad': n_rec, 'monto': c_fact}, 'notas_debito': {'cantidad': n_ndr, 'monto': c_nd},
                     'notas_credito': {'cantidad': n_ncr, 'monto': c_nc}, 'total': creditos},
        'iva_determinado': iva, 'remanente_siguiente': max(creditos - debitos, CERO),
        'ppm': {'base': pesos(base_ppm), 'tasa': tasa, 'tasa_confirmada': cierre.tasa_ppm is not None, 'monto': ppm},
        'anticipo': {'periodo': anticipo, 'sin_validar': anticipo_sin_validar,
                     'remanente_anterior': pesos(cierre.remanente_anticipo_anterior or CERO),
                     'total': total_anticipo, 'imputado': imputado, 'remanente_siguiente': total_anticipo - imputado},
        'otros_impuestos': otros, 'retenciones': retenciones,
        'total_determinado': determinado, 'total_a_pagar': max(determinado, CERO),
    }


def resumen_mes(mes, periodo=None):
    validar_mes(mes)
    config = ConfiguracionContable.actual()
    cierre = CierreTributario.objects.filter(mes=mes).first() or CierreTributario(mes=mes)
    # El período del RCV prima para compras (puede ser posterior a emisión).
    docs = list(DocumentoTributario.objects.filter(ambiente='produccion').filter(
        Q(periodo_tributario=mes) | Q(periodo_tributario='', fecha_emision__year=int(mes[:4]), fecha_emision__month=int(mes[5:])))
        .select_related('pedido__cliente', 'factura__proveedor', 'gasto', 'nota_compra__factura__proveedor', 'importacion', 'conciliado_por')
        .prefetch_related('historial_conciliacion'))
    filas = [fila_documento(d) for d in docs]
    advertencias = []
    if not config.inicio_actividades:
        advertencias.append('Falta confirmar fecha de inicio de actividades')
    def vigente(d):
        return config.inicio_actividades and d.fecha_emision >= config.inicio_actividades
    ventas = [d for d in docs if d.operacion == 'ventas' and d.tipo != 46 and vigente(d)]
    compras = [d for d in docs if d.operacion == 'compras' and vigente(d)]
    signo = lambda d: -1 if d.tipo == 61 else 1
    suma = lambda lista, campo: sum((signo(d) * getattr(d, campo) for d in lista), CERO)
    debito, neto = suma(ventas, 'iva'), suma(ventas, 'neto')
    elegibles = [d for d in compras if d.estado_sii == 'registrado' and d.credito_validado]
    credito = suma(elegibles, 'iva')
    anticipos = suma([d for d in compras if d.estado_sii == 'registrado' and d.anticipo_validado], 'anticipo')
    anticipo_pendiente = suma([d for d in compras if not d.anticipo_validado or d.estado_sii != 'registrado'], 'anticipo')
    if anticipo_pendiente:
        advertencias.append('Anticipos pendientes de validar; no se imputan')
    if any(d.otros_impuestos or d.iva_uso_comun for d in docs):
        advertencias.append('Otros impuestos/IVA uso común requieren clasificación; revisar ajuste F29')
    if any(columnas_pendientes(d) for d in docs):
        advertencias.append('Hay columnas monetarias adicionales sin interpretar; validar formato y tratamiento tributario')
    if any(not vigente(d) for d in docs):
        advertencias.append('Documentos anteriores al inicio o sin inicio confirmado: excluidos de la estimación')
    if any(d.origen != 'sii' for d in docs):
        advertencias.append('Hay documentos de producción aún no verificados contra el RCV')
    if any(d.tipo == 46 for d in docs):
        advertencias.append('Factura de compra DTE 46: validar cambio de sujeto y retenciones; estimación no definitiva')
    inicio = datetime.fromisoformat(mes + '-01').replace(tzinfo=ZONA)
    fin = datetime(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1, tzinfo=ZONA)
    if periodo:
        inicio = max(inicio, datetime.combine(periodo.fecha_inicio, datetime.min.time(), tzinfo=ZONA))
        if periodo.fecha_fin:
            fin = min(fin, datetime.combine(periodo.fecha_fin + timedelta(days=1), datetime.min.time(), tzinfo=ZONA))
    pedidos = list(Pedido.objects.exclude(estado='Anulado').filter(fecha__gte=inicio, fecha__lt=fin)
        .select_related('cliente').prefetch_related('documentos'))
    sin_documento, fechas_pendientes, historicos = [], [], []
    for p in pedidos:
        fecha = fecha_comercial(p)
        if config.inicio_actividades and fecha < config.inicio_actividades:
            historicos.append(p.pk)
            continue
        if not any(d.ambiente == 'produccion' and d.operacion == 'ventas' and d.tipo in (33, 34, 39, 41) for d in p.documentos.all()):
            sin_documento.append({'id': p.pk, 'cliente': p.cliente.nombre, 'total': p.total,
                                  'fecha_comercial': fecha_comercial(p), 'fecha_entrega': p.fecha_entrega,
                                  'entrega_confirmada': p.fecha_entrega is not None})
    # Entregas anteriores documentadas más tarde siguen siendo pendientes en el mes de entrega.
    tardios = []
    for p in pedidos:
        posteriores = [d for d in p.documentos.all() if d.operacion == 'ventas' and d.ambiente == 'produccion'
                       and d.tipo in (33, 34, 39, 41) and d.fecha_emision.strftime('%Y-%m') > mes]
        if posteriores:
            tardios.append(p.pk)
    if tardios:
        advertencias.append('Ventas documentadas en un mes posterior: revisar regularización')
    parametros_pendientes = [c for c in ('tasa_ppm', 'base_ppm', 'remanente_anterior', 'remanente_anticipo_anterior') if getattr(cierre, c) is None]
    if parametros_pendientes:
        advertencias.append('Falta confirmar: ' + ', '.join(parametros_pendientes))
    base = cierre.base_ppm if cierre.base_ppm is not None else neto
    ppm = pesos(max(base, CERO) * cierre.tasa_ppm / 100) if cierre.tasa_ppm is not None else None
    saldo = debito - credito - (cierre.remanente_anterior or CERO)
    iva = max(saldo, CERO)
    disponible = max(anticipos + (cierre.remanente_anticipo_anterior or CERO), CERO)
    imputado = min(disponible, iva)
    f29 = {'iva_debito': debito, 'iva_credito': credito, 'remanente_anterior': cierre.remanente_anterior,
           'remanente_siguiente': max(-saldo, CERO), 'anticipo_periodo': anticipos,
           'anticipo_pendiente': anticipo_pendiente, 'anticipo_imputado': imputado,
           'remanente_anticipo_siguiente': disponible - imputado,
           'iva_a_pagar': iva - imputado, 'ppm': ppm, 'otros_impuestos': cierre.otros_impuestos,
           'retenciones': cierre.retenciones,
           'total_estimado': pesos(max(iva - imputado + ppm + cierre.otros_impuestos - cierre.retenciones, CERO)) if not parametros_pendientes else None}
    sin_vinculo = sum(f['registro_id'] is None for f in filas)
    revisiones = sum(f['estado_conciliacion'] != 'conciliado' for f in filas)
    diferencias_monto = sum(f['diferencias']['monto'] is not None and abs(f['diferencias']['monto']) > TOLERANCIA for f in filas)
    diferencias_periodo = sum(f['diferencias']['periodo'] for f in filas)
    importaciones = ImportacionSII.objects.filter(mes=mes)
    if not importaciones.filter(tipo='ventas').exists() or not importaciones.filter(tipo='compras').exists():
        advertencias.append('Falta importar detalle de ventas o compras; verificar cobertura completa del RCV')
    # Los resúmenes comprueban cobertura; nunca se suman a documentos detallados.
    cobertura = []
    ultima = importaciones.filter(tipo='resumen').first()
    if ultima:
        for t in ultima.resultado.get('tipos', []):
            detalle = [d for d in ventas if d.tipo == t['tipo']]
            diferencia = Decimal(str(t['total_sii'])) - sum((d.total for d in detalle), CERO)
            item = {'tipo': t['tipo'], 'cantidad_sii': t['cantidad_sii'], 'cantidad_detalle': len(detalle), 'diferencia': diferencia}
            cobertura.append(item)
            if diferencia or len(detalle) != t['cantidad_sii']:
                advertencias.append(f'Resumen SII tipo {t["tipo"]} difiere del detalle importado')
    documental = bool(filas) and not revisiones
    completo = documental and not sin_documento and not tardios and not advertencias
    parametros = {c: getattr(cierre, c) for c in ('tasa_ppm', 'base_ppm', 'ppm_informado_sii', 'remanente_anterior',
                  'remanente_anticipo_anterior', 'otros_impuestos', 'retenciones', 'fundamento')}
    return {'mes': mes, 'documentos': filas, 'ventas_sin_documento': sin_documento,
            'pedidos_fecha_entrega_pendiente': fechas_pendientes, 'pedidos_historicos': historicos,
            'entregas_documentadas_despues': tardios, 'cobertura_resumen': cobertura,
            'indicadores': {'coincidentes': len(filas) - revisiones, 'sin_coincidencia': sin_vinculo,
                            'diferencias_monto': diferencias_monto, 'diferencias_periodo': diferencias_periodo,
                            'ventas_sin_documento': len(sin_documento),
                            'compras_por_revisar': sum(f['operacion'] == 'compras' and (f['estado_sii'] != 'registrado' or f['estado_conciliacion'] != 'conciliado') for f in filas)},
            'ventas': {'neto': neto, 'total': suma(ventas, 'total'), 'iva_debito': debito,
                       'conciliadas': sum(f['operacion'] == 'ventas' and f['estado_conciliacion'] == 'conciliado' for f in filas),
                       'facturas': sum(d.tipo in (33, 34) for d in ventas), 'boletas': sum(d.tipo in (39, 41) for d in ventas),
                       'notas_credito': sum(d.tipo == 61 for d in ventas)},
            'compras': {'registradas': sum(d.estado_sii == 'registrado' for d in compras),
                        'sin_vinculo': sum(f['operacion'] == 'compras' and f['registro_id'] is None for f in filas),
                        'pendientes': sum(d.estado_sii == 'pendiente' for d in compras),
                        'reclamadas': sum(d.estado_sii == 'reclamado' for d in compras),
                        'exentas': sum(d.tipo == 34 for d in compras), 'iva_credito': credito,
                        'anticipo_documental': suma(compras, 'anticipo')},
            'ppm': {'regimen': config.regimen, 'base_estimada_documental': neto, 'base_utilizada': base,
                    'tasa': cierre.tasa_ppm, 'estimado': ppm, 'informado_sii': cierre.ppm_informado_sii,
                    'diferencia': ppm - cierre.ppm_informado_sii if cierre.ppm_informado_sii is not None and ppm is not None else None},
            'parametros': parametros, 'f29_estimado': f29, 'declarado': cierre.declarado,
            'f29': propuesta_f29(mes, ventas, compras, cierre, config),
            'documentalmente_conciliado': documental, 'cumplimiento_completo': completo,
            'advertencias': advertencias,
            'config': {'rut_empresa': config.rut_empresa, 'inicio_actividades': config.inicio_actividades, 'regimen': config.regimen}}
