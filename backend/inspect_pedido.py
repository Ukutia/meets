"""Ultimos pedidos de Filete y estado del ledger. Solo lee."""
from django.db.models import Sum
from core.models import DetallePedido, EntradaProducto, FacturaDetallePedido

print("--- ultimos 5 DetallePedido de Filete (producto 1) ---")
for d in (DetallePedido.objects.filter(producto_id=1)
          .select_related('pedido').order_by('-pedido_id')[:5]):
    links = FacturaDetallePedido.objects.filter(detallepedido=d)
    print(f"  pedido={d.pedido_id} estado={d.pedido.estado} "
          f"un={d.cantidad_unidades} kg={d.cantidad_kilos} "
          f"cpk={d.costo_por_kilo} links={links.count()} "
          f"un_links={links.aggregate(t=Sum('cantidad_unidades'))['t'] or 0}")

print("\n--- ledger Filete ---")
for e in EntradaProducto.objects.filter(producto_id=1).order_by('fecha_entrada'):
    print(f"  id={e.id} factura={e.factura_id} un={e.cantidad_unidades} "
          f"kg={e.cantidad_kilos} fecha={e.fecha_entrada}")
tot = EntradaProducto.objects.filter(producto_id=1).aggregate(
    u=Sum('cantidad_unidades'), k=Sum('cantidad_kilos'))
print(f"  TOTAL un={tot['u']} kg={tot['k']}")
