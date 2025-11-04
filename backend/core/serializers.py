from rest_framework import serializers
from .models import Producto, Pedido, DetallePedido, Cliente, PagoFactura, Factura, DetalleFactura, Vendedor

class VendedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendedor
        fields = ['id', 'nombre', 'sigla']

class ClienteSerializer(serializers.ModelSerializer):
    vendedor = VendedorSerializer()
    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'vendedor', 'direccion', 'telefono', 'email']

class ProductoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Producto
        fields = ['id', 'nombre', 'descripcion', 'categoria', 'precio_por_kilo', 'estado']

class DetallePedidoSerializer(serializers.ModelSerializer):
    producto = ProductoSerializer()

    class Meta:
        model = DetallePedido
        fields = ['id', 'producto', 'cantidad_unidades', 'cantidad_kilos', 'total_venta', 'total_costo','facturas']

class PedidoSerializer(serializers.ModelSerializer):
    detalles = DetallePedidoSerializer(many=True)
    cliente = ClienteSerializer()
    vendedor = VendedorSerializer()

    class Meta:
        model = Pedido
        fields = ['id', 'cliente', 'vendedor', 'fecha', 'estado', 'detalles', 'total']

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        pedido = Pedido.objects.create(**validated_data)
        for detalle_data in detalles_data:
            DetallePedido.objects.create(pedido=pedido, **detalle_data)
        return pedido

class DetalleFacturaSerializer(serializers.ModelSerializer):
    producto = ProductoSerializer()

    class Meta:
        model = DetalleFactura
        fields = ['producto', 'cantidad_kilos', 'costo_total','cantidad_unidades','costo_por_kilo']

class PagoFacturaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoFactura
        fields = ['fecha_de_pago', 'monto_del_pago']

class FacturaSerializer(serializers.ModelSerializer):
    detalles = DetalleFacturaSerializer(many=True)
    pago_factura = PagoFacturaSerializer(read_only=True)

    class Meta:
        model = Factura
        fields = ['proveedor', 'fecha', 'numero_factura', 'detalles', 'pago_factura', 'total', 'subtotal', 'iva']
