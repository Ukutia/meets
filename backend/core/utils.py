from decimal import Decimal

from django.db.models import Sum
from rest_framework.exceptions import ValidationError

from .models import EntradaProducto, FacturaDetallePedido, DetalleFactura


def costo_por_kilo_ponderado(detalle):
    """Costo/kg de una linea de venta (DetallePedido) segun el modelo de costo
    elegido: promedio ponderado (por unidades consumidas) del costo/kg de los
    lotes de compra que la abastecieron (FacturaDetallePedido -> DetalleFactura).

    Robusto por diseno: solo usa el costo/kg del proveedor y las unidades, NUNCA
    los pesos por pieza (que en los datos historicos estan corruptos en ~30% de
    las lineas). El resultado siempre queda entre el minimo y el maximo costo/kg
    de los lotes, asi que jamas produce costos absurdos.

    Devuelve None si la linea no tiene ninguna factura vinculada.
    """
    suma_costo = Decimal('0')
    suma_unidades = 0
    for link in FacturaDetallePedido.objects.filter(detallepedido=detalle):
        df = DetalleFactura.objects.filter(
            factura=link.factura_id, producto=detalle.producto_id
        ).first()
        if not df:
            continue
        suma_costo += Decimal(link.cantidad_unidades) * df.costo_por_kilo
        suma_unidades += link.cantidad_unidades
    if suma_unidades == 0:
        return None
    return suma_costo / suma_unidades


def consumir_fifo(producto, unidades_a_consumir):
    """Descuenta ``unidades_a_consumir`` de ``EntradaProducto`` (FIFO por
    fecha_entrada), ponderando el costo por KILOS reales consumidos de cada
    lote (no por cantidad de unidades: costo_por_kilo es un precio por kilo,
    y las unidades de un mismo lote no pesan todas lo mismo).

    Usada tanto al crear un pedido (CrearPedido) como al editarlo subiendo
    cantidad_unidades (PedidoDetailView.put) para que ambos flujos consuman
    inventario real y calculen el costo de la misma forma.

    Devuelve (costo_total, kilos_consumidos, facturas_usadas, facturas_cantidades).
    Lanza ValidationError si no hay stock suficiente.
    """
    if unidades_a_consumir <= 0:
        return Decimal('0.00'), Decimal('0.00'), [], {}

    entradas = EntradaProducto.objects.filter(producto=producto).order_by('fecha_entrada')
    costo_total = Decimal('0.00')
    kilos_consumidos = Decimal('0.00')
    cantidad_restante_unidades = Decimal(unidades_a_consumir)
    facturas_usadas = []
    facturas_cantidades = {}

    for entrada in entradas:
        if cantidad_restante_unidades <= 0:
            break
        if entrada.cantidad_unidades <= 0:
            continue

        peso_promedio = (
            entrada.cantidad_kilos / entrada.cantidad_unidades
            if entrada.cantidad_unidades else Decimal('0.00')
        )
        unidades_consumidas = min(Decimal(entrada.cantidad_unidades), cantidad_restante_unidades)
        kilos_consumidos_lote = unidades_consumidas * peso_promedio

        costo_total += kilos_consumidos_lote * entrada.costo_por_kilo
        kilos_consumidos += kilos_consumidos_lote

        entrada.cantidad_unidades -= int(unidades_consumidas)
        entrada.cantidad_kilos -= kilos_consumidos_lote
        cantidad_restante_unidades -= unidades_consumidas

        facturas_usadas.append(entrada.factura)
        # OJO: Factura.numero_factura ES el primary key (ver models.py), no hay
        # campo "id" -> hay que usar factura_id (el FK), no factura.id.
        facturas_cantidades[entrada.factura_id] = (
            facturas_cantidades.get(entrada.factura_id, 0) + int(unidades_consumidas)
        )

        if entrada.cantidad_unidades <= 0:
            entrada.delete()
        else:
            entrada.save()

    if cantidad_restante_unidades > 0:
        raise ValidationError(
            f"No hay stock disponible suficiente de '{producto.nombre}' para cubrir el pedido"
        )

    return costo_total, kilos_consumidos, facturas_usadas, facturas_cantidades


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
