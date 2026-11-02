"""Existencias manuales por ubicación, independientes del inventario de ventas."""
from decimal import Decimal
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Bodega, Producto, StockBodega


class BodegaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bodega
        fields = ['id', 'nombre']


class ExistenciaSerializer(serializers.Serializer):
    producto = serializers.PrimaryKeyRelatedField(queryset=Producto.objects.all())
    unidades = serializers.IntegerField(min_value=0, max_value=2147483647)
    kilos = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0'))


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
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        bodega = get_object_or_404(Bodega, pk=pk)
        serializer = ExistenciaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        registro, _ = StockBodega.objects.update_or_create(
            bodega=bodega, producto=data['producto'],
            defaults={'unidades': data['unidades'], 'kilos': data['kilos']},
        )
        return Response({'unidades': registro.unidades, 'kilos': registro.kilos})
