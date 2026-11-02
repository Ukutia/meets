from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0039_cobros_de_pedidos_pagados'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pedido',
            name='fecha',
            field=models.DateTimeField(
                default=django.utils.timezone.now,
                verbose_name='Fecha del pedido',
            ),
        ),
    ]
