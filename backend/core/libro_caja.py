"""Libro de caja: entradas y salidas de plata con saldo acumulado.

No duplica datos: arma las líneas en memoria desde Cobro (entradas), PagoFactura
(salidas) y MovimientoCaja (manuales: saldo inicial, aportes, retiros...)."""
from decimal import Decimal

from .models import ComentarioCaja, Cobro, MovimientoCaja, PagoFactura

CERO = Decimal('0')
ORIGENES = ('pedido', 'factura', 'manual')


def _lineas(receptor):
    cobros = Cobro.objects.select_related('pedido__cliente', 'vendedor')
    if receptor == 'empresa':
        cobros = cobros.filter(receptor='empresa')
    for c in cobros:
        yield {
            'clave': f'cobro-{c.pk}', 'fecha': c.fecha, 'origen': 'pedido', 'id': c.pk,
            'descripcion': f'Pedido #{c.pedido_id} · {c.pedido.cliente.nombre}',
            'entrada': c.monto, 'salida': CERO, 'editable': False,
            'ref': {'pedido': c.pedido_id}, 'medio': c.medio, 'receptor': c.receptor,
            'automatico': c.automatico,
        }
    for p in PagoFactura.objects.select_related('factura__proveedor'):
        yield {
            'clave': f'pago-{p.pk}', 'fecha': p.fecha_de_pago, 'origen': 'factura', 'id': p.pk,
            'descripcion': f'Factura {p.factura_id} · {p.factura.proveedor.nombre}',
            'entrada': CERO, 'salida': p.monto_del_pago, 'editable': False,
            'ref': {'factura': p.factura_id},
        }
    for m in MovimientoCaja.objects.all():
        es_entrada = m.tipo == 'entrada'
        yield {
            'clave': f'manual-{m.pk}', 'fecha': m.fecha, 'origen': 'manual', 'id': m.pk,
            'descripcion': m.descripcion,
            'entrada': m.monto if es_entrada else CERO, 'salida': CERO if es_entrada else m.monto,
            'editable': True, 'ref': {'id': m.pk}, 'categoria': m.categoria, 'comentario': m.comentario,
        }


def construir_libro(desde=None, hasta=None, receptor='todos'):
    """`desde`/`hasta` son date o None. Devuelve saldo anterior, totales, resumen
    por origen y los movimientos del rango con su saldo acumulado."""
    # Orden estable: fecha, entradas antes que salidas, origen, id.
    lineas = sorted(_lineas(receptor), key=lambda l: (
        l['fecha'], l['entrada'] == CERO, ORIGENES.index(l['origen']), l['id']))

    saldo_anterior = sum((l['entrada'] - l['salida'] for l in lineas if desde and l['fecha'] < desde), CERO)
    saldo = saldo_anterior
    total_entradas = total_salidas = CERO
    resumen = {o: {'entradas': CERO, 'salidas': CERO} for o in ORIGENES}
    movimientos = []
    comentarios = {}
    for c in ComentarioCaja.objects.select_related('usuario'):
        comentarios.setdefault(c.clave, []).append({
            'id': c.pk, 'texto': c.texto, 'creado': c.creado.isoformat(),
            'usuario': c.usuario.get_username() if c.usuario else '',
        })
    for l in lineas:
        if (desde and l['fecha'] < desde) or (hasta and l['fecha'] > hasta):
            continue
        saldo += l['entrada'] - l['salida']
        total_entradas += l['entrada']
        total_salidas += l['salida']
        resumen[l['origen']]['entradas'] += l['entrada']
        resumen[l['origen']]['salidas'] += l['salida']
        l.pop('id')
        movimientos.append({**l, 'fecha': l['fecha'].isoformat(), 'saldo': saldo,
                            'comentarios': comentarios.get(l['clave'], [])})
    return {
        'saldo_anterior': saldo_anterior, 'total_entradas': total_entradas,
        'total_salidas': total_salidas, 'saldo_final': saldo,
        'resumen': resumen, 'movimientos': movimientos,
    }
