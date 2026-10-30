"""Cobro automático al marcar un pedido Pagado.

Si un pedido está Pagado, su plata tiene que estar registrada como cobro.
Cuando lo cobrado a mano no alcanza al total, se crea (o ajusta) un cobro
automático por la diferencia; si el pedido deja de estar Pagado, o los cobros
manuales ya lo cubren, el automático se borra. Corre en las señales de
guardado de Pedido y Cobro para cubrir todos los caminos (botón Pagado,
marcado masivo, edición de kilos, cartola, etc.).
"""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Cobro, ConfiguracionContable, Pedido

TOLERANCIA = Decimal('2')
COMENTARIO = 'Registrado al marcar el pedido como Pagado. Confirma la fecha y el medio de pago.'


def sincronizar_cobro_pagado(pedido, fecha=None, comentario=COMENTARIO):
    automaticos = list(pedido.cobros.filter(automatico=True).order_by('id'))
    faltante = Decimal('0')
    if pedido.estado == 'Pagado':
        manual = sum((c.monto for c in pedido.cobros.filter(automatico=False)), Decimal('0'))
        faltante = pedido.total - manual

    if faltante <= TOLERANCIA:
        for c in automaticos:
            c.delete()
        return None

    if automaticos:
        cobro, sobran = automaticos[0], automaticos[1:]
        for c in sobran:
            c.delete()
        if cobro.monto != faltante:
            cobro.monto = faltante
            cobro.save(update_fields=['monto'])
        return cobro

    receptor = ConfiguracionContable.actual().receptor_cobro
    return Cobro.objects.create(
        pedido=pedido, monto=faltante, medio='otro', receptor=receptor,
        vendedor=pedido.vendedor if receptor == 'vendedor' else None,
        fecha=fecha or datetime.now(ZoneInfo('America/Santiago')).date(),
        automatico=True, comentario=comentario,
    )


@receiver(post_save, sender=Pedido)
def _pedido_guardado(sender, instance, raw=False, **kwargs):
    if not raw:
        sincronizar_cobro_pagado(instance)


@receiver(post_save, sender=Cobro)
@receiver(post_delete, sender=Cobro)
def _cobro_cambiado(sender, instance, raw=False, origin=None, **kwargs):
    # Los automáticos los maneja la propia sincronización; y si se está
    # borrando el pedido entero (cascada) no hay nada que completar.
    if raw or instance.automatico or isinstance(origin, Pedido):
        return
    pedido = Pedido.objects.filter(pk=instance.pedido_id).first()
    if pedido:
        sincronizar_cobro_pagado(pedido)
