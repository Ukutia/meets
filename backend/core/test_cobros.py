import importlib
from decimal import Decimal

from django.apps import apps
from django.urls import reverse

from .models import Cobro, Pedido
from .test_cierre import CierreBase

migracion = importlib.import_module('core.migrations.0039_cobros_de_pedidos_pagados')


class CobroAutomaticoTests(CierreBase):
    def marcar(self, estado='Pagado'):
        r = self.client.put(reverse('pedido-detail', args=[self.pedido.id]), {'estado': estado}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def cobrar(self, monto):
        r = self.client.post(reverse('cierre_cobros'), {'pedido': self.pedido.id, 'monto': monto, 'medio': 'efectivo'})
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def automaticos(self):
        return list(Cobro.objects.filter(pedido=self.pedido, automatico=True))

    def test_marcar_pagado_registra_el_cobro(self):
        self.marcar()
        [c] = self.automaticos()
        self.assertEqual((c.monto, c.medio, c.receptor, c.vendedor_id), (Decimal('24000'), 'otro', 'vendedor', self.vendedor.id))
        p = self.ventas()['pedidos'][0]
        self.assertEqual(p['estado_cobro'], 'pagado')
        self.assertNotIn('Marcado Pagado sin cobro registrado', p['alertas'])
        self.assertTrue(any('confirma la fecha' in a for a in p['alertas']))
        self.assertEqual(self.ventas()['resumen']['cobros_por_confirmar'], 1)

    def test_solo_completa_lo_que_falta(self):
        self.cobrar(10000)
        self.marcar()
        self.assertEqual(self.automaticos()[0].monto, Decimal('14000'))
        # Un cobro manual después achica el automático, y si lo cubre todo, lo borra.
        self.cobrar(5000)
        self.assertEqual(self.automaticos()[0].monto, Decimal('9000'))
        self.cobrar(9000)
        self.assertEqual(self.automaticos(), [])

    def test_desmarcar_pagado_borra_el_automatico(self):
        self.cobrar(10000)
        self.marcar()
        self.marcar('Preparado')
        self.assertEqual(self.automaticos(), [])
        self.assertEqual(Cobro.objects.filter(pedido=self.pedido).count(), 1)

    def test_confirmarlo_lo_deja_fijo(self):
        self.marcar()
        c = self.automaticos()[0]
        r = self.client.patch(reverse('cierre_cobro', args=[c.id]), {'medio': 'transferencia', 'fecha': '2026-10-20'},
                              format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()['automatico'])
        self.assertEqual(r.json()['comentario'], '')
        self.marcar('Preparado')
        self.assertTrue(Cobro.objects.filter(pk=c.id).exists())

    def test_no_se_borra_mientras_este_pagado(self):
        self.marcar()
        r = self.client.delete(reverse('cierre_cobro', args=[self.automaticos()[0].id]))
        self.assertEqual(r.status_code, 400)

    def test_anular_quita_el_automatico(self):
        self.marcar()
        self.marcar('Anulado')
        self.assertEqual(self.automaticos(), [])

    def test_pedidos_ya_pagados_se_completan(self):
        Pedido.objects.filter(pk=self.pedido.pk).update(estado='Pagado')  # sin pasar por las señales
        self.assertEqual(self.automaticos(), [])
        migracion.completar_cobros(apps, None)
        [c] = self.automaticos()
        self.assertEqual((c.monto, c.fecha), (Decimal('24000'), self.fecha))
        self.assertIn('fecha estimada', c.comentario)
