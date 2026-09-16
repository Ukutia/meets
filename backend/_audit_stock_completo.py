import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db.models import Sum
from core.models import Producto, DetalleFactura, DetallePedido, EntradaProducto

def _sum(qs, campo):
    return qs.aggregate(t=Sum(campo))['t'] or 0

print(f"{'producto':30s} {'comprado':>9s} {'vendido':>9s} {'objetivo':>9s} {'ledger':>9s} {'delta':>7s}")
print('-' * 80)

discrepancias = []
for p in Producto.objects.all().order_by('nombre'):
    comprado = int(_sum(DetalleFactura.objects.filter(producto=p), 'cantidad_unidades'))
    vendido = int(_sum(
        DetallePedido.objects.filter(producto=p).exclude(pedido__estado="Anulado"),
        'cantidad_unidades'
    ))
    objetivo = comprado - vendido
    actual = int(_sum(EntradaProducto.objects.filter(producto=p), 'cantidad_unidades'))
    delta = actual - objetivo

    if delta != 0:
        discrepancias.append((p, comprado, vendido, objetivo, actual, delta))
        print(f"{p.nombre[:30]:30s} {comprado:9d} {vendido:9d} {objetivo:9d} {actual:9d} {delta:+7d}")

print('-' * 80)
print(f"Total productos con discrepancia: {len(discrepancias)}")
print(f"Productos con ledger POR DEBAJO del objetivo (stock perdido, como Tapabarriga): "
      f"{sum(1 for *_, d in discrepancias if d < 0)}")
print(f"Productos con ledger POR ENCIMA del objetivo (stock inflado): "
      f"{sum(1 for *_, d in discrepancias if d > 0)}")
