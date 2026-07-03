from rest_framework.views import APIView, PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from .models import Producto, Pedido, FacturaDetallePedido, Vendedor, DetallePedido, Cliente, Factura, DetalleFactura, PagoFactura, EntradaProducto,Proveedor, PagoVendedor, AjusteInventario
from .serializers import MyTokenObtainPairSerializer, ProductoSerializer, PedidoSerializer,ProveedorSerializer, ClienteSerializer, FacturaSerializer, PagoFacturaSerializer, VendedorSerializer
from .utils import estado_consumo_detalle
from rest_framework.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from decimal import Decimal

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.permissions import IsAuthenticated

class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer

class ProductosView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        productos = Producto.objects.all()
        serializer = ProductoSerializer(productos, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class CrearProducto(APIView):
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    def get(self, request):
        pedidos = Pedido.objects.exclude(estado="Anulado").order_by('-fecha')
        serializer = PedidoSerializer(pedidos, many=True)
        return Response(serializer.data)

class CrearPedido(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        cliente_id = data.get('cliente')
        detalles = data.get('detalles')

        if not cliente_id or not detalles:
            return Response({'error': 'Faltan datos obligatorios'}, status=status.HTTP_400_BAD_REQUEST)

        # LÓGICA DE ASIGNACIÓN DE VENDEDOR
        # El vendedor del pedido se hereda SIEMPRE del vendedor dueño del cliente
        # (Cliente.vendedor), sin importar quién esté logueado al crear el pedido.
        # Esto evita que un vendedor "robe" (sin querer o a propósito) la autoría
        # de una venta de otro vendedor por crear el pedido desde su sesión.
        # Excepción explícita: un admin/staff puede reasignar manualmente pasando
        # 'forzar_vendedor' en el payload (nunca el campo 'vendedor', que se ignora).
        try:
            cliente = Cliente.objects.get(id=cliente_id)
        except Cliente.DoesNotExist:
            return Response({'error': 'Cliente no encontrado'}, status=status.HTTP_404_NOT_FOUND)

        forzar_vendedor_id = data.get('forzar_vendedor')
        if request.user.is_staff and forzar_vendedor_id:
            try:
                vendedor = Vendedor.objects.get(id=forzar_vendedor_id)
            except Vendedor.DoesNotExist:
                return Response({'error': 'Vendedor no encontrado'}, status=404)
        else:
            vendedor = cliente.vendedor
            if vendedor is None:
                return Response(
                    {'error': 'El cliente seleccionado no tiene un vendedor asignado.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    def get(self, request):
        vendedores = Vendedor.objects.all()
        serializer = VendedorSerializer(vendedores, many=True)
        return Response(serializer.data)

class ClienteListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        clientes = Cliente.objects.all().order_by('nombre')
        serializer = ClienteSerializer(clientes, many=True)
        return Response(serializer.data)

class CrearCliente(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        data = request.data
        nombre = data.get('nombre')
        direccion = data.get('direccion')
        telefono = data.get('telefono')
        email = data.get('email')
        vendedor_id = data.get('vendedor_id')

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
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    def get(self, request):
        facturas = Factura.objects.all()
        serializer = FacturaSerializer(facturas, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

class UpdateFacturaEntrada(APIView):
    """Edita una factura ya emitida (proveedor, fecha y sus líneas) aplicando
    guardas de stock por línea:

      - línea no consumida  -> edición libre de cantidad y costo.
      - línea parcialmente consumida -> costo libre; la cantidad no puede bajar
        de lo ya vendido; el stock restante se ajusta a la diferencia.
      - línea totalmente consumida -> bloqueada para cantidad/costo (se ignora
        cualquier cambio enviado para esa línea).

    Sólo se editan líneas existentes (identificadas por ``id`` o, en su defecto,
    por ``producto``). Cambiar el producto de una línea o agregar/quitar líneas
    queda fuera del alcance de esta edición. Toda la reconciliación de stock
    corre dentro de una transacción, siguiendo el patrón de ``CancelarPedido``.
    """
    permission_classes = [IsAuthenticated]

    def put(self, request, numero_factura):
        data = request.data
        try:
            with transaction.atomic():
                factura = Factura.objects.select_for_update().get(numero_factura=numero_factura)

                # Metadatos no ligados a stock: siempre editables sin restricción.
                proveedor_id = data.get('proveedor')
                if proveedor_id:
                    factura.proveedor = Proveedor.objects.get(id=proveedor_id)
                if data.get('fecha'):
                    factura.fecha = data.get('fecha')

                for item in data.get('detalles', []):
                    detalle_id = item.get('id')
                    if detalle_id is not None:
                        detalle = DetalleFactura.objects.get(id=detalle_id, factura=factura)
                    else:
                        detalle = DetalleFactura.objects.get(factura=factura, producto_id=item.get('producto'))

                    info = estado_consumo_detalle(detalle)
                    estado = info['estado']
                    consumidas = info['consumidas']

                    # Línea totalmente consumida: no se toca cantidad ni costo.
                    if estado == 'bloqueada':
                        continue

                    nuevos_kilos = Decimal(str(item.get('cantidad_kilos', detalle.cantidad_kilos)))
                    nuevas_unidades = int(item.get('cantidad_unidades', detalle.cantidad_unidades))
                    nuevo_costo = Decimal(str(item.get('costo_por_kilo', detalle.costo_por_kilo)))

                    # Parcialmente consumida: la cantidad no puede bajar de lo vendido.
                    if estado == 'parcial' and nuevas_unidades < consumidas:
                        raise ValidationError(
                            f"El producto '{detalle.producto.nombre}' ya tiene {consumidas} "
                            f"unidad(es) vendida(s); la cantidad no puede ser menor a ese valor."
                        )

                    # Actualizar la línea histórica (DetalleFactura).
                    detalle.cantidad_kilos = nuevos_kilos
                    detalle.cantidad_unidades = nuevas_unidades
                    detalle.costo_por_kilo = nuevo_costo
                    detalle.costo_total = nuevos_kilos * nuevo_costo
                    detalle.save()

                    # Reconciliar el stock vivo (EntradaProducto) con lo restante.
                    self._reconciliar_entrada(detalle, consumidas, nuevos_kilos, nuevas_unidades, nuevo_costo)

                # Recalcular totales igual que en creación (subtotal + IVA 19%).
                subtotal = factura.detalles.aggregate(total=Sum('costo_total'))['total'] or Decimal('0')
                iva = (subtotal * Decimal('0.19')).quantize(Decimal('0.01'))
                factura.subtotal = subtotal.quantize(Decimal('0.01'))
                factura.iva = iva
                factura.total = (subtotal + iva).quantize(Decimal('0.01'))
                factura.save()

            factura.refresh_from_db()
            return Response(FacturaSerializer(factura).data, status=status.HTTP_200_OK)

        except Factura.DoesNotExist:
            return Response({'error': 'Factura no encontrada'}, status=status.HTTP_404_NOT_FOUND)
        except DetalleFactura.DoesNotExist:
            return Response({'error': 'Una de las líneas enviadas no pertenece a la factura'}, status=status.HTTP_400_BAD_REQUEST)
        except ValidationError as e:
            detail = e.detail if hasattr(e, 'detail') else str(e)
            if isinstance(detail, list) and detail:
                detail = detail[0]
            return Response({'error': str(detail)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            print(f"DEBUG ERROR (UpdateFacturaEntrada): {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def _reconciliar_entrada(self, detalle, consumidas, nuevos_kilos, nuevas_unidades, nuevo_costo):
        """Ajusta el/los EntradaProducto vivos del producto+factura para que
        reflejen la nueva cantidad menos lo ya consumido, al nuevo costo. Se
        actualiza in-place la fila más antigua (preservando su posición FIFO) y
        se consolidan las demás."""
        entradas = list(
            EntradaProducto.objects.filter(
                factura=detalle.factura_id, producto=detalle.producto_id
            ).order_by('fecha_entrada')
        )

        unidades_restantes = nuevas_unidades - consumidas
        if unidades_restantes < 0:
            unidades_restantes = 0

        if nuevas_unidades > 0:
            kilos_restantes = (nuevos_kilos / Decimal(nuevas_unidades)) * Decimal(unidades_restantes)
        else:
            # Línea sin unidades (sólo kilos): el stock restante son los kilos directos.
            kilos_restantes = nuevos_kilos

        if entradas:
            principal = entradas[0]
            principal.cantidad_unidades = unidades_restantes
            principal.cantidad_kilos = kilos_restantes
            principal.costo_por_kilo = nuevo_costo
            principal.save()
            for extra in entradas[1:]:
                extra.delete()
        else:
            # No debería ocurrir en 'libre'/'parcial' (siempre queda stock vivo),
            # pero por robustez recreamos la entrada.
            EntradaProducto.objects.create(
                factura=detalle.factura,
                producto=detalle.producto,
                cantidad_kilos=kilos_restantes,
                cantidad_unidades=unidades_restantes,
                costo_por_kilo=nuevo_costo,
            )

class CrearPagoFactura(APIView):
    permission_classes = [IsAuthenticated]
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

        if hasattr(factura, 'pago_factura'):
            return Response({'error': 'Esta factura ya tiene un pago registrado'}, status=status.HTTP_400_BAD_REQUEST)

        pago_factura = PagoFactura.objects.create(
            factura=factura,
            fecha_de_pago=fecha_de_pago,
            monto_del_pago=monto_del_pago
        )

        return Response(PagoFacturaSerializer(pago_factura).data, status=status.HTTP_201_CREATED)

class CancelarPedido(APIView):
    permission_classes = [IsAuthenticated]
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

                        # Calcular kilos proporcionales de forma segura
                        if detalle.cantidad_unidades and detalle.cantidad_unidades > 0:
                            kilos_a_devolver = (detalle.cantidad_kilos / detalle.cantidad_unidades) * relacion.cantidad_unidades
                        else:
                            # Si no hay unidades en el detalle del pedido, devolvemos los kilos de la relación directamente
                            kilos_a_devolver = relacion.cantidad_kilos if hasattr(relacion, 'cantidad_kilos') else 0
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
    permission_classes = [IsAuthenticated]
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

from rest_framework import generics

class UpdateCliente(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    lookup_field = 'pk'


class StockProductos(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request, *args, **kwargs):
        productos = Producto.objects.exclude(estado="desactivado")
        stock_data = []

        for producto in productos:
            # 1. ENTRADAS (Totales)
            entradas = DetalleFactura.objects.filter(producto=producto).aggregate(
                u=Sum('cantidad_unidades'), 
                k=Sum('cantidad_kilos')
            )
            entradas_u = entradas['u'] or 0
            entradas_k = entradas['k'] or 0

            # 2. FILTRAR PEDIDOS VÁLIDOS (No anulados)
            pedidos_validos = DetallePedido.objects.filter(
                producto=producto
            ).exclude(pedido__estado="Anulado")

            # 3. DIFERENCIAR SALIDAS REALES VS RESERVAS
            # Salidas Reales: Tienen kilos (ya se pesaron/despacharon)
            salidas_reales = pedidos_validos.filter(cantidad_kilos__gt=0).aggregate(
                u=Sum('cantidad_unidades'),
                k=Sum('cantidad_kilos')
            )
            salidas_u = salidas_reales['u'] or 0
            salidas_k = salidas_reales['k'] or 0

            # Reservas: No tienen kilos (están en bodega esperando)
            unidades_reservadas = pedidos_validos.filter(
                cantidad_kilos=0
            ).aggregate(u=Sum('cantidad_unidades'))['u'] or 0

            # --- CÁLCULOS FINALES ---
            
            # Stock Físico: Lo que entró menos lo que ya salió físicamente
            # (Las reservas siguen en la repisa, por eso no se restan aquí)
            stock_fisico = entradas_u - salidas_u
            
            # Disponibles: Lo que hay físicamente menos lo que ya prometí (reservas)
            disponibles = stock_fisico - unidades_reservadas
            
            # Kilos: Entradas menos Salidas (Las reservas no restan kilos porque valen 0)
            kilos_actuales = entradas_k - salidas_k

            stock_data.append({
                'id': producto.id,
                'producto': producto.nombre,
                'precio_por_kilo': producto.precio_por_kilo,
                'disponibles': disponibles, # Debería dar 6
                'estado': producto.estado,
                'stock': stock_fisico,       # Debería dar 17
                'reservas': unidades_reservadas, # Debería dar 11
                'kilos_actuales': round(kilos_actuales, 2)
            })

        return Response(stock_data, status=status.HTTP_200_OK)


from .serializers import DetalleFacturaSerializer, DetallePedidoSerializer


# views.py

class PagoVendedorView(APIView):
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    def get(self, request):
        # Optimizamos con select_related para traer nombres de productos/proveedores en una sola consulta
        detalles = DetalleFactura.objects.select_related('factura__proveedor', 'producto').all()
        serializer = DetalleFacturaSerializer(detalles, many=True)
        return Response(serializer.data)

class DetallePedidosList(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        detalles = DetallePedido.objects.select_related('pedido__cliente', 'producto').all()
        serializer = DetallePedidoSerializer(detalles, many=True)
        return Response(serializer.data)

class UpdateProducto(APIView):
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
    def get(self, request):
        proveedores = Proveedor.objects.all()
        serializer = ProveedorSerializer(proveedores, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class StockProductosView(APIView):
    permission_classes = [IsAuthenticated]
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


# ============================================================================
# REPORTES FINANCIEROS (Plan 03 — Ganancias, Márgenes y Estadísticas)
# ============================================================================
from django.db.models import Avg, F, OuterRef, Subquery, DecimalField
from django.db.models.functions import TruncMonth, Coalesce


# Los costos de compra se ingresan SIN IVA (ver Facturas.tsx: subtotal/costo_por_kilo
# son netos, el IVA se calcula aparte). El costo REAL pagado al proveedor incluye ese
# 19%, así que toda ganancia/margen reportado debe descontar el costo CON IVA, no el
# neto. Los campos DetallePedido.total_costo/margen quedaron persistidos con el costo
# neto (bug de origen), por eso los reportes recalculan la ganancia en vez de confiar
# en Sum('margen').
IVA_RATE = Decimal('1.19')


def _detalles_ganancia_qs(request):
    """
    Base de agregación de ganancias: líneas de venta (DetallePedido)
    EXCLUYENDO pedidos Anulado (de lo contrario las ventas revertidas
    inflarían la ganancia reportada). Acepta filtro opcional de rango de
    fechas vía ?desde=YYYY-MM-DD & ?hasta=YYYY-MM-DD sobre DetallePedido.fecha.
    """
    qs = DetallePedido.objects.exclude(pedido__estado="Anulado")
    desde = request.query_params.get('desde')
    hasta = request.query_params.get('hasta')
    if desde:
        qs = qs.filter(fecha__gte=desde)
    if hasta:
        qs = qs.filter(fecha__lte=hasta)
    return qs


class ReporteGananciasView(APIView):
    """
    Agregación de ganancias sobre DetallePedido (pedidos NO anulados).
    Devuelve en una sola respuesta: total general, por producto ("corte"),
    por mes y por vendedor.

    La ganancia se RECALCULA como ventas - (costo_neto * IVA_RATE) en vez de
    usar el campo persistido DetallePedido.margen: ese campo se calculó al
    crear el pedido usando el costo neto (sin IVA) de la compra, por lo que
    subestima el costo real y sobreestima la ganancia.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        detalles = _detalles_ganancia_qs(request)

        # --- Total general ---
        totales = detalles.aggregate(
            ventas=Coalesce(Sum('total_venta'), Decimal('0')),
            costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            kilos=Coalesce(Sum('cantidad_kilos'), Decimal('0')),
        )
        costo_con_iva = totales['costo_neto'] * IVA_RATE
        ganancia = totales['ventas'] - costo_con_iva
        margen_pct = float(ganancia / totales['ventas'] * 100) if totales['ventas'] else 0.0

        # --- Por producto / "corte" (= Producto.nombre) ---
        por_producto_raw = list(
            detalles.values('producto__id', 'producto__nombre')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
                kilos=Coalesce(Sum('cantidad_kilos'), Decimal('0')),
            )
        )
        por_producto = []
        for r in por_producto_raw:
            costo = r['costo_neto'] * IVA_RATE
            gan = r['ventas'] - costo
            por_producto.append({
                'producto_id': r['producto__id'],
                'nombre': r['producto__nombre'],
                'ganancia': gan,
                'ventas': r['ventas'],
                'costo': costo,
                'kilos': r['kilos'],
                'margen_pct': float(gan / r['ventas'] * 100) if r['ventas'] else 0.0,
            })
        por_producto.sort(key=lambda x: x['ganancia'], reverse=True)

        # --- Por mes ---
        por_mes_raw = list(
            detalles.annotate(mes=TruncMonth('fecha'))
            .values('mes')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            )
            .order_by('mes')
        )
        por_mes = []
        for r in por_mes_raw:
            costo = r['costo_neto'] * IVA_RATE
            por_mes.append({
                'mes': r['mes'].strftime('%Y-%m') if r['mes'] else None,
                'ganancia': r['ventas'] - costo,
                'ventas': r['ventas'],
                'costo': costo,
            })

        # --- Por vendedor ---
        por_vendedor_raw = list(
            detalles.values('pedido__vendedor__id', 'pedido__vendedor__nombre')
            .annotate(
                ventas=Coalesce(Sum('total_venta'), Decimal('0')),
                costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
            )
        )
        por_vendedor = []
        for r in por_vendedor_raw:
            costo = r['costo_neto'] * IVA_RATE
            gan = r['ventas'] - costo
            por_vendedor.append({
                'vendedor_id': r['pedido__vendedor__id'],
                'nombre': r['pedido__vendedor__nombre'] or 'Sin vendedor',
                'ganancia': gan,
                'ventas': r['ventas'],
                'margen_pct': float(gan / r['ventas'] * 100) if r['ventas'] else 0.0,
            })
        por_vendedor.sort(key=lambda x: x['ganancia'], reverse=True)

        return Response({
            'total': {
                'ganancia': ganancia,
                'ventas': totales['ventas'],
                'costo': costo_con_iva,
                'kilos': totales['kilos'],
                'margen_pct': round(margen_pct, 2),
            },
            'por_producto': por_producto,
            'por_mes': por_mes,
            'por_vendedor': por_vendedor,
        }, status=status.HTTP_200_OK)


class ReportePerdidasView(APIView):
    """
    Pérdidas por mermas (AjusteInventario tipo 'merma').

    CRITERIO DE VALORIZACIÓN (decisión de negocio):
    AjusteInventario no tiene costo unitario propio, por lo que cada merma se
    valoriza con el ÚLTIMO costo_por_kilo conocido de EntradaProducto para ese
    producto (el costo de reposición más reciente), AJUSTADO por IVA_RATE ya
    que ese costo se ingresa sin IVA y el costo real de reponer el producto lo
    incluye. Si el producto nunca tuvo una entrada, la merma se valoriza en 0.
    La cantidad de la merma se toma en valor absoluto (las mermas suelen
    registrarse como cantidad negativa).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ultimo_costo_sq = EntradaProducto.objects.filter(
            producto=OuterRef('producto')
        ).order_by('-fecha_entrada').values('costo_por_kilo')[:1]

        mermas = (
            AjusteInventario.objects.filter(tipo='merma')
            .annotate(costo_unit=Coalesce(
                Subquery(ultimo_costo_sq, output_field=DecimalField(max_digits=10, decimal_places=2)),
                Decimal('0'),
            ))
            .select_related('producto')
        )

        por_producto = {}
        por_mes = {}
        total_valor = Decimal('0')
        total_kilos = Decimal('0')

        for m in mermas:
            kilos = abs(m.cantidad or Decimal('0'))
            valor = kilos * m.costo_unit * IVA_RATE
            total_valor += valor
            total_kilos += kilos

            pid = m.producto_id
            if pid not in por_producto:
                por_producto[pid] = {
                    'producto_id': pid,
                    'nombre': m.producto.nombre,
                    'kilos': Decimal('0'),
                    'valor': Decimal('0'),
                }
            por_producto[pid]['kilos'] += kilos
            por_producto[pid]['valor'] += valor

            mes = m.fecha.strftime('%Y-%m') if m.fecha else 'Sin fecha'
            if mes not in por_mes:
                por_mes[mes] = {'mes': mes, 'kilos': Decimal('0'), 'valor': Decimal('0')}
            por_mes[mes]['kilos'] += kilos
            por_mes[mes]['valor'] += valor

        por_producto_list = sorted(por_producto.values(), key=lambda x: x['valor'], reverse=True)
        por_mes_list = sorted(por_mes.values(), key=lambda x: x['mes'])

        return Response({
            'total': {'valor': total_valor, 'kilos': total_kilos},
            'por_producto': por_producto_list,
            'por_mes': por_mes_list,
        }, status=status.HTTP_200_OK)


class FluctuacionPreciosView(APIView):
    """
    Series temporales de precios por producto:
    - compras: costo_por_kilo desde EntradaProducto (promedio por día).
    - ventas: precio_venta desde DetallePedido (excluyendo pedidos Anulado).

    Siempre devuelve la lista de productos (para el selector). Si se pasa
    ?producto=<id> devuelve las dos series de ese producto.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        productos = list(Producto.objects.values('id', 'nombre').order_by('nombre'))
        producto_id = request.query_params.get('producto')

        compras = []
        ventas = []
        if producto_id:
            compras_qs = (
                EntradaProducto.objects.filter(producto_id=producto_id)
                .annotate(dia=TruncMonth('fecha_entrada'))
                .values('dia')
                .annotate(costo=Avg('costo_por_kilo'))
                .order_by('dia')
            )
            compras = [{
                'fecha': r['dia'].strftime('%Y-%m') if r['dia'] else None,
                'costo': r['costo'],
            } for r in compras_qs]

            ventas_qs = (
                DetallePedido.objects.filter(producto_id=producto_id)
                .exclude(pedido__estado="Anulado")
                .annotate(dia=TruncMonth('fecha'))
                .values('dia')
                .annotate(precio=Avg('precio_venta'))
                .order_by('dia')
            )
            ventas = [{
                'fecha': r['dia'].strftime('%Y-%m') if r['dia'] else None,
                'precio': r['precio'],
            } for r in ventas_qs]

        return Response({
            'productos': productos,
            'producto_id': int(producto_id) if producto_id else None,
            'compras': compras,
            'ventas': ventas,
        }, status=status.HTTP_200_OK)


class MargenActualProductoView(APIView):
    """
    Margen actual por producto, para la vista previa en vivo al crear una
    Factura de compra. Por cada producto devuelve:
    - precio_por_kilo: precio de venta vigente (Producto.precio_por_kilo)
    - costo_reciente: último costo_por_kilo de EntradaProducto (SIN IVA, tal
      como se ingresa en la Factura de compra)
    - margen_unitario_actual / margen_pct_actual: vs. costo reciente CON IVA
      (costo_reciente * IVA_RATE), ya que ese es el costo real pagado.
    - margen_pct_historico: margen promedio de ventas NO anuladas, recalculado
      como (ventas - costo_neto * IVA_RATE) / ventas del producto (no se usa
      el campo persistido DetallePedido.margen porque se guardó sin IVA).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        productos = Producto.objects.all()

        # Último costo conocido por producto (neto, sin IVA)
        ultimo_costo = {}
        for e in EntradaProducto.objects.order_by('producto_id', '-fecha_entrada'):
            if e.producto_id not in ultimo_costo:
                ultimo_costo[e.producto_id] = e.costo_por_kilo

        # Margen histórico por producto (ventas no anuladas), costo con IVA
        hist = {
            r['producto_id']: r
            for r in DetallePedido.objects.exclude(pedido__estado="Anulado")
            .values('producto_id')
            .annotate(costo_neto=Coalesce(Sum('total_costo'), Decimal('0')),
                      ventas=Coalesce(Sum('total_venta'), Decimal('0')))
        }

        data = []
        for p in productos:
            costo_reciente = ultimo_costo.get(p.id)
            costo_reciente_con_iva = (costo_reciente * IVA_RATE) if costo_reciente is not None else None
            precio = p.precio_por_kilo or Decimal('0')
            margen_unit = (precio - costo_reciente_con_iva) if costo_reciente_con_iva is not None else None
            margen_pct = float(margen_unit / precio * 100) if (margen_unit is not None and precio) else None

            h = hist.get(p.id)
            margen_pct_hist = None
            if h and h['ventas']:
                ganancia_hist = h['ventas'] - (h['costo_neto'] * IVA_RATE)
                margen_pct_hist = float(ganancia_hist / h['ventas'] * 100)

            data.append({
                'producto_id': p.id,
                'nombre': p.nombre,
                'precio_por_kilo': precio,
                'costo_reciente': costo_reciente_con_iva,
                'margen_unitario_actual': margen_unit,
                'margen_pct_actual': round(margen_pct, 2) if margen_pct is not None else None,
                'margen_pct_historico': round(margen_pct_hist, 2) if margen_pct_hist is not None else None,
            })

        return Response(data, status=status.HTTP_200_OK)