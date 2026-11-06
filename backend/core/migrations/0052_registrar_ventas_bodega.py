from django.db import migrations


def registrar_ventas_previas(apps, schema_editor):
    """Las ventas desde bodega anteriores no quedaron en el historial: se
    registran como salidas para que entradas - salidas cuadre con el stock."""
    DetallePedido = apps.get_model('core', 'DetallePedido')
    MovimientoBodega = apps.get_model('core', 'MovimientoBodega')
    for d in DetallePedido.objects.filter(bodega_unidades__gt=0, pedido__bodega__isnull=False).select_related('pedido'):
        if MovimientoBodega.objects.filter(detalle=d).exists():
            continue
        m = MovimientoBodega.objects.create(
            producto_id=d.producto_id, origen_id=d.pedido.bodega_id, destino=None, detalle=d,
            unidades=d.bodega_unidades, kilos=0, nota=f"Venta pedido #{d.pedido_id}")
        MovimientoBodega.objects.filter(pk=m.pk).update(fecha=d.pedido.fecha)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0051_movimientobodega_detalle'),
    ]

    operations = [
        migrations.RunPython(registrar_ventas_previas, migrations.RunPython.noop),
    ]
