from rest_framework import serializers
from .models import Producto, Pedido, DetallePedido, Cliente, PagoFactura, Factura, DetalleFactura, Vendedor, Proveedor

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
        fields = ['id', 'nombre', 'descripcion', 'categoria', 'precio_por_kilo', 'estado', 'peso_minimo']

class DetallePedidoSerializer(serializers.ModelSerializer):
    producto = ProductoSerializer()
    cliente_nombre = serializers.ReadOnlyField(source='pedido.cliente.nombre')
    vendedor_nombre = serializers.ReadOnlyField(source='pedido.vendedor.nombre')


    class Meta:
        model = DetallePedido
        fields = ['id', 'producto', 'cantidad_unidades', 'cantidad_kilos', 'total_venta', 'total_costo','facturas','precio_venta','total_venta','pedido','cliente_nombre','vendedor_nombre']

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


class PagoFacturaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoFactura
        fields = ['fecha_de_pago', 'monto_del_pago']



class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = ['id', 'nombre']


        
class DetalleFacturaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.ReadOnlyField(source='producto.nombre')
    proveedor_nombre = serializers.ReadOnlyField(source='factura.proveedor.nombre')

    class Meta:
        model = DetalleFactura
        fields = ['producto', 'producto_nombre', 'cantidad_kilos', 'cantidad_unidades', 'costo_por_kilo', 'costo_total','factura','proveedor_nombre']

class FacturaSerializer(serializers.ModelSerializer):
    # Eliminamos el source porque ahora coincide con el field name
    detalles = DetalleFacturaSerializer(many=True, read_only=True)
    proveedor_nombre = serializers.ReadOnlyField(source='proveedor.nombre')

    class Meta:
        model = Factura
        fields = [
            'numero_factura', 
            'proveedor', 
            'proveedor_nombre', 
            'fecha', 
            'detalles', 
            'total', 
            'subtotal', 
            'iva', 
            'pago_factura'
        ]