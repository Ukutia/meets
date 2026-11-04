from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0048_movimiento_bodega'),
    ]

    operations = [
        migrations.AddField(
            model_name='factura',
            name='excluir_f29',
            field=models.BooleanField(default=False, verbose_name='No considerar en el F29'),
        ),
    ]
