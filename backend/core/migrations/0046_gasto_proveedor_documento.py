from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0045_pedido_bodega'),
    ]

    operations = [
        migrations.AddField(
            model_name='gasto',
            name='proveedor',
            field=models.CharField(blank=True, default='', max_length=150),
        ),
        migrations.AddField(
            model_name='gasto',
            name='numero_documento',
            field=models.CharField(blank=True, default='', max_length=40),
        ),
        migrations.AlterField(
            model_name='gasto',
            name='categoria',
            field=models.CharField(choices=[('arriendo', 'Arriendo'), ('servicios', 'Luz, agua, gas, internet'), ('transporte', 'Transporte / combustible'), ('insumos', 'Insumos y envases'), ('sueldos', 'Sueldos y honorarios'), ('marketing', 'Publicidad'), ('software', 'Dominio, hosting y software'), ('comisiones', 'Comisiones bancarias'), ('contador', 'Contador / trámites'), ('otro', 'Otro')], default='otro', max_length=20),
        ),
    ]
