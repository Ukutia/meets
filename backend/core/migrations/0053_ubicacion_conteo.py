import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0052_registrar_ventas_bodega'),
    ]

    operations = [
        migrations.AddField(
            model_name='conteoinventario',
            name='ubicacion',
            field=models.CharField(blank=True, default='', max_length=80),
        ),
        migrations.AddField(
            model_name='movimientobodega',
            name='conteo',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movimientos_bodega', to='core.conteoinventario'),
        ),
    ]
