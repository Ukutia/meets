"""Productos de peso fijo: se venden por unidad y los kilos salen de unidades x peso."""
from decimal import Decimal

from django.urls import reverse

from .models import DetallePedido, Producto
from .test_pre_reserva_congelado import BaseStock


class VentaPorUnidadTests(BaseStock):
    def setUp(self):
        super().setUp()
        # Paquete de 0,4 kg a $4.000 c/u -> $10.000/kg. Lote: 10 un, 4 kg, $6.000/kg.
        self.paquete = Producto.objects.create(
            nombre="Paquete", precio_por_kilo=Decimal("10000"), peso_unidad=Decimal("0.4"))
        r = self.crear_factura("200", 10, 4, 6000, producto=self.paquete)
        self.assertEqual(r.status_code, 201, r.content)

    def test_precio_unidad_se_guarda_como_precio_por_kilo(self):
        r = self.client.post(reverse("crear_producto"), {
            "nombre": "Hamburguesa", "peso_unidad": "0.125", "precio_unidad": "1500",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Decimal(r.json()["precio_por_kilo"]), Decimal("12000.00"))
        self.assertEqual(Decimal(r.json()["precio_unidad"]), Decimal("1500.00"))

    def test_actualizar_producto_por_unidad(self):
        r = self.client.put(reverse("actualizar_producto", args=[self.paquete.id]), {
            "peso_unidad": "0.5", "precio_unidad": "5000"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.paquete.refresh_from_db()
        self.assertEqual(self.paquete.precio_por_kilo, Decimal("10000.00"))

    def test_pedido_por_unidad_queda_pesado_sin_bascula(self):
        pedido = self.pedido_ok(3, producto=self.paquete)
        self.assertEqual(pedido["estado"], "Preparado")
        d = DetallePedido.objects.get(pedido_id=pedido["id"])
        self.assertEqual(d.cantidad_kilos, Decimal("1.20"))
        self.assertEqual(d.total_venta, Decimal("12000.00"))
        self.assertEqual(d.total_costo, Decimal("7200.00"))
        # El ledger baja unidades y kilos.
        self.assertEqual(self.ledger(producto=self.paquete), (7, Decimal("2.80")))

    def test_kilos_enviados_se_ignoran(self):
        pedido = self.pedido_ok(2, kilos=9, producto=self.paquete)
        self.assertEqual(DetallePedido.objects.get(pedido_id=pedido["id"]).cantidad_kilos, Decimal("0.80"))

    def test_producto_por_kilo_sigue_igual(self):
        pedido = self.pedido_ok(2)
        self.assertEqual(pedido["estado"], "Reservado")

    def test_editar_unidades_recalcula_kilos_y_stock(self):
        pedido = self.pedido_ok(3, producto=self.paquete)
        d = DetallePedido.objects.get(pedido_id=pedido["id"])
        r = self.client.put(reverse("pedido-detail", args=[pedido["id"]]), {
            "detalles": [{"id": d.id, "producto": self.paquete.id, "cantidad_unidades": 5, "cantidad_kilos": 0}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        d.refresh_from_db()
        self.assertEqual(d.cantidad_kilos, Decimal("2.00"))
        self.assertEqual(d.total_venta, Decimal("20000.00"))
        self.assertEqual(self.ledger(producto=self.paquete), (5, Decimal("2.00")))

    def test_pre_reserva_por_unidad_queda_sin_pesar(self):
        pedido = self.pedido_ok(12, producto=self.paquete, pre_reserva=True)
        d = DetallePedido.objects.get(pedido_id=pedido["id"])
        self.assertEqual(d.unidades_pendientes, 2)
        self.assertEqual(d.cantidad_kilos, Decimal("0"))
        self.assertEqual(pedido["estado"], "Pre-reserva")
