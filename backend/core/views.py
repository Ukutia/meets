from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Producto, Pedido, FacturaDetallePedido, Vendedor, DetallePedido, Cliente, Factura, DetalleFactura, PagoFactura, EntradaProducto,Proveedor, PagoVendedor
from .serializers import ProductoSerializer, PedidoSerializer,ProveedorSerializer, ClienteSerializer, FacturaSerializer, PagoFacturaSerializer, VendedorSerializer
from rest_framework.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from decimal import Decimal



class ProductosView(APIView):
    def get(self, request):
        productos = Producto.objects.all()
        serializer = ProductoSerializer(productos, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class CrearProducto(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        nombre = data.get('nombre')
        descripcion = data.get('descripcion')
        precio_por_kilo = data.get('precio_por_kilo')
        categoria = data.get('categoria')
        estado = data.get('estado')

        if not nombre or not precio_por_kilo:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            producto = Producto.objects.create(
                nombre=nombre,
                descripcion=descripcion,
                precio_por_kilo=precio_por_kilo,
                categoria=categoria,
                estado=estado
            )
            return Response(ProductoSerializer(producto).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class PedidoListView(APIView):
    def get(self, request):
        pedidos = Pedido.objects.all()
        serializer = PedidoSerializer(pedidos, many=True)
        return Response(serializer.data)

class CrearPedido(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        cliente_id = data.get('cliente')
        detalles = data.get('detalles')

        vendedor_id = data.get('vendedor')
        vendedor = Vendedor.objects.get(id=vendedor_id)

        if not cliente_id or not detalles:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(detalles, list) or len(detalles) == 0:
            return Response({'error': 'Los detalles deben ser una lista no vacía'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                pedido = Pedido.objects.create(cliente_id=cliente_id)
                total_pedido = Decimal('0.00')

                for detalle in detalles:
                    producto_id = detalle.get('producto')
                    kilos = Decimal(str(detalle.get('cantidad_kilos', 0)))
                    unidades = int(detalle.get('cantidad_unidades', 0))


                    producto = Producto.objects.get(id=producto_id)
                    
                    stockProducto = DetalleFactura.objects.filter(producto=producto).aggregate(total=Sum('cantidad_unidades'))['total'] or 0

                    if unidades > stockProducto:
                        raise ValidationError("No hay suficiente stock disponible para el producto")
                    
                    if not producto_id:
                        raise ValidationError("El ID del producto es obligatorio")

                    try:
                        producto = Producto.objects.get(id=producto_id)
                    except Producto.DoesNotExist:
                        return Response({'error': f"Producto con ID {producto_id} no existe"}, status=status.HTTP_404_NOT_FOUND)



                    # Calcular el costo del producto en base a FIFO
                    entradas = EntradaProducto.objects.filter(producto=producto).order_by('fecha_entrada')
                    costo_total = Decimal('0.00')
                    cantidad_restante_unidades = unidades
                    facturas_usadas = []
                    facturas_cantidades = {}

                    for entrada in entradas:
                        if cantidad_restante_unidades <= 0:
                            break
                        if entrada.cantidad_unidades >= cantidad_restante_unidades:
                            costo_total += cantidad_restante_unidades * entrada.costo_por_kilo
                            entrada.cantidad_unidades -= cantidad_restante_unidades
                            entrada.save()
                            facturas_usadas.append(entrada.factura)
                            facturas_cantidades[entrada.factura.numero_factura] = cantidad_restante_unidades
                            cantidad_restante_unidades = Decimal('0.00')
                        else:
                            costo_total += entrada.cantidad_unidades * entrada.costo_por_kilo
                            cantidad_restante_unidades -= entrada.cantidad_unidades
                            facturas_usadas.append(entrada.factura)
                            facturas_cantidades[entrada.factura.numero_factura] = entrada.cantidad_unidades
                            entrada.delete()

                        if entrada.cantidad_unidades == 0:
                            entrada.delete()


                    if kilos == 0: 
                        kilos = Decimal('0.00') # Si no hay kilos, se deja en 0
                        costo_total = Decimal('0.00')
                        total_venta = Decimal('0.00')
                        pedido.estado = "Reservado"
                        costoXkilo = Decimal('0.00')
                    else:   
                        costoXkilo = costo_total / unidades
                        total_venta = kilos * producto.precio_por_kilo
                        total_pedido += total_venta
                        pedido.estado = "Preparado"




                    

                    detalle_pedido = DetallePedido.objects.create(
                        pedido=pedido,
                        producto=producto,
                        cantidad_kilos=kilos,
                        cantidad_unidades=unidades,
                        total_costo=costo_total,
                        total_venta=total_venta,
                        costo_por_kilo=costoXkilo,
                        precio_venta=producto.precio_por_kilo
                    )

                    # Agregar las facturas usadas al detalle del pedido
                    detalle_pedido.facturas.set(facturas_usadas)

                    # Agregar la cantidad de unidades usadas de cada factura
                    for factura_id, cantidad in facturas_cantidades.items():
                        FacturaDetallePedido.objects.create(
                            detallepedido=detalle_pedido,
                            factura_id=factura_id,
                            cantidad_unidades=cantidad
                        )
                pedido.vendedor = vendedor
                pedido.total = total_pedido
                pedido.save()

                return Response(PedidoSerializer(pedido).data, status=status.HTTP_201_CREATED)

        except ValidationError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': f'Error al crear el pedido o detalles: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)
        

class PedidoDetailView(APIView):
    def put(self, request, pk):
        try:
            pedido = Pedido.objects.get(pk=pk)
            data = request.data
            
            with transaction.atomic():
                # 1. Actualizar el estado si viene (Pagado, Anulado, etc.)
                if 'estado' in data:
                    pedido.estado = data['estado']

                # 2. Actualizar detalles (kilos y unidades)
                detalles_data = data.get('detalles', [])
                nuevo_total_pedido = 0

                for det in detalles_data:
                    # Extraemos el ID del producto (manejando si viene como objeto o ID)
                    prod_id = det['producto']['id'] if isinstance(det['producto'], dict) else det['producto']
                    
                    detalle_obj = DetallePedido.objects.get(pedido=pedido, producto_id=prod_id)
                    
                    # Actualizamos valores
                    detalle_obj.cantidad_kilos = Decimal(str(det.get('cantidad_kilos', 0)))
                    unidades_raw = det.get('cantidad_unidades', 0)
                    detalle_obj.cantidad_unidades = int(float(str(unidades_raw)))
                    
                    # Recalculamos subtotal de la línea
                    detalle_obj.total_venta = detalle_obj.cantidad_kilos * detalle_obj.precio_venta
                    detalle_obj.save()
                    
                    nuevo_total_pedido += detalle_obj.total_venta
                
                # 3. Guardar total general
                if detalles_data:
                    pedido.total = nuevo_total_pedido
                
                pedido.save()
                
            serializer = PedidoSerializer(pedido)
            return Response(serializer.data, status=status.HTTP_200_OK)
            
        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class ActualizarKilosPedido(APIView):
    def post(self, request, pedido_id, *args, **kwargs):
        try:
            pedido = Pedido.objects.get(id=pedido_id)
            detalles_data = request.data.get('detalles', [])
            total_pedido = 0
            with transaction.atomic():
                for detalle_data in detalles_data:
                    producto_id = detalle_data.get('producto')
                    cantidad_kilos = detalle_data.get('cantidad_kilos')

                    detalle = DetallePedido.objects.get(pedido=pedido, producto_id=producto_id)
                    detalle.cantidad_kilos = cantidad_kilos
                    detalle.save()

                    total_pedido += detalle.total_venta
                pedido.total = total_pedido
                pedido.save()

                

            return Response({'status': 'Kilos actualizados exitosamente'}, status=status.HTTP_200_OK)
        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        

class VendedorListView(APIView):
    def get(self, request):
        vendedores = Vendedor.objects.all()
        serializer = VendedorSerializer(vendedores, many=True)
        return Response(serializer.data)

class ClienteListView(APIView):
    def get(self, request):
        clientes = Cliente.objects.all()
        serializer = ClienteSerializer(clientes, many=True)
        return Response(serializer.data)

class CrearCliente(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        nombre = data.get('nombre')
        direccion = data.get('direccion')
        telefono = data.get('telefono')
        email = data.get('email')
        vendedor_id = data.get('vendedor')

        if not nombre or not direccion or not vendedor_id:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            vendedor = Vendedor.objects.get(id=vendedor_id)
            cliente = Cliente.objects.create(
                nombre=nombre,
                direccion=direccion,
                telefono=telefono,
                email=email,
                vendedor=vendedor
            )
            return Response(ClienteSerializer(cliente).data, status=status.HTTP_201_CREATED)
        except Vendedor.DoesNotExist:
            return Response({'error': 'Vendedor no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class CrearFacturaEntrada(APIView):
    @transaction.atomic
    def post(self, request):
        data = request.data
        try:
            # 1. Obtener Proveedor
            proveedor_id = data.get('proveedor')
            proveedor = Proveedor.objects.get(id=proveedor_id)

            # 2. Crear la Factura
            factura = Factura.objects.create(
                numero_factura=data.get('numero_factura'),
                proveedor=proveedor,
                fecha=data.get('fecha', timezone.now()),
                subtotal=Decimal(str(data.get('subtotal', 0))),
                iva=Decimal(str(data.get('iva', 0))),
                total=Decimal(str(data.get('total', 0)))
            )

            detalles_data = data.get('detalles', [])
            
            for item in detalles_data:
                producto = Producto.objects.get(id=item.get('producto'))
                
                # Leemos con nombres explícitos y valores por defecto 0.0
                kilos = Decimal(str(item.get('cantidad_kilos', 0)))
                unidades = int(item.get('cantidad_unidades', 0))
                costo_un = Decimal(str(item.get('costo_por_kilo', 0)))
                # Si el frontend envía 'costo_total', lo usamos; si no, lo calculamos
                costo_tot = Decimal(str(item.get('costo_total', kilos * costo_un)))

                # 3. Crear DetalleFactura
                DetalleFactura.objects.create(
                    factura=factura,
                    producto=producto,
                    cantidad_kilos=kilos,
                    cantidad_unidades=unidades,
                    costo_por_kilo=costo_un,
                    costo_total=costo_tot
                )

                # 4. Crear EntradaProducto (Aquí es donde fallaba)
                # Nos aseguramos que costo_por_kilo NUNCA sea None
                EntradaProducto.objects.create(
                    factura=factura,
                    producto=producto,
                    cantidad_kilos=kilos,
                    cantidad_unidades=unidades,
                    costo_por_kilo=costo_un,
                    fecha_entrada=factura.fecha
                )

            return Response({'message': 'Éxito'}, status=status.HTTP_201_CREATED)

        except Exception as e:
            # Este print saldrá en tu terminal de VS Code / Servidor
            print(f"DEBUG ERROR: {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class FacturaListView(APIView):
    def get(self, request):
        facturas = Factura.objects.all()
        serializer = FacturaSerializer(facturas, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class CrearPagoFactura(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        factura_id = data.get('factura')
        fecha_de_pago = data.get('fecha_de_pago')
        monto_del_pago = data.get('monto_del_pago')

        if not factura_id or not fecha_de_pago or not monto_del_pago:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            factura = Factura.objects.get(numero_factura=factura_id)
        except Factura.DoesNotExist:
            return Response({'error': f'Factura con ID {factura_id} no existe'}, status=status.HTTP_404_NOT_FOUND)

        pago_factura = PagoFactura.objects.create(
            factura=factura,
            fecha_de_pago=fecha_de_pago,
            monto_del_pago=monto_del_pago
        )

        return Response(PagoFacturaSerializer(pago_factura).data, status=status.HTTP_201_CREATED)

class CancelarPedido(APIView):
    def post(self, request, *args, **kwargs):
        pedido_id = request.data.get('pedido_id')

        if not pedido_id:
            return Response({'error': 'El ID del pedido es obligatorio'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # Seleccionamos con select_for_update para evitar colisiones
                pedido = Pedido.objects.select_for_update().get(id=pedido_id)

                if pedido.estado == "Anulado":
                    return Response({'error': 'El pedido ya está Anulado'}, status=status.HTTP_400_BAD_REQUEST)

                # 1. Revertir stock a las entradas originales
                for detalle in pedido.detalles.all():
                    # Buscamos las relaciones en la tabla intermedia
                    relaciones = FacturaDetallePedido.objects.filter(detallepedido=detalle)

                    for relacion in relaciones:
                        factura = relacion.factura
                        
                        # BUSCAR EL COSTO ORIGINAL DE ESTE PRODUCTO EN ESTA FACTURA
                        try:
                            detalle_factura_original = DetalleFactura.objects.get(
                                factura=factura, 
                                producto=detalle.producto
                            )
                            costo_unitario_compra = detalle_factura_original.costo_por_kilo
                        except DetalleFactura.DoesNotExist:
                            # Por si acaso no se encuentra, usamos el costo que guardamos en la relación
                            costo_unitario_compra = relacion.costo_por_kilo 

                        # Buscar fecha para mantener FIFO
                        entrada_ref = EntradaProducto.objects.filter(
                            producto=detalle.producto
                        ).order_by('fecha_entrada').first()
                        
                        if entrada_ref:
                            nueva_fecha = entrada_ref.fecha_entrada - timezone.timedelta(seconds=1)
                        else:
                            nueva_fecha = timezone.now()

                        # Calcular kilos proporcionales
                        kilos_a_devolver = (detalle.cantidad_kilos / detalle.cantidad_unidades) * relacion.cantidad_unidades

                        # Crear la entrada de retorno
                        EntradaProducto.objects.create(
                            factura=factura,
                            producto=detalle.producto,
                            cantidad_kilos=kilos_a_devolver,
                            cantidad_unidades=relacion.cantidad_unidades,
                            costo_por_kilo=costo_unitario_compra, # <--- COSTO RECUPERADO
                            fecha_entrada=nueva_fecha
                        )

                # 2. IMPORTANTE: NO borres los detalles. 
                # Si los borras, pierdes el historial de qué se vendió. 
                # Solo cambia el estado del pedido.
                pedido.estado = "Anulado"
                pedido.save()

                return Response({'status': 'Pedido Anulado y stock revertido'}, status=status.HTTP_200_OK)

        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': f'Error: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)     


class ObtenerPedido(APIView):
    def get(self, request, pedido_id, *args, **kwargs):
        try:
            pedido = Pedido.objects.get(id=pedido_id)
            serializer = PedidoSerializer(pedido)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Pedido.DoesNotExist:
            return Response({'error': 'Pedido no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        

from django.db.models import Sum



class StockProductos(APIView):
    def get(self, request, *args, **kwargs):
        productos = Producto.objects.all()
        stock_data = []

        for producto in productos:
            # 1. ENTRADAS: Todo lo que se ha comprado (esto no cambia)
            entradas_unidades = DetalleFactura.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0
            
            entradas_kilos = DetalleFactura.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_kilos'))['total'] or 0

            # 2. SALIDAS: Solo descontar pedidos que NO estén anulados
            # Usamos .exclude(pedido__estado="Anulado")
            pedidos_validos = DetallePedido.objects.filter(
                producto=producto
            ).exclude(pedido__estado="Anulado")

            salidas_unidades = pedidos_validos.aggregate(total=Sum('cantidad_unidades'))['total'] or 0
            salidas_kilos = pedidos_validos.aggregate(total=Sum('cantidad_kilos'))['total'] or 0

            # 3. RESERVAS: Pedidos válidos que aún no tienen kilos pesados (cantidad_kilos=0)
            unidades_reservadas = pedidos_validos.filter(
                cantidad_kilos=0
            ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0
            
            # Cálculos finales
            stock_actual_unidades = entradas_unidades - salidas_unidades
            stock_actual_kilos = entradas_kilos - salidas_kilos
            estado_producto = producto.estado
            
            stock_data.append({
                'id': producto.id,
                'producto': producto.nombre,
                'precio_por_kilo': producto.precio_por_kilo,
                'disponibles': stock_actual_unidades,
                'estado': estado_producto,
                # El stock físico real es lo disponible más lo que está apartado en reserva
                'stock': stock_actual_unidades + unidades_reservadas,
                'reservas': unidades_reservadas,
                'kilos_actuales': round(stock_actual_kilos, 2)
            })

        return Response(stock_data, status=status.HTTP_200_OK)


from .serializers import DetalleFacturaSerializer, DetallePedidoSerializer


# views.py

class PagoVendedorView(APIView):
    def get(self, request):
        vendedor_id = request.query_params.get('vendedor')
        if vendedor_id:
            pagos = PagoVendedor.objects.filter(vendedor_id=vendedor_id).order_by('-fecha')
        else:
            pagos = PagoVendedor.objects.all().order_by('-fecha')
        
        # Opcional: podrías usar el serializer o devolver datos crudos
        data = [{
            "id": p.id,
            "vendedor": p.vendedor.id,
            "monto": p.monto,
            "comentario": p.comentario,
            "tipo": p.tipo,
            "fecha": p.fecha,
            "comprobante": p.comprobante.url if p.comprobante else None
        } for p in pagos]
        return Response({"data": data}, status=status.HTTP_200_OK)

    def post(self, request):
        # Para manejar archivos (FormData), usamos request.data
        try:
            vendedor = Vendedor.objects.get(id=request.data.get('vendedor'))
            pago = PagoVendedor.objects.create(
                vendedor=vendedor,
                monto=Decimal(request.data.get('monto')),
                comentario=request.data.get('comentario', ''),
                tipo=request.data.get('tipo', 'pago'),
                comprobante=request.FILES.get('comprobante')
            )
            return Response({'message': 'Registrado con éxito'}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class DetalleFacturasList(APIView):
    def get(self, request):
        # Optimizamos con select_related para traer nombres de productos/proveedores en una sola consulta
        detalles = DetalleFactura.objects.select_related('factura__proveedor', 'producto').all()
        serializer = DetalleFacturaSerializer(detalles, many=True)
        return Response(serializer.data)

class DetallePedidosList(APIView):
    def get(self, request):
        detalles = DetallePedido.objects.select_related('pedido__cliente', 'producto').all()
        serializer = DetallePedidoSerializer(detalles, many=True)
        return Response(serializer.data)

class UpdateProducto(APIView):
    def put(self, request, producto_id, *args, **kwargs):
        try:
            producto = Producto.objects.get(id=producto_id)
            data = request.data
            
            # Actualizamos todos los campos enviados desde el Frontend
            producto.nombre = data.get('nombre', producto.nombre)
            producto.precio_por_kilo = data.get('precio_por_kilo', producto.precio_por_kilo)
            producto.peso_minimo = data.get('peso_minimo', producto.peso_minimo)
            producto.estado = data.get('estado', producto.estado)
            producto.categoria = data.get('categoria', producto.categoria)
            producto.descripcion = data.get('descripcion', producto.descripcion)
            
            producto.save()
            
            return Response(ProductoSerializer(producto).data, status=status.HTTP_200_OK)
        except Producto.DoesNotExist:
            return Response({'error': 'Producto no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        
# Nueva vista para Proveedores
class ProveedorListView(APIView):
    def get(self, request):
        proveedores = Proveedor.objects.all()
        serializer = ProveedorSerializer(proveedores, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class StockProductosView(APIView):
    def get(self, request):
        productos = Producto.objects.all()
        stock_data = []

        for producto in productos:
            # 1. Calcular Entradas (Compras)
            entradas_kilos = EntradaProducto.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_kilos'))['total'] or 0
            
            entradas_unidades = EntradaProducto.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad_unidades'))['total'] or 0

            # 2. Calcular Salidas (Ventas - Solo pedidos no anulados)
            salidas = DetallePedido.objects.filter(
                producto=producto
            ).exclude(pedido__estado="Anulado")
            
            salidas_kilos = salidas.aggregate(total=Sum('cantidad_kilos'))['total'] or 0
            salidas_unidades = salidas.aggregate(total=Sum('cantidad_unidades'))['total'] or 0

            # 3. Calcular Ajustes (Mermas o Inventario Manual)
            ajustes = AjusteInventario.objects.filter(
                producto=producto
            ).aggregate(total=Sum('cantidad'))['total'] or 0

            # 4. Cálculo Final
            stock_kilos = (entradas_kilos - salidas_kilos) + ajustes
            stock_unidades = entradas_unidades - salidas_unidades

            stock_data.append({
                'id': producto.id,
                'nombre': producto.nombre,
                'categoria': producto.categoria,
                'stock_kilos': round(stock_kilos, 2),
                'stock_unidades': int(stock_unidades),
                'precio_kilo': producto.precio_por_kilo,
                'valor_inventario_estimado': round(stock_kilos * producto.precio_por_kilo, 2),
                'estado': 'Crítico' if stock_kilos < 10 else 'Normal' # Ejemplo de alerta
            })

        return Response(stock_data, status=status.HTTP_200_OK)