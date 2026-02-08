from django.conf import settings
from django.urls import path
from .views import PagoVendedorView,ProductosView,PedidoDetailView, PedidoListView,ProveedorListView,StockProductosView, CrearPedido, ActualizarKilosPedido, ClienteListView, CrearCliente, CrearFacturaEntrada, FacturaListView, CrearPagoFactura, CancelarPedido, ObtenerPedido, StockProductos, VendedorListView, CrearProducto, UpdateProducto, DetallePedidosList, DetalleFacturasList

urlpatterns = [
    path('productos/', ProductosView.as_view(), name='productos'),
    path('productos/crear/', CrearProducto.as_view(), name='crear_producto'),
    path('productos/<int:producto_id>/', UpdateProducto.as_view(), name='actualizar_producto'),
    path('pedidos/', PedidoListView.as_view(), name='pedidos'),
    path('pedidos/crear/', CrearPedido.as_view(), name='crear_pedido'),
    path('pedidos/actualizar_kilos/<int:pedido_id>/', ActualizarKilosPedido.as_view(), name='actualizar_kilos_pedido'),
    path('clientes/', ClienteListView.as_view(), name='clientes'),
    path('clientes/crear/', CrearCliente.as_view(), name='crear_cliente'),
    path('facturas/crear/', CrearFacturaEntrada.as_view(), name='crear_factura'),
    path('facturas/', FacturaListView.as_view(), name='facturas'),
    path('facturas/pagar/', CrearPagoFactura.as_view(), name='pagar_factura'),
    path('pedidos/cancelar/', CancelarPedido.as_view(), name='cancelar_pedido'),
    path('stock/', StockProductos.as_view(), name='stock_productos'),
    path('vendedores/', VendedorListView.as_view(), name='vendedores'),
    path('proveedores/', ProveedorListView.as_view(), name='proveedores'), # Nueva ruta
    path('facturas/crear/', CrearFacturaEntrada.as_view(), name='crear_factura'),
    path('facturas/', FacturaListView.as_view(), name='facturas'),
    path('stock/', StockProductosView.as_view(), name='ver_stock'),
    path('pedidos/<int:pk>/', PedidoDetailView.as_view(), name='pedido-detail'),
    path('inventario/detalle-pedidos/', DetallePedidosList.as_view(), name='detalle-pedidos-list'),
    path('inventario/detalle-facturas/', DetalleFacturasList.as_view(), name='detalle-facturas-list'),
    path('pagos-vendedor/', PagoVendedorView.as_view(), name='pagos_vendedor')
]

