from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import migrations
from django.db.models import Sum


def completar_cobros(apps, schema_editor):
    """Pedidos que ya estaban Pagados sin (todo) su cobro: se les crea el cobro
    automático por lo que falta. No se sabe cuándo pagaron, así que va con la
    fecha del pedido y queda por confirmar."""
    Pedido = apps.get_model('core', 'Pedido')
    Cobro = apps.get_model('core', 'Cobro')
    Config = apps.get_model('core', 'ConfiguracionContable')
    config = Config.objects.filter(pk=1).first()
    receptor = config.receptor_cobro if config else 'vendedor'
    zona = ZoneInfo('America/Santiago')
    for p in Pedido.objects.filter(estado='Pagado'):
        cobrado = Cobro.objects.filter(pedido=p).aggregate(t=Sum('monto'))['t'] or Decimal('0')
        faltante = p.total - cobrado
        if faltante <= Decimal('2'):
            continue
        Cobro.objects.create(
            pedido=p, monto=faltante, medio='otro', receptor=receptor,
            vendedor_id=p.vendedor_id if receptor == 'vendedor' else None,
            fecha=p.fecha.astimezone(zona).date(), automatico=True,
            comentario='El pedido ya estaba Pagado: fecha estimada (la del pedido). Confirma la fecha y el medio de pago.',
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0038_cobro_automatico'),
    ]

    operations = [
        migrations.RunPython(completar_cobros, migrations.RunPython.noop),
    ]
