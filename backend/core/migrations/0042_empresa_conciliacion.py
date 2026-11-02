from datetime import date
from django.db import migrations


def configurar_empresa(apps, schema_editor):
    Config = apps.get_model('core', 'ConfiguracionContable')
    config, _ = Config.objects.get_or_create(pk=1)
    # Datos proporcionados por el usuario; nunca se sobrescribe configuración existente.
    if not config.rut_empresa:
        config.rut_empresa = '78537642-0'
    if not config.inicio_actividades:
        config.inicio_actividades = date(2026, 10, 19)
    if not config.regimen:
        config.regimen = 'Pro Pyme General (14 D N.º 3) · contabilidad simplificada'
    config.save()


class Migration(migrations.Migration):
    dependencies = [('core', '0041_conciliacion_tributaria')]
    operations = [migrations.RunPython(configurar_empresa, migrations.RunPython.noop)]
