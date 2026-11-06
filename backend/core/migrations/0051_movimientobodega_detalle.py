from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0050_factura_mes_f29'),
    ]

    operations = [
        migrations.AddField(
            model_name='movimientobodega',
            name='detalle',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='movimientos_bodega', to='core.detallepedido'),
        ),
    ]
