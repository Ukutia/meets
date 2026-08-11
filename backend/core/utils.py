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
    fecha_entrada), ponderando el costo por KILOS estimados de cada lote (no
    por cantidad de unidades: costo_por_kilo es un precio por kilo, y las
    unidades de un mismo lote no pesan todas lo mismo).

    Usada tanto al crear un pedido (CrearPedido) como al editarlo subiendo
    cantidad_unidades (PedidoDetailView.put) para que ambos flujos consuman
    inventario real y calculen el costo de la misma forma.

    SOLO MUEVE UNIDADES. Los kilos del ledger NO se tocan aca: se descuentan
    con el peso REAL de la bascula, cuando se conoce (CrearPedido si el pedido
    viene pesado, ActualizarKilosPedido al registrar el pesaje de una reserva),
    via ``descontar_kilos_fifo``. Antes esta funcion restaba un peso ESTIMADO
    (promedio del lote) y nadie corregia despues la diferencia contra el peso
    real, asi que el ledger de kilos derivaba en (estimado - real) por cada
    venta. ``kilos_consumidos`` se sigue calculando y devolviendo porque el
    COSTEO lo necesita, pero es un valor de costo, no de stock.

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
        cantidad_restante_unidades -= unidades_consumidas

        facturas_usadas.append(entrada.factura)
        # OJO: Factura.numero_factura ES el primary key (ver models.py), no hay
        # campo "id" -> hay que usar factura_id (el FK), no factura.id.
        facturas_cantidades[entrada.factura_id] = (
            facturas_cantidades.get(entrada.factura_id, 0) + int(unidades_consumidas)
        )

        # El lote solo se borra cuando no queda NADA que rastrear. Si se
        # quedo sin unidades pero todavia carga kilos, la fila se conserva:
        # esos kilos son stock real que aun no se ha pesado en una venta, y
        # borrarlos aqui los haria desaparecer del inventario.
        if entrada.cantidad_unidades <= 0 and entrada.cantidad_kilos <= 0:
            entrada.delete()
        else:
            entrada.save()

    if cantidad_restante_unidades > 0:
        raise ValidationError(
            f"No hay stock disponible suficiente de '{producto.nombre}' para cubrir el pedido"
        )

    return costo_total, kilos_consumidos, facturas_usadas, facturas_cantidades


def descontar_kilos_fifo(producto, kilos_a_descontar, permitir_faltante=False):
    """Descuenta SOLO kilos de ``EntradaProducto`` (FIFO por fecha_entrada) sin
    tocar las unidades.

    Es la unica via por la que bajan los kilos del ledger. La usan:
      - las mermas declaradas en kilos (CrearAjusteInventario),
      - las ventas, con el peso REAL de la bascula (CrearPedido cuando el
        pedido viene pesado, ActualizarKilosPedido y PedidoDetailView.put al
        registrar o corregir el pesaje).

    El lote nunca se borra aunque llegue a 0 kilos: puede seguir teniendo
    unidades sin pesar, y borrarlo las eliminaria.

    ``permitir_faltante`` cambia que pasa cuando el ledger no alcanza:
      - False (default): lanza ValidationError y no toca nada. Para operaciones
        que todavia se pueden rechazar, como registrar una merma.
      - True: descuenta hasta donde alcance y devuelve lo que falto. Para
        registrar un pesaje: la carne YA salio de la camara, bloquear el
        registro no la devuelve; el faltante queda visible en el comando
        resincronizar_ledger_stock --kilos.

    Devuelve (kilos_descontados, faltante).
    """
    kilos_a_descontar = Decimal(str(kilos_a_descontar))
    if kilos_a_descontar <= 0:
        return Decimal('0.00'), Decimal('0.00')

    entradas = list(
        EntradaProducto.objects.filter(producto=producto).order_by('fecha_entrada')
    )
    disponibles = sum((e.cantidad_kilos for e in entradas), Decimal('0.00'))
    if disponibles < kilos_a_descontar and not permitir_faltante:
        raise ValidationError(
            f"No hay kilos suficientes de '{producto.nombre}': hay "
            f"{disponibles} kg en stock y se intentan descontar "
            f"{kilos_a_descontar} kg"
        )

    restante = kilos_a_descontar
    for entrada in entradas:
        if restante <= 0:
            break
        if entrada.cantidad_kilos <= 0:
            continue
        tomados = min(entrada.cantidad_kilos, restante)
        entrada.cantidad_kilos -= tomados
        restante -= tomados
        entrada.save()

    return kilos_a_descontar - restante, restante


def restituir_kilos_fifo(producto, kilos_a_devolver):
    """Devuelve kilos al ledger, al lote vivo MAS ANTIGUO (para que vuelvan a
    la misma posicion FIFO de la que salieron).

    La usan las correcciones de pesaje a la baja: si una linea pasa de 3.0 a
    2.5 kg, esos 0.5 kg nunca salieron de la camara y tienen que volver.
    """
    kilos_a_devolver = Decimal(str(kilos_a_devolver))
    if kilos_a_devolver <= 0:
        return Decimal('0.00')

    entrada = (
        EntradaProducto.objects.filter(producto=producto)
        .order_by('fecha_entrada')
        .first()
    )
    if entrada is None:
        # Sin ningun lote vivo no hay donde ponerlos: el producto quedaria con
        # kilos sin lote ni costo asociado. Se reporta en vez de inventar.
        raise ValidationError(
            f"No hay ningun lote de '{producto.nombre}' donde devolver "
            f"{kilos_a_devolver} kg"
        )

    entrada.cantidad_kilos = Decimal(str(entrada.cantidad_kilos)) + kilos_a_devolver
    entrada.save()
    return kilos_a_devolver


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
