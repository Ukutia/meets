"""Cuadratura de inventario: se ingresa lo contado, se compara con el sistema y las
diferencias quedan registradas como ajustes que dejan el stock igual a lo contado."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F, Q, Sum
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    AjusteInventario, Bodega, ConteoInventario, DetalleConteo, DetallePedido,
    EntradaProducto, MovimientoBodega, Producto, StockBodega,
)
from .utils import agregar_exceso_fifo, consumir_fifo, descontar_kilos_fifo, sin_asignar
from .views import _error_de_validacion


def _ubicacion(valor):
    if valor == 'principal':
        return 'Bodega principal', False, None
    if valor == 'congelado':
        return 'Congelado', True, None
    try:
        bodega_id = int(str(valor))
    except ValueError:
        bodega_id = 0
    bodega = Bodega.objects.filter(pk=bodega_id).first() if 0 < bodega_id < 2**63 else None
    if bodega is None:
        raise ValidationError('Selecciona una ubicación válida para el conteo.')
    return bodega.nombre, False, bodega


def _stock_ubicacion(producto, congelado, bodega, existencia):
    """Devuelve stock disponible y físico, cada uno como (kilos, unidades)."""
    reservas = DetallePedido.objects.filter(
        producto=producto, cantidad_kilos=0, congelado=congelado,
    ).exclude(pedido__estado='Anulado').exclude(estado='Cancelado')

    if congelado:
        lote = EntradaProducto.objects.filter(producto=producto, congelado=True).aggregate(
            unidades=Sum('cantidad_unidades'), kilos=Sum('cantidad_kilos'),
        )
        kilos, unidades = lote['kilos'] or Decimal('0'), lote['unidades'] or 0
    elif bodega:
        kilos = existencia.kilos if existencia else Decimal('0')
        unidades = existencia.unidades if existencia else 0
    else:
        unidades, kilos = sin_asignar(producto)

    if bodega:
        reservas = reservas.filter(pedido__bodega=bodega)
        unidades_reservadas = reservas.aggregate(total=Sum('bodega_unidades'))['total'] or 0
    else:
        unidades_reservadas = reservas.aggregate(
            total=Sum(F('cantidad_unidades') - F('unidades_pendientes') - F('bodega_unidades')),
        )['total'] or 0

    kilos_reservados = Decimal('0')
    if not congelado:
        # La reserva ya descontó kilos estimados de su bodega, pero el ledger normal
        # conserva esos kilos hasta el pesaje. Se atribuyen a su ubicación física.
        origen = Q(origen=bodega) if bodega else Q(origen__isnull=False)
        destino = Q(destino=bodega) if bodega else Q(destino__isnull=False)
        movimientos = MovimientoBodega.objects.filter(detalle__in=reservas).aggregate(
            salidas=Sum('kilos', filter=origen), entradas=Sum('kilos', filter=destino),
        )
        kilos_reservados = (movimientos['salidas'] or Decimal('0')) - (movimientos['entradas'] or Decimal('0'))

    kilos_fisicos = kilos + kilos_reservados if bodega else kilos - kilos_reservados
    kilos_ajustables = kilos if bodega else kilos_fisicos
    return (kilos_ajustables, unidades), (kilos_fisicos, unidades + int(unidades_reservadas))


def stock_fisico(producto, congelado=False, bodega=None):
    existencia = StockBodega.objects.filter(bodega=bodega, producto=producto).first() if bodega else None
    return _stock_ubicacion(producto, congelado, bodega, existencia)[1]


def _aplicar_conteo(conteo, producto, congelado, existencia, kilos, unidades, usuario):
    if kilos > 0 or unidades > 0:
        agregar_exceso_fifo(producto, max(unidades, 0), max(kilos, Decimal('0')), congelado=congelado)
    if unidades < 0:
        consumir_fifo(producto, -unidades, congelado=congelado)
    if kilos < 0:
        descontar_kilos_fifo(producto, -kilos, congelado=congelado)
    if existencia is not None:
        existencia.kilos += kilos
        existencia.unidades += unidades
        existencia.save(update_fields=['kilos', 'unidades'])
        for signo in (1, -1):
            kg = max(kilos * signo, Decimal('0'))
            un = max(unidades * signo, 0)
            if kg or un:
                MovimientoBodega.objects.create(
                    producto=producto, conteo=conteo, usuario=usuario,
                    origen=existencia.bodega if signo < 0 else None,
                    destino=existencia.bodega if signo > 0 else None,
                    kilos=kg, unidades=un, nota='Ajuste por conteo de inventario',
                )


def _serializar(conteo):
    detalles = [{
        'id': d.id,
        'producto': d.producto_id,
        'producto_nombre': d.producto.nombre,
        'sistema_kilos': d.sistema_kilos,
        'sistema_unidades': d.sistema_unidades,
        'contado_kilos': d.contado_kilos,
        'contado_unidades': d.contado_unidades,
        'diferencia_kilos': d.diferencia_kilos,
        'diferencia_unidades': d.diferencia_unidades,
    } for d in conteo.detalles.all()]
    return {
        'id': conteo.id,
        'fecha': conteo.fecha,
        'usuario': conteo.usuario.username if conteo.usuario else None,
        'ubicacion': conteo.ubicacion or None,
        'notas': conteo.notas,
        'detalles': detalles,
        'productos_con_diferencia': sum(1 for d in detalles if d['diferencia_kilos'] or d['diferencia_unidades']),
    }


def _numero(valor, entero=False):
    if valor in (None, ''):
        return None
    try:
        n = Decimal(str(valor).replace(',', '.'))
    except InvalidOperation:
        raise ValueError
    if not n.is_finite() or n < 0:
        raise ValueError
    if entero:
        if n > 2147483647 or n != n.to_integral_value():
            raise ValueError
        return int(n)
    if n > Decimal('99999999.99') or n != n.quantize(Decimal('0.01')):
        raise ValueError
    return n


class ConteoInventarioView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        conteos = ConteoInventario.objects.select_related('usuario').prefetch_related('detalles__producto')[:50]
        return Response([_serializar(c) for c in conteos])

    def post(self, request):
        lineas = request.data.get('lineas') or []
        if not lineas:
            return Response({'error': 'Ingresa al menos un producto contado'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ubicacion, congelado, bodega = _ubicacion(request.data.get('ubicacion'))
            try:
                lineas_por_producto = sorted(
                    [(int(str(linea.get('producto'))), linea) for linea in lineas], key=lambda item: item[0],
                )
            except (AttributeError, TypeError, ValueError):
                raise ValidationError('Producto no encontrado')
            with transaction.atomic():
                conteo = ConteoInventario.objects.create(
                    usuario=request.user, ubicacion=ubicacion, notas=(request.data.get('notas') or '')[:255]
                )
                procesados = set()
                for producto_id, linea in lineas_por_producto:
                    try:
                        producto = Producto.objects.select_for_update(no_key=True).get(pk=producto_id)
                    except (Producto.DoesNotExist, ValueError, TypeError):
                        raise ValidationError('Producto no encontrado')
                    try:
                        kilos = _numero(linea.get('contado_kilos'))
                        unidades = _numero(linea.get('contado_unidades'), entero=True)
                    except ValueError:
                        raise ValidationError(f'Cantidad inválida en {producto.nombre}')
                    if kilos is None and unidades is None:
                        continue  # no se contó: no se toca
                    if producto.pk in procesados:
                        raise ValidationError(f'{producto.nombre} aparece más de una vez en el conteo.')
                    procesados.add(producto.pk)

                    lotes = EntradaProducto.objects.filter(producto=producto, congelado=congelado)
                    list(lotes.select_for_update().order_by('pk').values_list('pk', flat=True))
                    existencias = StockBodega.objects.filter(producto=producto).order_by('pk')
                    existencia = None
                    if bodega:
                        existencia = existencias.select_for_update().filter(bodega=bodega).first()
                    elif not congelado:
                        list(existencias.select_for_update().values_list('pk', flat=True))
                    disponible, (sis_kilos, sis_unidades) = _stock_ubicacion(producto, congelado, bodega, existencia)
                    dif_kilos = (kilos - sis_kilos) if kilos is not None else Decimal('0')
                    dif_unidades = (unidades - sis_unidades) if unidades is not None else 0

                    ajuste = None
                    if dif_kilos or dif_unidades:
                        if dif_kilos < -max(disponible[0], 0) or dif_unidades < -max(disponible[1], 0):
                            raise ValidationError(f'{producto.nombre}: el ajuste supera el stock disponible en {ubicacion}. Revisa las reservas y traspasos.')
                        if bodega and existencia is None:
                            existencia, _ = StockBodega.objects.select_for_update().get_or_create(
                                producto=producto, bodega=bodega,
                            )
                        ajuste = AjusteInventario.objects.create(
                            producto=producto, cantidad=dif_kilos, cantidad_unidades=dif_unidades,
                            tipo='ajuste', razon=f'Conteo de inventario #{conteo.id} · {ubicacion}',
                        )
                        try:
                            _aplicar_conteo(conteo, producto, congelado, existencia, dif_kilos, dif_unidades, request.user)
                        except ValidationError as e:
                            detalle = e.detail[0] if isinstance(e.detail, list) and e.detail else e.detail
                            raise ValidationError(f'{producto.nombre}: {detalle}')

                    DetalleConteo.objects.create(
                        conteo=conteo, producto=producto,
                        sistema_kilos=sis_kilos, sistema_unidades=sis_unidades,
                        contado_kilos=kilos, contado_unidades=unidades,
                        diferencia_kilos=dif_kilos, diferencia_unidades=dif_unidades, ajuste=ajuste,
                    )
                if not conteo.detalles.exists():
                    raise ValidationError('Ingresa al menos un producto contado')
        except ValidationError as e:
            return _error_de_validacion(e)

        conteo = ConteoInventario.objects.prefetch_related('detalles__producto').get(pk=conteo.pk)
        return Response(_serializar(conteo), status=status.HTTP_201_CREATED)


class StockFisicoView(APIView):
    """Lo que el sistema cree que hay, para mostrarlo junto al campo de conteo."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            _, congelado, bodega = _ubicacion(request.query_params.get('ubicacion'))
        except ValidationError as e:
            return _error_de_validacion(e)
        data = []
        for p in Producto.objects.exclude(estado="desactivado").order_by('nombre'):
            kilos, unidades = stock_fisico(p, congelado, bodega)
            data.append({'id': p.id, 'nombre': p.nombre, 'categoria': p.categoria,
                         'sistema_kilos': kilos, 'sistema_unidades': unidades})
        return Response(data)
