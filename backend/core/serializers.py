from decimal import Decimal

from rest_framework import serializers
from .models import Producto, Pedido, DetallePedido, Cliente, PagoFactura, Factura, DetalleFactura, Vendedor, Proveedor, FacturaDetallePedido

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Intentamos obtener los datos del modelo Vendedor vinculado
        try:
            # vendedor_profile es el related_name que deberías tener en tu OneToOneField
            # si no pusiste related_name, Django usa por defecto 'vendedor'
            vendedor = getattr(user, 'vendedor_profile', None) or getattr(user, 'vendedor', None)
            
            if vendedor:
                token['nombre'] = vendedor.nombre
                token['sigla'] = vendedor.sigla
            else:
                # Si es un admin sin perfil de vendedor todavía
                token['nombre'] = user.username
                token['sigla'] = "ADMIN"
        except Exception:
            token['nombre'] = user.username
            token['sigla'] = "N/A"

        return token

class VendedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendedor
        fields = ['id', 'nombre', 'sigla']


class ClienteSerializer(serializers.ModelSerializer):
    # Esto se usa para la LECTURA (GET) - devuelve el objeto completo
    vendedor = VendedorSerializer(read_only=True)
    
    # Esto se usa para la ESCRITURA (PUT/POST) - acepta el ID numérico
    vendedor_id = serializers.PrimaryKeyRelatedField(
        queryset=Vendedor.objects.all(), 
        source='vendedor', 
        write_only=True
    )

    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'vendedor', 'vendedor_id', 'direccion', 'telefono', 'email']

class ProductoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Producto
        fields = ['id', 'nombre', 'descripcion', 'categoria', 'precio_por_kilo', 'estado', 'peso_minimo']

class DetallePedidoSerializer(serializers.ModelSerializer):
    producto = ProductoSerializer()
    cliente_nombre = serializers.ReadOnlyField(source='pedido.cliente.nombre')
    vendedor_nombre = serializers.ReadOnlyField(source='pedido.vendedor.nombre')
    estado_pedido = serializers.ReadOnlyField(source='pedido.estado')
    facturas_detalle = serializers.SerializerMethodField()

    def get_facturas_detalle(self, obj):
        # Desglose por factura de compra que abastecio esta linea de venta.
        # Los kilos de la venta (bascula) se reparten entre las facturas en
        # PROPORCION a las unidades tomadas de cada una, y el costo atribuido de
        # cada factura = esos kilos * el costo/kg de ese lote. Asi la suma de
        # costos atribuidos coincide EXACTA con total_costo de la linea
        # (= costo/kg ponderado * kilos vendidos), en vez de reconstruir desde el
        # peso de compra por pieza (que en historicos esta corrupto y no cuadra).
        links = list(
            FacturaDetallePedido.objects.filter(detallepedido=obj)
            .select_related('factura', 'factura__proveedor')
        )
        total_unidades = sum(l.cantidad_unidades for l in links) or 0
        kilos_linea = Decimal(str(obj.cantidad_kilos or 0))

        detalle = []
        for link in links:
            detalle_factura = DetalleFactura.objects.filter(
                factura=link.factura_id, producto=obj.producto_id
            ).first()
            costo_por_kilo = detalle_factura.costo_por_kilo if detalle_factura else None
            if total_unidades > 0:
                kilos_atribuidos = kilos_linea * Decimal(link.cantidad_unidades) / Decimal(total_unidades)
            else:
                kilos_atribuidos = Decimal('0')
            detalle.append({
                'factura_id': link.factura_id,
                'numero_factura': link.factura.numero_factura,
                'proveedor_nombre': link.factura.proveedor.nombre if link.factura.proveedor_id else None,
                'unidades_consumidas': link.cantidad_unidades,
                'costo_por_kilo': costo_por_kilo,
                'kilos_atribuidos': kilos_atribuidos,
                'costo_atribuido': (kilos_atribuidos * costo_por_kilo) if costo_por_kilo is not None else None,
            })
        return detalle

    class Meta:
        model = DetallePedido
        fields = ['id', 'producto', 'cantidad_unidades', 'cantidad_kilos', 'total_venta', 'total_costo', 'margen', 'costo_por_kilo', 'facturas', 'facturas_detalle', 'precio_venta', 'fecha', 'pedido', 'cliente_nombre', 'vendedor_nombre', 'estado_pedido']

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
    # Estado de edición según cuánto del lote ya se vendió (guardas de stock).
    estado_edicion = serializers.SerializerMethodField()
    unidades_consumidas = serializers.SerializerMethodField()
    unidades_vivas = serializers.SerializerMethodField()
    pedidos_consumidores = serializers.SerializerMethodField()

    class Meta:
        model = DetalleFactura
        fields = ['id', 'producto', 'producto_nombre', 'cantidad_kilos', 'cantidad_unidades', 'costo_por_kilo', 'costo_total','factura','proveedor_nombre', 'estado_edicion', 'unidades_consumidas', 'unidades_vivas', 'pedidos_consumidores']

    def _info(self, obj):
        # Cachea el cálculo por instancia para no repetir el query en cada campo.
        cache = getattr(obj, '_estado_consumo_cache', None)
        if cache is None:
            from .utils import estado_consumo_detalle
            cache = estado_consumo_detalle(obj)
            obj._estado_consumo_cache = cache
        return cache

    def get_estado_edicion(self, obj):
        return self._info(obj)['estado']

    def get_unidades_consumidas(self, obj):
        return self._info(obj)['consumidas']

    def get_unidades_vivas(self, obj):
        return self._info(obj)['vivas']

    def get_pedidos_consumidores(self, obj):
        if self._info(obj)['consumidas'] <= 0:
            return []
        from .utils import pedidos_consumidores_detalle
        return pedidos_consumidores_detalle(obj)

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