from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import EntradaProducto, Producto, StockBodega


class BodegasTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='bodegas'))
        self.producto = Producto.objects.create(nombre='Lomo', precio_por_kilo=10000)

    def test_existencias_separadas_y_reemplazo(self):
        primera = self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).json()['id']
        segunda = self.client.post(reverse('bodegas'), {'nombre': 'Sur'}).json()['id']
        for bodega, unidades in [(primera, 5), (segunda, 8), (primera, 3)]:
            r = self.client.put(reverse('stock_bodega', args=[bodega]), {
                'producto': self.producto.id, 'unidades': unidades, 'kilos': '4.50',
            }, format='json')
            self.assertEqual(r.status_code, 200, r.data)
        stock = self.client.get(reverse('stock_productos')).json()[0]
        self.assertEqual(stock['disponibles'], 0)
        self.assertEqual({b['nombre']: b['unidades'] for b in stock['bodegas']}, {'Norte': 3, 'Sur': 8})
        self.assertFalse(EntradaProducto.objects.exists())
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
