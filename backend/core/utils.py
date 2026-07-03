from django.db.models import Sum

from .models import EntradaProducto, FacturaDetallePedido


def estado_consumo_detalle(detalle):
    """Para una línea de factura (``DetalleFactura``) determina cuánto de su
    stock (``EntradaProducto``) sigue vivo frente a lo originalmente registrado
    y devuelve el estado de edición permitido.

    El stock se crea 1:1 con cada ``DetalleFactura`` al emitir la factura y se
    consume por FIFO en cada venta (``CrearPedido``), borrando la fila de
    ``EntradaProducto`` cuando llega a 0. Comparar las unidades vivas contra las
    originales nos dice cuánto de ese lote ya se vendió.

    Estados:
      - ``libre``: nada vendido de ese lote -> cantidad y costo editables.
      - ``parcial``: parte vendida -> costo libre, cantidad con piso en lo vendido.
      - ``bloqueada``: lote totalmente consumido -> cantidad/costo bloqueados.
    """
    original = int(detalle.cantidad_unidades or 0)

    vivas = EntradaProducto.objects.filter(
        factura=detalle.factura_id,
        producto=detalle.producto_id,
    ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0
    vivas = int(vivas)

    consumidas = original - vivas
    if consumidas < 0:
        consumidas = 0

    if consumidas <= 0:
        estado = 'libre'
    elif vivas <= 0:
        estado = 'bloqueada'
    else:
        estado = 'parcial'

    return {
        'estado': estado,
        'original': original,
        'vivas': vivas,
        'consumidas': consumidas,
    }


def pedidos_consumidores_detalle(detalle):
    """IDs de pedidos (no anulados) que consumieron stock de este
    producto+factura, vía ``FacturaDetallePedido``, para poder explicar en el
    frontend por qué una línea quedó bloqueada."""
    return list(
        FacturaDetallePedido.objects.filter(
            factura=detalle.factura_id,
            detallepedido__producto=detalle.producto_id,
        )
        .exclude(detallepedido__pedido__estado='Anulado')
        .values_list('detallepedido__pedido_id', flat=True)
        .distinct()
    )
