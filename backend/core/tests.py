from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from .models import (
    Producto, Proveedor, Factura, EntradaProducto, Cliente, Vendedor, DetallePedido,
)


class AjusteInventarioExcesoTests(TestCase):
    """Regresion: un ajuste de exceso debe sumar stock real (StockProductos),
    no solo quedar como registro contable."""

    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.producto = Producto.objects.create(
            nombre="Puntas de Ganso", precio_por_kilo=Decimal("10000")
        )
        proveedor = Proveedor.objects.create(nombre="Proveedor Test")
        factura = Factura.objects.create(
            proveedor=proveedor,
            fecha="2026-01-01",
            numero_factura="F-TEST-001",
            subtotal=Decimal("0"),
            iva=Decimal("0"),
            total=Decimal("0"),
        )
        EntradaProducto.objects.create(
            factura=factura,
            producto=self.producto,
            cantidad_kilos=Decimal("100"),
            cantidad_unidades=36,
            costo_por_kilo=Decimal("8000"),
        )

    def test_exceso_suma_stock_real(self):
        stock_antes = self.client.get(reverse("stock_productos")).json()
        unidades_antes = next(p for p in stock_antes if p["id"] == self.producto.id)["stock"]
        self.assertEqual(unidades_antes, 36)

        resp = self.client.post(
            reverse("crear_ajuste_inventario"),
            {"producto": self.producto.id, "tipo": "exceso", "cantidad_unidades": 1},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

        stock_despues = self.client.get(reverse("stock_productos")).json()
        unidades_despues = next(p for p in stock_despues if p["id"] == self.producto.id)["stock"]
        self.assertEqual(unidades_despues, 37)


class DescuentoPorKiloPorProductoTests(TestCase):
    """El descuento por kilo se aplica POR PRODUCTO dentro del pedido.

    Cada linea puede tener su propio descuento (o ninguno) y el precio de las
    demas lineas no se toca: antes el descuento era del pedido completo y
    abarataba todos los productos por igual.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="tester_desc", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        vendedor = Vendedor.objects.create(nombre="Vendedor Test", sigla="VT")
        self.cliente = Cliente.objects.create(
            nombre="Cliente Test", vendedor=vendedor, direccion="Calle 1"
        )

        proveedor = Proveedor.objects.create(nombre="Proveedor Test")
        self.factura = Factura.objects.create(
            proveedor=proveedor,
            fecha="2026-01-01",
            numero_factura="F-DESC-001",
            subtotal=Decimal("0"),
            iva=Decimal("0"),
            total=Decimal("0"),
        )

        self.lomo = self._producto_con_stock("Lomo Vetado", Decimal("10000"))
        self.asado = self._producto_con_stock("Asado de Tira", Decimal("8000"))

    def _producto_con_stock(self, nombre, precio):
        producto = Producto.objects.create(nombre=nombre, precio_por_kilo=precio)
        EntradaProducto.objects.create(
            factura=self.factura,
            producto=producto,
            cantidad_kilos=Decimal("100"),
            cantidad_unidades=20,
            costo_por_kilo=Decimal("5000"),
        )
        return producto

    def _crear_pedido(self, detalles, **extra):
        payload = {"cliente": self.cliente.id, "detalles": detalles}
        payload.update(extra)
        return self.client.post(reverse("crear_pedido"), payload, format="json")

    def test_descuento_solo_afecta_al_producto_que_lo_trae(self):
        resp = self._crear_pedido([
            {
                "producto": self.lomo.id,
                "cantidad_kilos": "2",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "1500",
            },
            {"producto": self.asado.id, "cantidad_kilos": "3", "cantidad_unidades": 1},
        ])
        self.assertEqual(resp.status_code, 201, resp.content)

        detalles = {d["producto"]["nombre"]: d for d in resp.json()["detalles"]}

        con_descuento = detalles["Lomo Vetado"]
        self.assertEqual(Decimal(con_descuento["descuento_por_kilo"]), Decimal("1500.00"))
        self.assertEqual(Decimal(con_descuento["precio_venta"]), Decimal("8500.00"))
        self.assertEqual(Decimal(con_descuento["total_venta"]), Decimal("17000.00"))

        sin_descuento = detalles["Asado de Tira"]
        self.assertEqual(Decimal(sin_descuento["descuento_por_kilo"]), Decimal("0.00"))
        self.assertEqual(Decimal(sin_descuento["precio_venta"]), Decimal("8000.00"))
        self.assertEqual(Decimal(sin_descuento["total_venta"]), Decimal("24000.00"))

        # 17.000 (lomo con descuento) + 24.000 (asado a precio de lista)
        self.assertEqual(Decimal(resp.json()["total"]), Decimal("41000.00"))

    def test_descuento_mayor_al_precio_deja_la_linea_en_cero(self):
        resp = self._crear_pedido([
            {
                "producto": self.lomo.id,
                "cantidad_kilos": "2",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "99999",
            },
        ])
        self.assertEqual(resp.status_code, 201, resp.content)
        detalle = resp.json()["detalles"][0]
        self.assertEqual(Decimal(detalle["precio_venta"]), Decimal("0.00"))
        self.assertEqual(Decimal(detalle["total_venta"]), Decimal("0.00"))

    def test_descuento_negativo_es_rechazado(self):
        resp = self._crear_pedido([
            {
                "producto": self.lomo.id,
                "cantidad_kilos": "2",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "-100",
            },
        ])
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("negativo", resp.json()["error"])
        self.assertEqual(DetallePedido.objects.count(), 0)

    def test_descuento_del_pedido_sigue_valiendo_como_default(self):
        """Compatibilidad: un cliente antiguo manda el descuento a nivel de pedido."""
        resp = self._crear_pedido(
            [
                {"producto": self.lomo.id, "cantidad_kilos": "1", "cantidad_unidades": 1},
                {
                    "producto": self.asado.id,
                    "cantidad_kilos": "1",
                    "cantidad_unidades": 1,
                    "descuento_por_kilo": "0",
                },
            ],
            descuento_por_kilo="1000",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        detalles = {d["producto"]["nombre"]: d for d in resp.json()["detalles"]}

        # Sin descuento propio hereda el default del pedido...
        self.assertEqual(Decimal(detalles["Lomo Vetado"]["precio_venta"]), Decimal("9000.00"))
        # ...pero una linea que pide explicitamente 0 queda a precio de lista.
        self.assertEqual(Decimal(detalles["Asado de Tira"]["precio_venta"]), Decimal("8000.00"))

    def test_editar_descuento_de_una_linea_recalcula_su_precio_y_total(self):
        creado = self._crear_pedido([
            {
                "producto": self.lomo.id,
                "cantidad_kilos": "2",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "1000",
            },
        ]).json()
        pedido_id = creado["id"]

        resp = self.client.put(
            reverse("pedido-detail", args=[pedido_id]),
            {
                "detalles": [
                    {
                        "producto": self.lomo.id,
                        "cantidad_kilos": "2",
                        "cantidad_unidades": 1,
                        "descuento_por_kilo": "2000",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        detalle = resp.json()["detalles"][0]
        # El precio de lista (10.000) se reconstruye desde la linea, no se relee
        # del producto: 10.000 - 2.000 = 8.000.
        self.assertEqual(Decimal(detalle["precio_venta"]), Decimal("8000.00"))
        self.assertEqual(Decimal(detalle["total_venta"]), Decimal("16000.00"))
        self.assertEqual(Decimal(resp.json()["total"]), Decimal("16000.00"))

    def test_quitar_el_descuento_al_editar_vuelve_al_precio_de_lista(self):
        creado = self._crear_pedido([
            {
                "producto": self.lomo.id,
                "cantidad_kilos": "1",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "2500",
            },
        ]).json()

        resp = self.client.put(
            reverse("pedido-detail", args=[creado["id"]]),
            {
                "detalles": [
                    {
                        "producto": self.lomo.id,
                        "cantidad_kilos": "1",
                        "cantidad_unidades": 1,
                        "descuento_por_kilo": "0",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        detalle = resp.json()["detalles"][0]
        self.assertEqual(Decimal(detalle["descuento_por_kilo"]), Decimal("0.00"))
        self.assertEqual(Decimal(detalle["precio_venta"]), Decimal("10000.00"))

    def test_agregar_producto_a_pedido_acepta_su_propio_descuento(self):
        creado = self._crear_pedido([
            {"producto": self.lomo.id, "cantidad_kilos": "1", "cantidad_unidades": 1},
        ]).json()

        resp = self.client.post(
            reverse("agregar_producto_pedido"),
            {
                "pedido_id": creado["id"],
                "producto_id": self.asado.id,
                "cantidad_kilos": "2",
                "cantidad_unidades": 1,
                "descuento_por_kilo": "500",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        detalles = {d["producto"]["nombre"]: d for d in resp.json()["detalles"]}
        self.assertEqual(Decimal(detalles["Asado de Tira"]["precio_venta"]), Decimal("7500.00"))
        self.assertEqual(Decimal(detalles["Asado de Tira"]["total_venta"]), Decimal("15000.00"))
        # La linea que ya estaba en el pedido no cambia de precio.
        self.assertEqual(Decimal(detalles["Lomo Vetado"]["precio_venta"]), Decimal("10000.00"))
