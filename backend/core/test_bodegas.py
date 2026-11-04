from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from datetime import date

from .models import EntradaProducto, Factura, MovimientoBodega, Producto, Proveedor, StockBodega


class BodegasTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='bodegas'))
        self.producto = Producto.objects.create(nombre='Lomo', precio_por_kilo=10000)
        self.factura = Factura.objects.create(
            proveedor=Proveedor.objects.create(nombre='P'), fecha=date.today(), numero_factura='F0',
            subtotal=0, iva=0, total=0)
        EntradaProducto.objects.create(
            factura=self.factura, producto=self.producto, cantidad_kilos=100, cantidad_unidades=20, costo_por_kilo=5000)

    def traspaso(self, origen, destino, unidades, kilos=0):
        return self.client.post(reverse('traspasos_bodega'), {
            'producto': self.producto.id, 'origen': origen, 'destino': destino,
            'unidades': unidades, 'kilos': kilos}, format='json')

    def test_traspasos_conservan_el_total(self):
        a = self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).json()['id']
        b = self.client.post(reverse('bodegas'), {'nombre': 'Sur'}).json()['id']
        self.assertEqual(self.traspaso(None, a, 12, '30').status_code, 201)
        self.assertEqual(self.traspaso(a, b, 5, '10').status_code, 201)
        stock = self.client.get(reverse('stock_productos')).json()[0]
        self.assertEqual({x['nombre']: x['unidades'] for x in stock['bodegas']}, {'Norte': 7, 'Sur': 5})
        self.assertEqual(stock['sin_asignar'], 8)
        self.assertEqual(self.traspaso(b, None, 5).status_code, 201)
        self.assertEqual(self.client.get(reverse('stock_productos')).json()[0]['sin_asignar'], 13)
        self.assertEqual(len(self.client.get(reverse('traspasos_bodega')).json()), 3)

    def test_traspaso_rechaza_mas_de_lo_que_hay(self):
        a = self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).json()['id']
        b = self.client.post(reverse('bodegas'), {'nombre': 'Sur'}).json()['id']
        self.assertEqual(self.traspaso(None, a, 21).status_code, 400)   # solo hay 20 en el inventario
        self.assertEqual(self.traspaso(None, a, 3, '101').status_code, 400)
        self.assertEqual(self.traspaso(a, b, 1).status_code, 400)       # la bodega está vacía
        self.assertEqual(self.traspaso(a, a, 1).status_code, 400)
        self.assertEqual(self.traspaso(None, None, 1).status_code, 400)
        self.assertFalse(MovimientoBodega.objects.exists())

    def test_existencias_separadas_y_reemplazo(self):
        primera = self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).json()['id']
        segunda = self.client.post(reverse('bodegas'), {'nombre': 'Sur'}).json()['id']
        for bodega, unidades in [(primera, 5), (segunda, 8), (primera, 3)]:
            r = self.client.put(reverse('stock_bodega', args=[bodega]), {
                'producto': self.producto.id, 'unidades': unidades, 'kilos': '4.50',
            }, format='json')
            self.assertEqual(r.status_code, 200, r.data)
        stock = self.client.get(reverse('stock_productos')).json()[0]
        self.assertEqual(stock['disponibles'], 20)
        self.assertEqual({b['nombre']: b['unidades'] for b in stock['bodegas']}, {'Norte': 3, 'Sur': 8})
        self.assertEqual(EntradaProducto.objects.count(), 1)
        self.assertEqual(StockBodega.objects.count(), 2)

    def test_validacion_y_autenticacion(self):
        r = self.client.post(reverse('bodegas'), {'nombre': 'Norte'})
        bodega = r.json()['id']
        self.assertEqual(self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).status_code, 400)
        for unidades, kilos in [(-1, 2), (1.5, 2), (1, -2), (1, 'NaN')]:
            r = self.client.put(reverse('stock_bodega', args=[bodega]), {
                'producto': self.producto.id, 'unidades': unidades, 'kilos': kilos,
            }, format='json')
            self.assertEqual(r.status_code, 400, r.data)
        self.assertFalse(StockBodega.objects.exists())
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(reverse('bodegas')).status_code, [401, 403])


class PedidoBodegaTests(TestCase):
    def setUp(self):
        from datetime import date
        from .models import Bodega, Cliente, Factura, Proveedor, Vendedor
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='pedidos'))
        self.producto = Producto.objects.create(nombre='Lomo', precio_por_kilo=10000)
        vendedor = Vendedor.objects.create(nombre='V', sigla='V')
        self.cliente = Cliente.objects.create(nombre='C', direccion='x', vendedor=vendedor)
        factura = Factura.objects.create(
            proveedor=Proveedor.objects.create(nombre='P'), fecha=date.today(), numero_factura='F1',
            subtotal=0, iva=0, total=0)
        EntradaProducto.objects.create(
            factura=factura, producto=self.producto, cantidad_kilos=100, cantidad_unidades=20, costo_por_kilo=5000)
        self.bodega = Bodega.objects.create(nombre='Norte')
        StockBodega.objects.create(bodega=self.bodega, producto=self.producto, unidades=5, kilos=10)

    def crear(self, unidades):
        return self.client.post(reverse('crear_pedido'), {
            'cliente': self.cliente.id, 'bodega': self.bodega.id,
            'detalles': [{'producto': self.producto.id, 'cantidad_unidades': unidades, 'cantidad_kilos': 0}],
        }, format='json')

    def test_descuenta_y_devuelve_al_anular(self):
        r = self.crear(3)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['bodega_nombre'], 'Norte')
        self.assertEqual(StockBodega.objects.get().unidades, 2)
        self.client.post(reverse('cancelar_pedido'), {'pedido_id': r.data['id']}, format='json')
        self.assertEqual(StockBodega.objects.get().unidades, 5)

    def test_bodega_sin_stock_suficiente_no_crea_pedido(self):
        from .models import Pedido
        r = self.crear(6)
        self.assertEqual(r.status_code, 400, r.data)
        self.assertFalse(Pedido.objects.exists())
        self.assertEqual(StockBodega.objects.get().unidades, 5)
