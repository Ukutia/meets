from decimal import Decimal

from django.urls import reverse

from .models import AjusteInventario, Bodega, ConteoInventario, DetalleConteo, StockBodega
from .test_finanzas import BaseFinanzas
from .views_conteo import stock_fisico
from .utils import mover_stock_congelado


class ConteoInventarioTests(BaseFinanzas):
    def contar(self, ubicacion='principal', **linea):
        return self.client.post(
            reverse("conteos_inventario"),
            {"ubicacion": ubicacion, "lineas": [{"producto": self.producto.id, **linea}]},
            format="json",
        )

    def test_conteo_que_calza_no_registra_diferencias(self):
        r = self.contar(contado_kilos="20", contado_unidades=10)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["productos_con_diferencia"], 0)
        self.assertFalse(AjusteInventario.objects.exists())

    def test_faltante_registra_diferencia_y_ajusta_stock(self):
        r = self.contar(contado_kilos="18,5", contado_unidades=9)
        self.assertEqual(r.status_code, 201, r.content)
        d = DetalleConteo.objects.get()
        self.assertEqual(d.diferencia_kilos, Decimal("-1.5"))
        self.assertEqual(d.diferencia_unidades, -1)
        self.assertEqual(AjusteInventario.objects.get().tipo, "ajuste")
        self.assertEqual(stock_fisico(self.producto), (Decimal("18.5"), 9))

    def test_sobrante_suma_stock(self):
        self.contar(contado_unidades=12)
        self.assertEqual(stock_fisico(self.producto), (Decimal("20"), 12))

    def test_unidades_reservadas_cuentan_como_stock_fisico(self):
        self.crear_pedido(cantidad_kilos=0)  # reserva 1 unidad
        self.assertEqual(stock_fisico(self.producto)[1], 10)
        r = self.contar(contado_unidades=10)
        self.assertEqual(r.json()["productos_con_diferencia"], 0)

    def test_sin_cantidades_se_rechaza(self):
        self.assertEqual(self.contar().status_code, 400)

    def test_conteos_por_ubicacion_ajustan_solo_el_stock_elegido(self):
        bodega = Bodega.objects.create(nombre='Sucursal')
        StockBodega.objects.create(producto=self.producto, bodega=bodega, unidades=3, kilos=6)
        mover_stock_congelado(self.producto, 2, Decimal('4'))
        self.assertEqual(stock_fisico(self.producto), (Decimal('10'), 5))
        url = reverse('stock_fisico')
        for ubicacion, kilos, unidades in [('principal', 10, 5), ('congelado', 4, 2), (str(bodega.pk), 6, 3)]:
            datos = self.client.get(url, {'ubicacion': ubicacion}).json()[0]
            self.assertEqual((Decimal(datos['sistema_kilos']), datos['sistema_unidades']), (kilos, unidades))

        respuesta = self.contar(str(bodega.pk), contado_kilos='5', contado_unidades=4)
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        self.assertEqual(respuesta.json()['ubicacion'], 'Sucursal')
        self.assertEqual(stock_fisico(self.producto, bodega=bodega), (Decimal('5'), 4))
        self.assertEqual(stock_fisico(self.producto), (Decimal('10'), 5))
        self.assertEqual(stock_fisico(self.producto, congelado=True), (Decimal('4'), 2))
        conteo = ConteoInventario.objects.get()
        self.assertEqual(conteo.movimientos_bodega.get(destino=bodega).unidades, 1)
        self.assertEqual(conteo.movimientos_bodega.get(origen=bodega).kilos, Decimal('1'))

        ajuste = AjusteInventario.objects.get()
        url_ajuste = reverse('ajuste-inventario-detail', args=[ajuste.pk])
        self.assertEqual(self.client.delete(url_ajuste).status_code, 400)
        self.assertTrue(self.client.get(reverse('ajustes-inventario-list')).json()[0]['de_conteo'])

        respuesta = self.contar('congelado', contado_kilos='4.50', contado_unidades=1)
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        self.assertEqual(stock_fisico(self.producto, congelado=True), (Decimal('4.50'), 1))
        self.assertEqual(stock_fisico(self.producto), (Decimal('10'), 5))
        respuesta = self.contar(contado_kilos=9, contado_unidades=4)
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        self.assertEqual(stock_fisico(self.producto, bodega=bodega), (Decimal('5'), 4))
        self.assertEqual(stock_fisico(self.producto, congelado=True), (Decimal('4.50'), 1))

    def test_reserva_de_bodega_sigue_en_su_ubicacion_hasta_el_pesaje(self):
        bodega = Bodega.objects.create(nombre='Sucursal')
        StockBodega.objects.create(producto=self.producto, bodega=bodega, unidades=3, kilos=6)
        respuesta = self.client.post(reverse('crear_pedido'), {
            'cliente': self.cliente.pk, 'bodega': bodega.pk,
            'detalles': [{'producto': self.producto.pk, 'cantidad_unidades': 1, 'cantidad_kilos': 0}],
        }, format='json')
        self.assertEqual(respuesta.status_code, 201, respuesta.content)
        self.assertEqual(stock_fisico(self.producto), (Decimal('14'), 7))
        self.assertEqual(stock_fisico(self.producto, bodega=bodega), (Decimal('6'), 3))
        respuesta = self.contar(str(bodega.pk), contado_unidades=0, contado_kilos=0)
        self.assertEqual(respuesta.status_code, 400, respuesta.content)
        self.assertFalse(AjusteInventario.objects.exists())

    def test_ubicacion_invalida_y_conteos_historicos(self):
        self.assertEqual(self.contar('999999', contado_unidades=1).status_code, 400)
        self.assertEqual(self.contar(None, contado_unidades=1).status_code, 400)
        self.assertFalse(ConteoInventario.objects.exists())
        ConteoInventario.objects.create(usuario=self.user)
        self.assertIsNone(self.client.get(reverse('conteos_inventario')).json()[0]['ubicacion'])
