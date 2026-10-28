"""Pre-reservas (venta sin stock) y stock congelado, siempre via los endpoints HTTP."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Sum
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .models import (Cliente, DetalleFactura, DetallePedido, EntradaProducto, FacturaDetallePedido,
                     MovimientoCongelado, Pedido, Producto, Proveedor, Vendedor)


class BaseStock(TestCase):
    """Un producto con una factura (100): 10 unidades, 20 kg, 8.000/kg."""

    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.vendedor = Vendedor.objects.create(nombre="Ana", sigla="AN")
        self.cliente = Cliente.objects.create(nombre="Cliente", direccion="x", vendedor=self.vendedor)
        self.proveedor = Proveedor.objects.create(nombre="Frigorífico")
        self.producto = Producto.objects.create(nombre="Lomo", precio_por_kilo=Decimal("12000"))
        r = self.crear_factura("100", 10, 20, 8000, fecha="2026-10-01")
        self.assertEqual(r.status_code, 201, r.content)

    # ---- helpers ----
    def crear_factura(self, numero, unidades, kilos, costo, producto=None, fecha="2026-10-02"):
        producto = producto or self.producto
        return self.client.post(reverse("crear_factura"), {
            "numero_factura": numero, "proveedor": self.proveedor.id, "fecha": fecha,
            "subtotal": 1, "iva": 0, "total": 1,
            "detalles": [{"producto": producto.id, "cantidad_kilos": kilos,
                          "cantidad_unidades": unidades, "costo_por_kilo": costo}],
        }, format="json")

    def pedido(self, unidades, kilos=0, producto=None, pre_reserva=False, **linea):
        producto = producto or self.producto
        detalle = {"producto": producto.id, "cantidad_kilos": kilos, "cantidad_unidades": unidades, **linea}
        payload = {"cliente": self.cliente.id, "detalles": [detalle]}
        if pre_reserva:
            payload["permitir_pre_reserva"] = True
        return self.client.post(reverse("crear_pedido"), payload, format="json")

    def pedido_ok(self, *args, **kwargs):
        r = self.pedido(*args, **kwargs)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def stock(self, producto=None):
        producto = producto or self.producto
        return next(p for p in self.client.get(reverse("stock_productos")).json() if p["id"] == producto.id)

    def ledger(self, congelado=False, producto=None):
        qs = EntradaProducto.objects.filter(producto=producto or self.producto, congelado=congelado)
        agg = qs.aggregate(u=Sum("cantidad_unidades"), k=Sum("cantidad_kilos"))
        return agg["u"] or 0, agg["k"] or Decimal("0")

    def linea(self, pedido_id):
        return DetallePedido.objects.get(pedido_id=pedido_id)

    def agotar_stock(self):
        """Vende todo el stock normal (10 un) con un pedido normal."""
        self.pedido_ok(10)
        self.assertEqual(self.ledger()[0], 0)

    def mover(self, unidades, direccion="congelar", **extra):
        return self.client.post(reverse("movimientos_congelado"), {
            "producto": self.producto.id, "cantidad_unidades": unidades, "direccion": direccion, **extra,
        }, format="json")

    def put_pedido(self, pedido_id, unidades, kilos=0, **extra):
        det = DetallePedido.objects.get(pedido_id=pedido_id)
        return self.client.put(reverse("pedido-detail", args=[pedido_id]), {
            "detalles": [{"id": det.id, "producto": det.producto_id, "cantidad_unidades": unidades,
                          "cantidad_kilos": kilos}], **extra,
        }, format="json")


class PreReservaPedidoTests(BaseStock):
    def test_sin_flag_pedir_mas_que_el_stock_falla(self):
        r = self.pedido(11)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.count(), 0)
        self.assertEqual(DetallePedido.objects.count(), 0)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_con_flag_toma_lo_disponible_y_deja_pendiente(self):
        p = self.pedido_ok(14, pre_reserva=True)
        self.assertEqual(p["estado"], "Pre-reserva")
        linea = self.linea(p["id"])
        self.assertEqual((linea.cantidad_unidades, linea.unidades_pendientes), (14, 4))
        self.assertEqual(FacturaDetallePedido.objects.get(detallepedido=linea).cantidad_unidades, 10)
        self.assertEqual(self.ledger()[0], 0)
        s = self.stock()
        self.assertEqual((s["disponibles"], s["pre_reservas"], s["reservas"]), (0, 4, 10))

    def test_producto_sin_stock_se_pre_reserva_completo(self):
        self.agotar_stock()
        p = self.pedido_ok(3, pre_reserva=True)
        linea = self.linea(p["id"])
        self.assertEqual(p["estado"], "Pre-reserva")
        self.assertEqual(linea.unidades_pendientes, 3)
        self.assertFalse(FacturaDetallePedido.objects.filter(detallepedido=linea).exists())
        s = self.stock()
        self.assertEqual((s["disponibles"], s["pre_reservas"], s["reservas"]), (0, 3, 10))

    def test_pre_reserva_con_kilos_falla(self):
        r = self.pedido(12, kilos=24, pre_reserva=True)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.count(), 0)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_pre_reserva_solo_con_stock_congelado_no_lo_toca(self):
        self.assertEqual(self.mover(10).status_code, 201)
        p = self.pedido_ok(2, pre_reserva=True)
        self.assertEqual(self.linea(p["id"]).unidades_pendientes, 2)
        self.assertEqual(self.ledger(congelado=True)[0], 10)


class AsignarPreReservasTests(BaseStock):
    def test_factura_nueva_asigna_por_antiguedad(self):
        self.agotar_stock()
        a = self.pedido_ok(4, pre_reserva=True)["id"]
        b = self.pedido_ok(4, pre_reserva=True)["id"]
        r = self.crear_factura("101", 10, 20, 9000)
        self.assertEqual(r.status_code, 201, r.content)
        asign = r.json()["pre_reservas_asignadas"]
        self.assertEqual([(x["pedido"], x["unidades"], x["completa"]) for x in asign],
                         [(a, 4, True), (b, 4, True)])
        for pid in (a, b):
            self.assertEqual(self.linea(pid).unidades_pendientes, 0)
            self.assertEqual(Pedido.objects.get(id=pid).estado, "Reservado")
            link = FacturaDetallePedido.objects.get(detallepedido__pedido_id=pid)
            self.assertEqual((link.factura_id, link.cantidad_unidades), ("101", 4))
        self.assertEqual(self.stock()["disponibles"], 2)
        self.assertEqual(self.ledger()[0], 2)

    def test_asignacion_parcial_sirve_primero_al_mas_antiguo(self):
        self.agotar_stock()
        a = self.pedido_ok(4, pre_reserva=True)["id"]
        b = self.pedido_ok(4, pre_reserva=True)["id"]
        r = self.crear_factura("101", 6, 12, 9000)
        asign = r.json()["pre_reservas_asignadas"]
        self.assertEqual([(x["pedido"], x["unidades"], x["completa"]) for x in asign],
                         [(a, 4, True), (b, 2, False)])
        self.assertEqual(Pedido.objects.get(id=a).estado, "Reservado")
        self.assertEqual(Pedido.objects.get(id=b).estado, "Pre-reserva")
        self.assertEqual(self.linea(b).unidades_pendientes, 2)
        self.assertEqual(self.stock()["disponibles"], 0)
        self.assertEqual(self.stock()["pre_reservas"], 2)

    def test_costo_por_kilo_de_la_linea_queda_ponderado(self):
        p = self.pedido_ok(14, pre_reserva=True)["id"]
        self.assertEqual(self.linea(p).costo_por_kilo, Decimal("8000"))
        self.crear_factura("101", 4, 8, 10000)
        linea = self.linea(p)
        # (10 * 8000 + 4 * 10000) / 14
        self.assertAlmostEqual(float(linea.costo_por_kilo), 8571.43, places=2)
        self.assertEqual(linea.unidades_pendientes, 0)
        self.assertEqual({(f.factura_id, f.cantidad_unidades) for f in FacturaDetallePedido.objects.filter(detallepedido=linea)},
                         {("100", 10), ("101", 4)})
        self.assertEqual(Pedido.objects.get(id=p).estado, "Reservado")

    def test_modo_costo_sin_stock_fija_precio_con_la_factura(self):
        self.agotar_stock()
        p = self.pedido_ok(2, pre_reserva=True, modo_precio="costo")["id"]
        self.assertEqual(self.linea(p).precio_venta, Decimal("12000"))
        self.crear_factura("101", 5, 10, 9000)
        linea = self.linea(p)
        self.assertEqual(linea.precio_venta, Decimal("10710"))  # ceil(9000 * 1,19)
        self.assertEqual(linea.costo_por_kilo, Decimal("9000"))

    def test_editar_factura_subiendo_unidades_asigna_pre_reservas(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        # Factura con línea en 0: el producto existe en la factura pero sin stock.
        self.assertEqual(self.crear_factura("200", 0, 0, 5000, producto=otro).status_code, 201)
        p = self.pedido_ok(3, producto=otro, pre_reserva=True)["id"]
        self.assertEqual(self.linea(p).unidades_pendientes, 3)

        det = DetalleFactura.objects.get(factura_id="200", producto=otro)
        r = self.client.put(reverse("actualizar_factura", args=["200"]), {
            "detalles": [{"id": det.id, "cantidad_unidades": 5, "cantidad_kilos": 10, "costo_por_kilo": 5000}],
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        linea = self.linea(p)
        self.assertEqual(linea.unidades_pendientes, 0)
        self.assertEqual(FacturaDetallePedido.objects.get(detallepedido=linea).factura_id, "200")
        self.assertEqual(Pedido.objects.get(id=p).estado, "Reservado")
        self.assertEqual(self.ledger(producto=otro)[0], 2)


class EditarPedidoPreReservaTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.pid = self.pedido_ok(13, pre_reserva=True)["id"]  # 10 con stock, 3 pendientes

    def test_bajar_unidades_descuenta_primero_pendientes(self):
        r = self.put_pedido(self.pid, 11)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((self.linea(self.pid).unidades_pendientes, self.ledger()[0]), (1, 0))
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Pre-reserva")
        r = self.put_pedido(self.pid, 10)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((self.linea(self.pid).unidades_pendientes, self.ledger()[0]), (0, 0))
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Reservado")

    def test_subir_unidades_sin_stock_suma_pendientes(self):
        r = self.put_pedido(self.pid, 16)
        self.assertEqual(r.status_code, 200, r.content)
        linea = self.linea(self.pid)
        self.assertEqual((linea.cantidad_unidades, linea.unidades_pendientes), (16, 6))
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.stock()["pre_reservas"], 6)

    def test_pasar_a_preparado_con_pendientes_falla(self):
        r = self.put_pedido(self.pid, 13, estado="Preparado")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Pedido.objects.get(id=self.pid).estado, "Pre-reserva")

    def test_pesar_con_pendientes_falla(self):
        r = self.client.post(reverse("actualizar_kilos_pedido", args=[self.pid]),
                             {"detalles": [{"producto": self.producto.id, "cantidad_kilos": 26}]}, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        r = self.put_pedido(self.pid, 13, kilos=26)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.linea(self.pid).cantidad_kilos, 0)
        self.assertEqual(self.ledger(), (0, Decimal("20")))


class CancelarPreReservaTests(BaseStock):
    def test_cancelar_unica_linea_pendiente_vuelve_a_reservado(self):
        otro = Producto.objects.create(nombre="Asado", precio_por_kilo=Decimal("9000"))
        self.crear_factura("200", 5, 10, 5000, producto=otro)
        r = self.client.post(reverse("crear_pedido"), {"cliente": self.cliente.id, "permitir_pre_reserva": True,
                                                       "detalles": [
            {"producto": otro.id, "cantidad_kilos": 0, "cantidad_unidades": 1},
            {"producto": self.producto.id, "cantidad_kilos": 0, "cantidad_unidades": 12},
        ]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["id"]
        self.assertEqual(r.json()["estado"], "Pre-reserva")
        lomo = DetallePedido.objects.get(pedido_id=pid, producto=self.producto)
        r = self.client.post(reverse("cancelar_producto_pedido"),
                             {"pedido_id": pid, "detalle_id": lomo.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["estado"], "Reservado")
        self.assertEqual(self.ledger()[0], 10)
        self.assertEqual(self.stock()["pre_reservas"], 0)

    def test_cancelar_pedido_devuelve_solo_lo_asignado_y_no_recibe_facturas(self):
        pid = self.pedido_ok(13, pre_reserva=True)["id"]
        r = self.client.post(reverse("cancelar_pedido"), {"pedido_id": pid}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger()[0], 10)
        self.assertEqual(Pedido.objects.get(id=pid).estado, "Anulado")
        self.assertEqual(self.stock()["pre_reservas"], 0)

        r = self.crear_factura("101", 5, 10, 9000)
        self.assertEqual(r.json()["pre_reservas_asignadas"], [])
        self.assertEqual(self.ledger()[0], 15)
        self.assertEqual(self.linea(pid).unidades_pendientes, 3)
        self.assertEqual(FacturaDetallePedido.objects.filter(factura_id="101").count(), 0)


class CongelarTests(BaseStock):
    def test_congelar_sin_kilos_usa_promedio_y_mantiene_lote(self):
        r = self.mover(4, razon="camara")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("8.00")))
        lote = EntradaProducto.objects.get(producto=self.producto, congelado=True)
        original = EntradaProducto.objects.get(producto=self.producto, congelado=False)
        self.assertEqual((lote.factura_id, lote.costo_por_kilo, lote.fecha_entrada),
                         ("100", Decimal("8000"), original.fecha_entrada))
        mov = MovimientoCongelado.objects.get()
        self.assertEqual((mov.direccion, mov.cantidad_unidades, mov.cantidad_kilos, mov.usuario), (
            "congelar", 4, Decimal("8.00"), self.user))
        s = self.stock()
        self.assertEqual((s["disponibles"], s["kilos_actuales"], s["congelado_unidades"], s["congelado_kilos"]),
                         (6, 12, 4, 8))

    def test_congelar_con_kilos_explicitos_mueve_exactamente_esos_kilos(self):
        r = self.mover(4, cantidad_kilos="7.35")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Decimal(r.json()["cantidad_kilos"]), Decimal("7.35"))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("7.35")))
        self.assertEqual(self.ledger(), (6, Decimal("12.65")))

    def test_congelar_es_fifo_entre_lotes_y_conserva_factura_y_costo(self):
        self.crear_factura("101", 5, 12, 9000, fecha="2026-10-05")
        self.assertEqual(self.mover(12).status_code, 201)
        lotes = {e.factura_id: e for e in EntradaProducto.objects.filter(producto=self.producto, congelado=True)}
        self.assertEqual((lotes["100"].cantidad_unidades, lotes["100"].costo_por_kilo), (10, Decimal("8000")))
        self.assertEqual((lotes["101"].cantidad_unidades, lotes["101"].costo_por_kilo), (2, Decimal("9000")))
        self.assertEqual(lotes["101"].cantidad_kilos, Decimal("4.80"))
        self.assertEqual(self.ledger()[0], 3)

    def test_mover_mas_de_lo_disponible_falla(self):
        r = self.mover(11)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(), (10, Decimal("20")))
        self.assertEqual(MovimientoCongelado.objects.count(), 0)

    def test_unidades_cero_falla(self):
        self.assertEqual(self.mover(0).status_code, 400)
        self.assertEqual(MovimientoCongelado.objects.count(), 0)

    def test_kilos_mayores_a_los_del_lote_fallan(self):
        self.assertEqual(self.mover(2, cantidad_kilos=50).status_code, 400)
        self.assertEqual(self.ledger(), (10, Decimal("20")))

    def test_descongelar_devuelve_al_inventario(self):
        self.mover(4)
        r = self.mover(3, direccion="descongelar")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (9, Decimal("18.00")))
        self.assertEqual(self.ledger(congelado=True), (1, Decimal("2.00")))
        self.assertEqual(MovimientoCongelado.objects.filter(direccion="descongelar").count(), 1)
        self.assertEqual(self.mover(2, direccion="descongelar").status_code, 400)

    def test_descongelar_cubre_pre_reservas_pendientes(self):
        self.mover(10)
        pid = self.pedido_ok(3, pre_reserva=True)["id"]
        r = self.mover(5, direccion="descongelar")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual([(a["pedido"], a["unidades"], a["completa"]) for a in r.json()["pre_reservas_asignadas"]],
                         [(pid, 3, True)])
        self.assertEqual(self.linea(pid).unidades_pendientes, 0)
        self.assertEqual(Pedido.objects.get(id=pid).estado, "Reservado")
        self.assertEqual((self.ledger()[0], self.ledger(congelado=True)[0]), (2, 5))


class VentaCongeladoTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.mover(4)  # normal: 6 un / 12 kg; congelado: 4 un / 8 kg

    def test_venta_normal_no_consume_congelado(self):
        self.mover(6)
        self.assertEqual(self.ledger()[0], 0)
        r = self.pedido(1)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 10)
        self.assertEqual(Pedido.objects.count(), 0)

    def test_venta_congelado_consume_solo_lotes_congelados(self):
        p = self.pedido_ok(2, congelado=True)
        self.assertTrue(self.linea(p["id"]).congelado)
        self.assertEqual(self.ledger(congelado=True)[0], 2)
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        s = self.stock()
        self.assertEqual((s["disponibles"], s["congelado_unidades"], s["congelado_reservas"]), (6, 2, 2))

    def test_venta_congelado_mas_de_lo_que_hay_falla_aun_con_pre_reserva(self):
        r = self.pedido(5, congelado=True, pre_reserva=True)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)

    def test_pesar_descuenta_kilos_solo_del_congelado(self):
        p = self.pedido_ok(2, congelado=True)["id"]
        r = self.client.post(reverse("actualizar_kilos_pedido", args=[p]),
                             {"detalles": [{"producto": self.producto.id, "cantidad_kilos": "3.5"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger(congelado=True), (2, Decimal("4.50")))
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        s = self.stock()
        self.assertEqual((s["kilos_actuales"], s["congelado_kilos"]), (12, 4.5))

    def test_cancelar_venta_congelado_devuelve_al_pool_congelado(self):
        p = self.pedido_ok(2, kilos="3.5", congelado=True)["id"]
        self.assertEqual(self.ledger(congelado=True), (2, Decimal("4.50")))
        r = self.client.post(reverse("cancelar_pedido"), {"pedido_id": p}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)
        self.assertEqual(self.ledger(congelado=True)[1], Decimal("8.00"))
        self.assertEqual(self.ledger(), (6, Decimal("12.00")))
        self.assertFalse(EntradaProducto.objects.filter(producto=self.producto, congelado=False)
                         .exclude(cantidad_unidades=6).exists())

    def test_merma_solo_toca_inventario_normal(self):
        r = self.client.post(reverse("crear_ajuste_inventario"), {
            "producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 2, "cantidad": 3,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.ledger(), (4, Decimal("9.00")))
        self.assertEqual(self.ledger(congelado=True), (4, Decimal("8.00")))

    def test_merma_mayor_al_normal_no_come_congelado(self):
        r = self.client.post(reverse("crear_ajuste_inventario"), {
            "producto": self.producto.id, "tipo": "merma", "cantidad_unidades": 7,
        }, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger(congelado=True)[0], 4)


class EditarFacturaConCongeladoTests(BaseStock):
    def setUp(self):
        super().setUp()
        self.mover(4)
        self.pedido_ok(3)  # consumidas = 3; congeladas = 4
        self.det = DetalleFactura.objects.get(factura_id="100")

    def editar(self, unidades, costo=8000, kilos=20):
        return self.client.put(reverse("actualizar_factura", args=["100"]), {
            "detalles": [{"id": self.det.id, "cantidad_unidades": unidades,
                          "cantidad_kilos": kilos, "costo_por_kilo": costo}],
        }, format="json")

    def test_bajar_bajo_consumidas_mas_congeladas_falla(self):
        r = self.editar(6)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self.ledger()[0], 3)
        self.assertEqual(self.ledger(congelado=True)[0], 4)
        self.assertEqual(DetalleFactura.objects.get(id=self.det.id).cantidad_unidades, 10)

    def test_bajar_hasta_el_piso_es_valido_y_no_toca_lo_congelado(self):
        r = self.editar(7, kilos=14)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.ledger()[0], 0)
        self.assertEqual(self.ledger(congelado=True)[0], 4)

    def test_cambio_de_costo_se_propaga_al_lote_congelado(self):
        r = self.editar(10, costo=9500)
        self.assertEqual(r.status_code, 200, r.content)
        costos = set(EntradaProducto.objects.filter(producto=self.producto, congelado=True)
                     .values_list("costo_por_kilo", flat=True))
        self.assertEqual(costos, {Decimal("9500")})
        self.assertEqual(EntradaProducto.objects.get(producto=self.producto, congelado=False).costo_por_kilo,
                         Decimal("9500"))
