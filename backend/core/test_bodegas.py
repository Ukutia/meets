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
        self.assertEqual(stock['inventario_unidades'], 20)   # total de todas las ubicaciones
        self.assertEqual(stock['disponibles'], 9)            # la principal: 20 - 3 - 8
        self.assertEqual({b['nombre']: b['unidades'] for b in stock['bodegas']}, {'Norte': 3, 'Sur': 8})
        self.assertEqual(EntradaProducto.objects.count(), 1)
        self.assertEqual(StockBodega.objects.count(), 2)

    def test_ajuste_manual_deja_nota_en_registro(self):
        bodega = self.client.post(reverse('bodegas'), {'nombre': 'Norte'}).json()['id']
        r = self.client.put(reverse('stock_bodega', args=[bodega]), {
            'producto': self.producto.id, 'unidades': 4, 'kilos': '8', 'nota': 'conteo físico'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        m = self.client.get(reverse('traspasos_bodega')).json()[0]
        self.assertEqual((m['origen_nombre'], m['destino_nombre'], m['nota']),
                         ('Bodega principal', 'Norte', 'Ajuste manual: conteo físico'))
        self.assertEqual(self.client.get(reverse('stock_productos')).json()[0]['disponibles'], 16)

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

    def conciliado(self):
        """Stock de la bodega = entradas - salidas del historial, y nada negativo."""
        from django.db.models import Sum
        from .utils import sin_asignar
        e = StockBodega.objects.get()
        ent = MovimientoBodega.objects.filter(destino=self.bodega).aggregate(u=Sum('unidades'), k=Sum('kilos'))
        sal = MovimientoBodega.objects.filter(origen=self.bodega).aggregate(u=Sum('unidades'), k=Sum('kilos'))
        self.assertEqual(e.unidades, (ent['u'] or 0) - (sal['u'] or 0))
        self.assertEqual(e.kilos, (ent['k'] or 0) - (sal['k'] or 0))
        self.assertGreaterEqual(sin_asignar(self.producto)[0], 0)

    def test_venta_y_devolucion_quedan_en_historial(self):
        MovimientoBodega.objects.create(producto=self.producto, origen=None, destino=self.bodega, unidades=5, kilos=10)
        r = self.crear(2)
        self.assertEqual(r.status_code, 201, r.data)
        e = StockBodega.objects.get()
        self.assertEqual((e.unidades, e.kilos), (3, 6))   # los kilos salen en proporción
        self.conciliado()
        self.client.post(reverse('cancelar_pedido'), {'pedido_id': r.data['id']}, format='json')
        e.refresh_from_db()
        self.assertEqual((e.unidades, e.kilos), (5, 10))
        self.conciliado()
        nombres = {m['destino_nombre'] for m in self.client.get(reverse('traspasos_bodega')).json()}
        self.assertIn(f"Pedido #{r.data['id']}", nombres)

    def test_venta_sin_bodega_no_toca_lo_asignado(self):
        # 20 en inventario, 5 en la bodega: sin bodega solo se pueden vender 15.
        r = self.client.post(reverse('crear_pedido'), {
            'cliente': self.cliente.id,
            'detalles': [{'producto': self.producto.id, 'cantidad_unidades': 16, 'cantidad_kilos': 0}],
        }, format='json')
        self.assertEqual(r.status_code, 400, r.data)
        r = self.client.post(reverse('crear_pedido'), {
            'cliente': self.cliente.id,
            'detalles': [{'producto': self.producto.id, 'cantidad_unidades': 15, 'cantidad_kilos': 0}],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(StockBodega.objects.get().unidades, 5)

    def test_editar_linea_mueve_la_bodega(self):
        MovimientoBodega.objects.create(producto=self.producto, origen=None, destino=self.bodega, unidades=5, kilos=10)
        r = self.crear(2)
        linea = r.data['detalles'][0]['id']
        editar = lambda u: self.client.put(reverse('pedido-detail',args=[r.data['id']]), {
            'detalles': [{'id': linea, 'producto': self.producto.id, 'cantidad_unidades': u, 'cantidad_kilos': 0}],
        }, format='json')
        self.assertEqual(editar(4).status_code, 200)
        self.assertEqual(StockBodega.objects.get().unidades, 1)
        self.assertEqual(editar(6).status_code, 400)        # la bodega ya no tiene 2 más
        self.assertEqual(editar(1).status_code, 200)
        self.assertEqual(StockBodega.objects.get().unidades, 4)
        self.conciliado()

    def test_pre_reserva_de_bodega_toma_de_su_bodega(self):
        from .models import DetallePedido
        from .utils import asignar_pre_reservas
        r = self.client.post(reverse('crear_pedido'), {
            'cliente': self.cliente.id, 'bodega': self.bodega.id, 'permitir_pre_reserva': True,
            'detalles': [{'producto': self.producto.id, 'cantidad_unidades': 7, 'cantidad_kilos': 0}],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        d = DetallePedido.objects.get()
        self.assertEqual((d.unidades_pendientes, d.bodega_unidades), (2, 5))
        asignar_pre_reservas(self.producto)          # 15 sin asignar: lo que falta sale de ahí
        d.refresh_from_db()
        self.assertEqual((d.unidades_pendientes, d.bodega_unidades), (0, 5))
        self.assertEqual(StockBodega.objects.get().unidades, 0)

    def test_bodega_sin_stock_suficiente_no_crea_pedido(self):
        from .models import Pedido
        r = self.crear(6)
        self.assertEqual(r.status_code, 400, r.data)
        self.assertFalse(Pedido.objects.exists())
        self.assertEqual(StockBodega.objects.get().unidades, 5)
