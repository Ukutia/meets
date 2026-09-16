import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db import transaction
from django.db.models import Sum
from core.models import Producto, DetalleFactura, DetallePedido, EntradaProducto
from core.utils import restituir_unidades_fifo

def _sum(qs, campo):
    return qs.aggregate(t=Sum(campo))['t'] or 0

nombres = ['Entraña', 'Filete', 'Hamburguesa 125 grs', 'Longaniza', 'Punta De Ganso', 'Punta de Picana']

with transaction.atomic():
    for nombre in nombres:
        p = Producto.objects.get(nombre=nombre)
        comprado = int(_sum(DetalleFactura.objects.filter(producto=p), 'cantidad_unidades'))
        vendido = int(_sum(
            DetallePedido.objects.filter(producto=p).exclude(pedido__estado="Anulado"),
            'cantidad_unidades'
        ))
        objetivo = comprado - vendido
        actual = int(_sum(EntradaProducto.objects.filter(producto=p), 'cantidad_unidades'))
        delta = objetivo - actual

        if delta <= 0:
            print(f"{p.nombre}: sin deficit (objetivo={objetivo} actual={actual}), se omite")
            continue

        devuelto = restituir_unidades_fifo(p, delta)
        nuevo = int(_sum(EntradaProducto.objects.filter(producto=p), 'cantidad_unidades'))
        print(f"{p.nombre}: +{devuelto} un  ({actual} -> {nuevo}, objetivo={objetivo})")
