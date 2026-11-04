from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0046_gasto_proveedor_documento'),
    ]

    operations = [
        migrations.AddField(
            model_name='pedido',
            name='mes_declaracion',
            field=models.DateField(blank=True, null=True, verbose_name='Mes de declaración'),
        ),
        migrations.AddField(
            model_name='pedido',
            name='declarado',
            field=models.BooleanField(default=False, verbose_name='Declarado en el SII'),
        ),
    ]
