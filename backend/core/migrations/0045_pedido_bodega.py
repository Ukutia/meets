import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0044_bodega_stockbodega'),
    ]

    operations = [
        migrations.AddField(
            model_name='pedido',
            name='bodega',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pedidos', to='core.bodega', verbose_name='Bodega de origen'),
        ),
        migrations.AddField(
            model_name='detallepedido',
            name='bodega_unidades',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
