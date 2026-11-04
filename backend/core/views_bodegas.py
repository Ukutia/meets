"""Existencias por ubicación. El total de un producto es su inventario real
(EntradaProducto); cada bodega es un desglose de ese total y lo que no está en
ninguna bodega es "Sin asignar". Las existencias solo cambian con traspasos."""
from decimal import Decimal
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Bodega, EntradaProducto, MovimientoBodega, Producto, StockBodega


class BodegaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bodega
        fields = ['id', 'nombre']


class ExistenciaSerializer(serializers.Serializer):
    producto = serializers.PrimaryKeyRelatedField(queryset=Producto.objects.all())
    unidades = serializers.IntegerField(min_value=0, max_value=2147483647)
    kilos = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0'))


class TraspasoSerializer(serializers.Serializer):
    """origen/destino nulos = "Sin asignar" (inventario fuera de toda bodega)."""
    producto = serializers.PrimaryKeyRelatedField(queryset=Producto.objects.all())
    origen = serializers.PrimaryKeyRelatedField(queryset=Bodega.objects.all(), allow_null=True)
    destino = serializers.PrimaryKeyRelatedField(queryset=Bodega.objects.all(), allow_null=True)
    unidades = serializers.IntegerField(min_value=0, max_value=2147483647)
    kilos = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0'), default=Decimal('0'))
    nota = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if attrs['origen'] == attrs['destino']:
            raise serializers.ValidationError('El origen y el destino deben ser distintos.')
        if attrs['unidades'] == 0 and attrs['kilos'] == 0:
            raise serializers.ValidationError('Indica unidades o kilos a mover.')
        return attrs


def sin_asignar(producto):
    """(unidades, kilos) del inventario que no está en ninguna bodega."""
    ledger = EntradaProducto.objects.filter(producto=producto, congelado=False).aggregate(
        u=Sum('cantidad_unidades'), k=Sum('cantidad_kilos'))
    en_bodegas = StockBodega.objects.filter(producto=producto).aggregate(u=Sum('unidades'), k=Sum('kilos'))
    return ((ledger['u'] or 0) - (en_bodegas['u'] or 0),
            Decimal(ledger['k'] or 0) - Decimal(en_bodegas['k'] or 0))


@transaction.atomic
def traspasar(producto, origen, destino, unidades, kilos, nota='', usuario=None):
    """Mueve existencias de ``origen`` a ``destino`` (None = sin asignar).
    Valida contra lo que de verdad hay en el origen, así el total del producto
    (bodegas + sin asignar) no cambia ni queda negativo."""
    kilos = Decimal(kilos)
    filas = {}
    # Bloquea las filas de ambos lados en orden fijo para evitar carreras.
    for bodega in sorted({b for b in (origen, destino) if b}, key=lambda b: b.pk):
        filas[bodega.pk], _ = StockBodega.objects.select_for_update().get_or_create(
            bodega=bodega, producto=producto)
    if origen is None:
        nombre = 'Sin asignar'
        hay_u, hay_k = sin_asignar(producto)
    else:
        nombre = origen.nombre
        hay_u, hay_k = filas[origen.pk].unidades, filas[origen.pk].kilos
    if unidades > hay_u:
        raise serializers.ValidationError(
            {'unidades': f"'{nombre}' solo tiene {max(hay_u, 0)} unidad(es) de '{producto.nombre}'."})
    if kilos > hay_k:
        raise serializers.ValidationError(
            {'kilos': f"'{nombre}' solo tiene {max(hay_k, 0)} kg de '{producto.nombre}'."})
    if origen is not None:
        fila = filas[origen.pk]
        fila.unidades -= unidades
        fila.kilos -= kilos
        fila.save(update_fields=['unidades', 'kilos'])
    if destino is not None:
        fila = filas[destino.pk]
        fila.unidades += unidades
        fila.kilos += kilos
        fila.save(update_fields=['unidades', 'kilos'])
    return MovimientoBodega.objects.create(
        producto=producto, origen=origen, destino=destino, unidades=unidades,
        kilos=kilos, nota=nota, usuario=usuario)


def movimiento_dict(m):
    return {
        'id': m.id, 'fecha': m.fecha, 'producto': m.producto_id, 'producto_nombre': m.producto.nombre,
        'origen': m.origen_id, 'origen_nombre': m.origen.nombre if m.origen else 'Sin asignar',
        'destino': m.destino_id, 'destino_nombre': m.destino.nombre if m.destino else 'Sin asignar',
        'unidades': m.unidades, 'kilos': m.kilos, 'nota': m.nota,
        'usuario': m.usuario.get_username() if m.usuario else None,
    }


class BodegasView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(BodegaSerializer(Bodega.objects.all(), many=True).data)

    def post(self, request):
        serializer = BodegaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=201)


class ExistenciasBodegaView(APIView):
    """Corrección: fija lo que hay en la bodega; la diferencia entra o sale de
    "Sin asignar", por lo que nunca puede superar el inventario real."""
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        bodega = get_object_or_404(Bodega, pk=pk)
        serializer = ExistenciaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        producto = data['producto']
        with transaction.atomic():
            actual, _ = StockBodega.objects.select_for_update().get_or_create(bodega=bodega, producto=producto)
            du = data['unidades'] - actual.unidades
            dk = data['kilos'] - actual.kilos
            nota = 'Ajuste manual'
            if max(du, 0) or max(dk, 0):
                traspasar(producto, None, bodega, max(du, 0), max(dk, Decimal('0')), nota, request.user)
            if max(-du, 0) or max(-dk, 0):
                traspasar(producto, bodega, None, max(-du, 0), max(-dk, Decimal('0')), nota, request.user)
            actual.refresh_from_db()
        return Response({'unidades': actual.unidades, 'kilos': actual.kilos})


class TraspasosView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        movimientos = MovimientoBodega.objects.select_related('producto', 'origen', 'destino', 'usuario')
        if request.query_params.get('producto'):
            movimientos = movimientos.filter(producto_id=request.query_params['producto'])
        return Response([movimiento_dict(m) for m in movimientos[:200]])

    def post(self, request):
        serializer = TraspasoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        m = traspasar(d['producto'], d['origen'], d['destino'], d['unidades'], d['kilos'], d['nota'], request.user)
        return Response(movimiento_dict(m), status=201)
