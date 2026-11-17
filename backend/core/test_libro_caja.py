from datetime import date
from decimal import Decimal

from django.urls import reverse

from .libro_caja import construir_libro
from .models import Cobro, Factura, MovimientoCaja, PagoFactura, Pedido
from .test_cierre import CierreBase


class LibroCajaBase(CierreBase):
    def libro(self, **params):
        r = self.client.get(reverse('libro_caja'), params)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def manual(self, tipo, monto, fecha, **extra):
        return self.client.post(reverse('movimientos_caja'), {
            'tipo': tipo, 'monto': monto, 'fecha': fecha, 'descripcion': 'Mov', **extra}, format='json')

    def cobro(self, monto, fecha, receptor='vendedor'):
        return Cobro.objects.create(pedido=self.pedido, fecha=fecha, monto=monto, receptor=receptor,
                                    vendedor=self.vendedor if receptor == 'vendedor' else None)

    def pagar_factura(self, monto, fecha):
        f = Factura.objects.get(pk='100')
        return PagoFactura.objects.create(factura=f, fecha_de_pago=fecha, monto_del_pago=monto)


class LibroCajaTests(LibroCajaBase):
    def test_saldo_acumulado_mezcla_fuentes(self):
        self.assertEqual(self.manual('entrada', 100000, '2026-10-01').status_code, 201)
        self.cobro(24000, date(2026, 10, 2))
        self.pagar_factura(50000, date(2026, 10, 3))
        self.assertEqual(self.manual('salida', 10000, '2026-10-04').status_code, 201)
        libro = self.libro()
        self.assertEqual([m['saldo'] for m in libro['movimientos']], [100000, 124000, 74000, 64000])
        self.assertEqual(libro['saldo_anterior'], 0)
        self.assertEqual(libro['total_entradas'], 124000)
        self.assertEqual(libro['total_salidas'], 60000)
        self.assertEqual(libro['saldo_final'], 64000)
        self.assertEqual(libro['resumen']['pedido'], {'entradas': 24000, 'salidas': 0})
        self.assertEqual(libro['resumen']['factura'], {'entradas': 0, 'salidas': 50000})
        self.assertEqual(libro['resumen']['manual'], {'entradas': 100000, 'salidas': 10000})
        self.assertEqual([m['origen'] for m in libro['movimientos']], ['manual', 'pedido', 'factura', 'manual'])
        self.assertTrue(libro['movimientos'][0]['editable'])
        self.assertFalse(libro['movimientos'][1]['editable'])
        self.assertIn(f'Pedido #{self.pedido.id}', libro['movimientos'][1]['descripcion'])
        self.assertTrue(libro['movimientos'][2]['descripcion'].startswith('Factura 100 · '))

    def test_saldo_anterior_con_desde(self):
        self.manual('entrada', 100000, '2026-09-15')
        self.pagar_factura(30000, date(2026, 9, 20))
        self.cobro(24000, date(2026, 10, 5))
        libro = self.libro(desde='2026-10-01', hasta='2026-10-31')
        self.assertEqual(libro['saldo_anterior'], 70000)
        self.assertEqual(len(libro['movimientos']), 1)
        self.assertEqual(libro['movimientos'][0]['saldo'], 94000)
        self.assertEqual(libro['saldo_final'], 94000)
        # Lo posterior a "hasta" queda fuera.
        self.assertEqual(self.libro(desde='2026-10-01', hasta='2026-10-04')['movimientos'], [])

    def test_filtro_receptor_empresa(self):
        self.cobro(10000, date(2026, 10, 2), receptor='vendedor')
        self.cobro(7000, date(2026, 10, 2), receptor='empresa')
        self.assertEqual(self.libro()['total_entradas'], 17000)
        solo = self.libro(receptor='empresa')
        self.assertEqual(solo['total_entradas'], 7000)
        self.assertEqual(solo['movimientos'][0]['receptor'], 'empresa')
        r = self.client.get(reverse('libro_caja'), {'receptor': 'x'})
        self.assertEqual(r.status_code, 400)

    def test_entrada_antes_que_salida_el_mismo_dia(self):
        self.manual('salida', 500, '2026-10-02')
        self.manual('entrada', 1000, '2026-10-02')
        libro = construir_libro()
        self.assertEqual([(m['entrada'], m['salida']) for m in libro['movimientos']],
                         [(Decimal('1000'), Decimal('0')), (Decimal('0'), Decimal('500'))])
        self.assertEqual([m['saldo'] for m in libro['movimientos']], [Decimal('1000'), Decimal('500')])

    def test_cobro_automatico_de_pedido_pagado_aparece(self):
        r = self.client.put(reverse('pedido-detail', args=[self.pedido.id]), {'estado': 'Pagado'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Pedido.objects.get(pk=self.pedido.pk).estado, 'Pagado')
        [m] = self.libro()['movimientos']
        self.assertEqual((m['origen'], m['entrada'], m['automatico']), ('pedido', 24000, True))
        self.assertEqual(m['ref'], {'pedido': self.pedido.id})


class MovimientoCajaApiTests(LibroCajaBase):
    def test_validaciones_post(self):
        base = {'tipo': 'entrada', 'monto': 1000, 'fecha': '2026-10-01', 'descripcion': 'x'}
        casos = [{'monto': 0}, {'monto': -5}, {'monto': 'abc'}, {'tipo': 'otro'}, {'categoria': 'zzz'},
                 {'fecha': 'no-es-fecha'}, {'descripcion': '  '}]
        for cambio in casos:
            r = self.client.post(reverse('movimientos_caja'), {**base, **cambio}, format='json')
            self.assertEqual(r.status_code, 400, cambio)
            self.assertIn('error', r.json())
        self.assertEqual(MovimientoCaja.objects.count(), 0)

    def test_post_guarda_usuario_y_defaults(self):
        r = self.manual('salida', '2500.50', '2026-10-01')
        self.assertEqual(r.status_code, 201, r.content)
        m = MovimientoCaja.objects.get()
        self.assertEqual((m.usuario, m.categoria, m.monto), (self.user, 'otro', Decimal('2500.50')))

    def test_put_y_delete(self):
        pk = self.manual('entrada', 1000, '2026-10-01').json()['id']
        url = reverse('movimiento_caja', args=[pk])
        r = self.client.put(url, {'monto': 2000, 'tipo': 'salida', 'categoria': 'retiro'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        m = MovimientoCaja.objects.get(pk=pk)
        self.assertEqual((m.monto, m.tipo, m.categoria), (Decimal('2000'), 'salida', 'retiro'))
        self.assertEqual(self.client.put(url, {'monto': 0}, format='json').status_code, 400)
        self.assertEqual(self.client.put(reverse('movimiento_caja', args=[9999]), {}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(MovimientoCaja.objects.exists())

    def test_requiere_autenticacion(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(reverse('libro_caja')).status_code, 401)


class ComentariosCajaTests(LibroCajaBase):
    def comentar(self, clave, texto='Revisado'):
        return self.client.post(reverse('comentarios_caja'), {'clave': clave, 'texto': texto}, format='json')

    def test_comentar_cobro_pago_y_manual(self):
        cobro = self.cobro(24000, date(2026, 10, 2))
        pago = self.pagar_factura(5000, date(2026, 10, 3))
        manual_id = self.manual('entrada', 1000, '2026-10-04').json()['id']
        claves = (f'cobro-{cobro.pk}', f'pago-{pago.pk}', f'manual-{manual_id}')
        for clave in claves:
            r = self.comentar(clave, f'nota {clave}')
            self.assertEqual(r.status_code, 201, r.content)
        movs = {m['clave']: m for m in self.libro()['movimientos']}
        for clave in claves:
            self.assertEqual([c['texto'] for c in movs[clave]['comentarios']], [f'nota {clave}'])

    def test_varios_comentarios_en_orden_y_borrar(self):
        cobro = self.cobro(24000, date(2026, 10, 2))
        clave = f'cobro-{cobro.pk}'
        primero = self.comentar(clave, 'uno').json()
        self.comentar(clave, 'dos')
        textos = [c['texto'] for c in self.libro()['movimientos'][0]['comentarios']]
        self.assertEqual(textos, ['uno', 'dos'])
        self.assertEqual(self.client.delete(reverse('comentario_caja', args=[primero['id']])).status_code, 204)
        textos = [c['texto'] for c in self.libro()['movimientos'][0]['comentarios']]
        self.assertEqual(textos, ['dos'])

    def test_validaciones(self):
        self.assertEqual(self.comentar('cobro-99999').status_code, 404)
        self.assertEqual(self.comentar('basura').status_code, 404)
        self.assertEqual(self.comentar('otro-1').status_code, 404)
        cobro = self.cobro(1000, date(2026, 10, 2))
        self.assertEqual(self.comentar(f'cobro-{cobro.pk}', '   ').status_code, 400)

    def test_borrar_movimiento_borra_sus_comentarios(self):
        from .models import ComentarioCaja
        mid = self.manual('salida', 500, '2026-10-04').json()['id']
        self.comentar(f'manual-{mid}')
        self.assertEqual(ComentarioCaja.objects.count(), 1)
        self.client.delete(reverse('movimiento_caja', args=[mid]))
        self.assertEqual(ComentarioCaja.objects.count(), 0)
