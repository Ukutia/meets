from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0049_factura_excluir_f29'),
    ]

    operations = [
        migrations.AddField(
            model_name='factura',
            name='mes_f29',
            field=models.CharField(blank=True, default='', max_length=7, verbose_name='Mes de declaración F29'),
        ),
    ]
