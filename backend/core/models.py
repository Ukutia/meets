from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import settings
from django.conf import settings
# Create your models here.
class Vendedor(models.Model):
    id = models.AutoField(primary_key=True)  # Campo ID automático
    nombre = models.CharField(max_length=100)  # Nombre completo del vendedor
    sigla = models.CharField(max_length=10, unique=True)  # Sigla única para identificar al vendedor
    telefono = models.CharField(max_length=30, blank=True, default='')  # Teléfono de contacto (se imprime en el flyer)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='vendedor_profile'
    )

    def __str__(self):
        return f"{self.nombre} ({self.sigla})"  # Mostrar nombre y sigla en el admin
    

class Cliente(models.Model):
    id = models.AutoField(primary_key=True)  # Campo ID automático
    nombre = models.CharField(max_length=100)  # Nombre del cliente
    vendedor = models.ForeignKey(
        Vendedor,  # Relación con el modelo de usuario (empleado/vendedor)
        on_delete=models.SET_NULL,  # Si el vendedor se elimina, dejar el campo como NULL
        null=True,
        blank=True,
        related_name='clientes'  # Permite acceder a los clientes de un vendedor con user.clientes
    )
    direccion = models.CharField(max_length=255)  # Dirección del cliente
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True,null=True)

    # Mayoristas: datos de la empresa a la que se le emite la factura.
    tipo_cliente = models.CharField(
        max_length=10,
        choices=[("minorista", "Minorista"), ("mayorista", "Mayorista")],
        default="minorista",
    )
    rut = models.CharField(max_length=15, blank=True, default='')
    razon_social = models.CharField(max_length=150, blank=True, default='')
    giro = models.CharField(max_length=150, blank=True, default='')
    direccion_facturacion = models.CharField(max_length=255, blank=True, default='')
    comuna = models.CharField(max_length=80, blank=True, default='')
    ciudad = models.CharField(max_length=80, blank=True, default='')
    email_facturacion = models.EmailField(blank=True, default='')
    contacto = models.CharField(max_length=100, blank=True, default='')

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre  # Mostrar el nombre del cliente en el admin de Django


class Producto(models.Model):
    id = models.AutoField(primary_key=True)  # Campo ID automático
    nombre = models.CharField(max_length=100, verbose_name="Nombre del producto")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    precio_por_kilo = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Precio por kilo")
    peso_minimo = models.DecimalField(
        max_digits=10, 
        decimal_places=3, 
        default=0.000, 
        verbose_name="Peso mínimo por unidad (kg)",
        help_text="Útil para detectar errores de digitación en el pesaje"
    )
    venta_por_unidad = models.BooleanField(
        default=False,
        verbose_name="Precio por unidad en el flyer",
        help_text="Si está marcado, el flyer muestra el precio como 'c/u' en vez de por kilo"
    )
    peso_flyer = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name="Peso aproximado en el flyer",
        help_text="Texto fijo (ej: 'paquete de 1 kg'). Vacío = se calcula desde el stock"
    )

    def stock_actual(self):
        entradas = self.facturas_entrada.aggregate(total=models.Sum('cantidad'))['total'] or 0
        salidas = self.ventas.aggregate(total=models.Sum('cantidad'))['total'] or 0
        ajustes = self.ajustesI.aggregate(total=models.Sum('cantidad'))['total'] or 0
        return entradas - salidas + ajustes

    facturas_entrada = models.ForeignKey(
        'DetalleFactura', 
        on_delete=models.CASCADE, 
        related_name='productos', 
        blank=True, 
        null=True
    )
    ventas = models.ForeignKey(
        'DetallePedido', 
        on_delete=models.CASCADE, 
        related_name='productos', 
        blank=True, 
        null=True
    )
    ajustesI = models.ForeignKey(
        'AjusteInventario', 
        on_delete=models.CASCADE, 
        related_name='productos', 
        blank=True, 
        null=True
    )






    categoria = models.CharField(
        max_length=50, blank=True, null=True, choices=[
            ("al vacio", "Al Vacio"),
            ("congelado", "Congelado")
        ],
        verbose_name="Categoría"
    )
    estado = models.CharField(
        max_length=20, choices=[("disponible", "Disponible"), ("agotado", "Agotado"), ("desactivado", "Desactivado")],
        default="disponible", verbose_name="Estado del producto"
    )
    detalles_pedido = models.ManyToManyField(
        'Pedido',
        through='DetallePedido',
        related_name='productos',
        verbose_name="Detalles del pedido"
    )

    def __str__(self):
        return self.nombre


class HistorialPrecioProducto(models.Model):
    producto = models.ForeignKey(
        Producto, on_delete=models.CASCADE, related_name='historial_precios'
    )
    precio_anterior = models.DecimalField(max_digits=10, decimal_places=2)
    precio_nuevo = models.DecimalField(max_digits=10, decimal_places=2)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cambios_precio_producto'
    )
    fecha_cambio = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha_cambio']

    def __str__(self):
        return f"{self.producto.nombre}: {self.precio_anterior} -> {self.precio_nuevo}"


class AjusteInventario(models.Model):
    TIPO_AJUSTE = [
        ("merma", "Merma"),
        ("exceso", "Exceso"),
        ("ajuste", "Ajuste Manual"),
    ]

    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name="ajustes")
    cantidad = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        verbose_name="Kilos ajustados (puede ser positiva o negativa)"
    )
    cantidad_unidades = models.IntegerField(
        default=0,
        verbose_name="Unidades ajustadas (puede ser positiva o negativa)"
    )
    tipo = models.CharField(max_length=20, choices=TIPO_AJUSTE, verbose_name="Tipo de ajuste")
    razon = models.TextField(blank=True, null=True, verbose_name="Razón del ajuste")
    fecha = models.DateField(auto_now_add=True, verbose_name="Fecha del ajuste")

    def __str__(self):
        return f"Ajuste de {self.producto.nombre} - {self.cantidad} kg / {self.cantidad_unidades} un ({self.tipo})"


    



class Pedido(models.Model):
    id = models.AutoField(primary_key=True)  # Campo ID automático
    cliente = models.ForeignKey(
        'Cliente', on_delete=models.CASCADE, verbose_name="Cliente"
    )
    vendedor = models.ForeignKey(
        'Vendedor', on_delete=models.SET_NULL, null=True, verbose_name="Vendedor"
    )
    fecha = models.DateTimeField(auto_now_add=True, verbose_name="Fecha del pedido")
    estado = models.CharField(
        max_length=20,
        choices=[
            ("Reservado", "Reservado"),
            ("Preparado", "Preparado"),
            ("Anulado", "Anulado"),
            ("Pagado", "Pagado"),
        ],
        default="Reservado",
        verbose_name="Estado del pedido"
    )
    total = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Total del pedido", default=0)

    tipo_recibo = models.CharField(
        max_length=10,
        choices=[
            ("Boleta", "Boleta"),
            ("Factura", "Factura"),
        ],
        default="Boleta",
        verbose_name="Tipo de Recibo"
    )

    recibo = models.ImageField(
        upload_to="recibo_pedidos/", blank=True, null=True, verbose_name="Recibo (Foto)"
    )

    # Notas de entrega que se escriben al crear el pedido (horario, portón, etc.).
    observaciones = models.TextField(blank=True, default='', verbose_name="Observaciones")

    def __str__(self):
        return f"Pedido #{self.id} - Cliente: {self.cliente.nombre}"
    


class DetallePedido(models.Model):
    pedido = models.ForeignKey(Pedido, on_delete=models.CASCADE, related_name="detalles", verbose_name="Pedido")
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, verbose_name="Producto")
    cantidad_kilos = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, verbose_name="Cantidad en kilos",default=0)
    cantidad_unidades = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, verbose_name="Cantidad en Unidades")
    precio_venta = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Precio de venta (por kilo)")
    # Cómo se fijó precio_venta en esta línea (el precio del producto sigue siendo el default):
    #   lista         -> precio vigente del producto
    #   descuento     -> precio vigente - descuento_por_kilo
    #   personalizado -> precio escrito a mano
    #   costo         -> costo/kg ponderado de los lotes + IVA (ni gana ni pierde)
    modo_precio = models.CharField(
        max_length=15,
        choices=[("lista", "Lista"), ("descuento", "Descuento"), ("personalizado", "Personalizado"), ("costo", "A costo")],
        default="lista",
    )
    precio_lista = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Precio vigente del producto al momento de la venta (referencia para el descuento)"
    )
    descuento_por_kilo = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        verbose_name="Descuento por kilo",
        help_text="Monto descontado del precio por kilo de ESTE producto en este pedido (precio_venta ya lo refleja). No cambia el precio general del producto."
    )
    costo_por_kilo = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Costo por kilo en la venta", default=0)
    total_venta = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Total de la venta",default=0)
    total_costo = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Total del costo", default=0)
    margen = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Margen", default=0)
    fecha = models.DateField(auto_now_add=True, verbose_name="Fecha de venta")
    facturas = models.ManyToManyField('Factura', related_name='detalles_pedido', verbose_name="Facturas",default=0)
    estado = models.CharField(
        max_length=20,
        choices=[("Activo", "Activo"), ("Cancelado", "Cancelado")],
        default="Activo",
        verbose_name="Estado de la línea",
        help_text="Cancelado = el producto fue quitado del pedido y su stock/costo ya fue revertido"
    )


    def save(self, *args, **kwargs):
        # Modelo de costo (elegido): costo_por_kilo es el costo de compra por
        # kilo con el proveedor (promedio ponderado de los lotes que abastecieron
        # la venta, ver costo_por_kilo_ponderado en utils.py) y total_costo se
        # deriva como ese costo/kg * los kilos REALMENTE vendidos (bascula).
        #
        # Se prefirio esto sobre "costo real de compra por pieza" (peso de lote *
        # costo/kg) porque los pesos por pieza estan corruptos en ~30% de los
        # datos historicos (ventas que figuran pesando mas de lo comprado), lo
        # que hacia estallar el costo reconstruido. Este modelo solo usa datos
        # confiables: costo/kg del proveedor y kilos de bascula.
        # Siempre se deriva (también con 0 kg): si una línea pesada vuelve a 0 kg
        # el costo viejo no puede quedar pegado inflando el costo del pedido.
        self.total_costo = (self.cantidad_kilos or 0) * self.costo_por_kilo

        self.margen = self.total_venta - self.total_costo

        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.producto.nombre} - {self.cantidad_kilos} kg"

    class Meta:
        verbose_name = "Detalle del pedido"
        verbose_name_plural = "Detalles de pedidos"


class Proveedor(models.Model):
    nombre = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.nombre



class Factura(models.Model):
    proveedor = models.ForeignKey(Proveedor, on_delete=models.PROTECT, related_name="facturas")
    fecha = models.DateField(verbose_name="Fecha de la factura")
    numero_factura = models.CharField(max_length=50, unique=True, verbose_name="Número de factura" ,primary_key=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Subtotal")
    iva = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="IVA")
    total = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Total con IVA")
    fecha_vencimiento = models.DateField(null=True, blank=True, verbose_name="Fecha de vencimiento")
    foto = models.FileField(upload_to="facturas/", blank=True, null=True, verbose_name="Foto o PDF de la factura")

    def total_notas_credito(self):
        return self.notas_credito.aggregate(t=models.Sum('total'))['t'] or 0

    def __str__(self):
        return f"Factura {self.numero_factura} - {self.proveedor} - {self.fecha}"

    class Meta:
        verbose_name = "Factura"
        verbose_name_plural = "Facturas"
        ordering = ['-fecha']


class FacturaDetallePedido(models.Model):
    detallepedido = models.ForeignKey(DetallePedido, on_delete=models.CASCADE)
    factura = models.ForeignKey(Factura, on_delete=models.CASCADE)
    cantidad_unidades = models.IntegerField(default=0)

    class Meta:
        unique_together = ('detallepedido', 'factura')


class DetalleFactura(models.Model):
    factura = models.ForeignKey(
        Factura, on_delete=models.CASCADE, related_name="detalles", verbose_name="Factura"
    )

    producto = models.ForeignKey(
        Producto, on_delete=models.CASCADE, verbose_name="Producto"
    )
    cantidad_kilos = models.DecimalField(
        max_digits=10, decimal_places=2, verbose_name="Cantidad en kilos"
    )
    cantidad_unidades = models.DecimalField(
        max_digits=10, decimal_places=0, verbose_name="Cantidad en Unidades"
    )
    costo_por_kilo = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Costo por kilo")
    costo_total = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Costo total")

    def __str__(self):
        return f"Factura {self.factura.numero_factura} - {self.producto.nombre} - {self.cantidad_kilos} kg"

    class Meta:
        verbose_name = "Detalle de factura"
        verbose_name_plural = "Detalles de facturas"

class PagoFactura(models.Model):
    factura = models.OneToOneField(
        Factura, 
        on_delete=models.CASCADE, 
        related_name="pago_factura", 
        verbose_name="Factura"
    )
    fecha_de_pago = models.DateField(verbose_name="Fecha de pago")
    monto_del_pago = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Monto del pago")

    def __str__(self):
        return f"Pago de Factura {self.factura.numero_factura} - {self.monto_del_pago} - {self.fecha_de_pago}"

    class Meta:
        verbose_name = "Pago de Factura"
        verbose_name_plural = "Pagos de Facturas"


class PagoVendedor(models.Model):
    TIPOS = [
        ('pago', 'Pago de Venta'),
        ('adelanto', 'Adelanto / Saldo a Favor'),
    ]
    id = models.AutoField(primary_key=True)  # ID automático
    vendedor = models.ForeignKey(
        Vendedor, on_delete=models.CASCADE, related_name="pagos", verbose_name="Vendedor"
    )
    tipo = models.CharField(max_length=10, choices=TIPOS, default='pago')
    monto = models.DecimalField(
        max_digits=10, decimal_places=2, verbose_name="Monto del pago"
    )
    comprobante = models.ImageField(
        upload_to="comprobantes_pagos/", blank=True, null=True, verbose_name="Comprobante (Foto)"
    )
    comentario = models.TextField(
        blank=True, null=True, verbose_name="Comentario"
    )
    fecha = models.DateTimeField(auto_now_add=True, verbose_name="Fecha del pago")

    def __str__(self):
        return f"Pago de {self.vendedor.nombre} - {self.monto} - {self.fecha.strftime('%d/%m/%Y')}"

    class Meta:
        verbose_name = "Pago del Vendedor"
        verbose_name_plural = "Pagos de Vendedores"
        ordering = ['-fecha']


class EntradaProducto(models.Model):
    factura = models.ForeignKey(Factura, on_delete=models.CASCADE)
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE)
    cantidad_kilos = models.DecimalField(max_digits=10, decimal_places=2)
    cantidad_unidades = models.IntegerField(default=0)
    costo_por_kilo = models.DecimalField(max_digits=10, decimal_places=2)
    # OJO: NO usar auto_now_add. Este campo es la clave de orden del FIFO
    # (consumir_fifo ordena por fecha_entrada), y auto_now_add IGNORA en el
    # INSERT cualquier fecha que se le pase. Eso hacia que CancelarPedido
    # calculara una fecha retrodatada para devolver el stock a su posicion FIFO
    # original (ver views.py) y Django la descartara en silencio: las
    # devoluciones quedaban como los lotes MAS NUEVOS y se consumian al final.
    # Con default=timezone.now se mantiene el mismo comportamiento al crear sin
    # fecha, pero la fecha explicita si se respeta.
    fecha_entrada = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.producto.nombre} - {self.cantidad_kilos} kg - {self.costo_por_kilo} por kilo"


class NotaCredito(models.Model):
    """Nota de crédito del proveedor sobre una factura de compra (devolución,
    diferencia de precio o de peso). Es solo financiera: rebaja lo que se le
    debe al proveedor y el crédito fiscal de IVA del mes; no mueve stock."""
    factura = models.ForeignKey(Factura, on_delete=models.CASCADE, related_name="notas_credito")
    numero = models.CharField(max_length=50)
    fecha = models.DateField()
    neto = models.DecimalField(max_digits=12, decimal_places=2)
    iva = models.DecimalField(max_digits=12, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    motivo = models.CharField(max_length=255, blank=True, default='')
    foto = models.FileField(upload_to="notas_credito/", blank=True, null=True)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-id']
        unique_together = ('factura', 'numero')

    def __str__(self):
        return f"NC {self.numero} (factura {self.factura_id})"


class PerfilUsuario(models.Model):
    """Datos propios de cada usuario (con o sin perfil de vendedor) para su flyer."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='perfil')
    telefono = models.CharField(max_length=30, blank=True, default='')
    foto1 = models.ImageField(upload_to="flyer/", blank=True, null=True)
    foto2 = models.ImageField(upload_to="flyer/", blank=True, null=True)
    logo = models.ImageField(upload_to="flyer/", blank=True, null=True)
    mensaje_whatsapp = models.TextField(blank=True, default='')

    def __str__(self):
        return f"Perfil de {self.user}"


class Cartola(models.Model):
    """Un archivo de cartola bancaria subido. Los movimientos se deduplican por
    huella, así que subir dos cartolas que se traslapan no duplica nada."""
    nombre_archivo = models.CharField(max_length=255)
    banco = models.CharField(max_length=100, blank=True, default='')
    subida = models.DateTimeField(auto_now_add=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    movimientos_nuevos = models.IntegerField(default=0)
    movimientos_duplicados = models.IntegerField(default=0)
    metodo = models.CharField(max_length=20, default='planilla')  # planilla | ia

    class Meta:
        ordering = ['-subida']


CATEGORIAS_MOVIMIENTO = [
    ("sin_clasificar", "Sin clasificar"),
    ("venta", "Pago de cliente"),
    ("proveedor", "Pago a proveedor"),
    ("gasto", "Gasto"),
    ("impuesto", "Impuestos (IVA/PPM)"),
    ("sueldo", "Sueldos / retiros"),
    ("traspaso", "Traspaso entre cuentas"),
    ("otro", "Otro"),
]


class MovimientoBancario(models.Model):
    cartola = models.ForeignKey(Cartola, on_delete=models.SET_NULL, null=True, blank=True, related_name='movimientos')
    fecha = models.DateField()
    descripcion = models.CharField(max_length=255)
    # Positivo = abono (entra plata), negativo = cargo (sale plata).
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    saldo = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    documento = models.CharField(max_length=60, blank=True, default='')
    huella = models.CharField(max_length=64, unique=True)
    categoria = models.CharField(max_length=20, choices=CATEGORIAS_MOVIMIENTO, default="sin_clasificar")
    comentario = models.TextField(blank=True, default='')
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-id']

    def monto_asignado(self):
        return self.asignaciones.aggregate(t=models.Sum('monto'))['t'] or 0


class AsignacionMovimiento(models.Model):
    """Parte (o todo) de un movimiento bancario asociado a un pedido (cobro) o a
    una factura de compra (pago a proveedor)."""
    movimiento = models.ForeignKey(MovimientoBancario, on_delete=models.CASCADE, related_name='asignaciones')
    pedido = models.ForeignKey(Pedido, on_delete=models.CASCADE, null=True, blank=True, related_name='asignaciones_banco')
    factura = models.ForeignKey(Factura, on_delete=models.CASCADE, null=True, blank=True, related_name='asignaciones_banco')
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    creado = models.DateTimeField(auto_now_add=True)


CATEGORIAS_GASTO = [
    ("arriendo", "Arriendo"),
    ("servicios", "Luz, agua, gas, internet"),
    ("transporte", "Transporte / combustible"),
    ("insumos", "Insumos y envases"),
    ("sueldos", "Sueldos y honorarios"),
    ("marketing", "Publicidad"),
    ("comisiones", "Comisiones bancarias"),
    ("contador", "Contador / trámites"),
    ("otro", "Otro"),
]


class Gasto(models.Model):
    """Gasto de la empresa que no es mercadería (eso va en Factura). Si viene con
    factura, su IVA es crédito fiscal."""
    fecha = models.DateField()
    descripcion = models.CharField(max_length=255)
    categoria = models.CharField(max_length=20, choices=CATEGORIAS_GASTO, default="otro")
    neto = models.DecimalField(max_digits=12, decimal_places=2)
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    con_factura = models.BooleanField(default=False)
    movimiento = models.ForeignKey(MovimientoBancario, on_delete=models.SET_NULL, null=True, blank=True, related_name='gastos')
    comentario = models.TextField(blank=True, default='')
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-id']


class ConfiguracionContable(models.Model):
    """Fila única (pk=1) con las tasas usadas en las estimaciones."""
    tasa_impuesto_renta = models.DecimalField(max_digits=5, decimal_places=2, default=25,
                                              help_text="Impuesto de primera categoría, %")
    tasa_ppm = models.DecimalField(max_digits=5, decimal_places=3, default=0.25,
                                   help_text="Pago provisional mensual sobre ingresos netos, %")

    @classmethod
    def actual(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj




class ConteoInventario(models.Model):
    """Una cuadratura de inventario: el usuario cuenta lo que hay y se compara con el sistema."""
    fecha = models.DateTimeField(default=timezone.now)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="conteos_inventario"
    )
    notas = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"Conteo #{self.id} ({self.fecha:%Y-%m-%d})"


class DetalleConteo(models.Model):
    """Lo que el sistema decia vs. lo contado, por producto. Kilos/unidades en None = no se conto."""
    conteo = models.ForeignKey(ConteoInventario, on_delete=models.CASCADE, related_name="detalles")
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name="conteos")
    sistema_kilos = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sistema_unidades = models.IntegerField(default=0)
    contado_kilos = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    contado_unidades = models.IntegerField(null=True, blank=True)
    diferencia_kilos = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    diferencia_unidades = models.IntegerField(default=0)
    ajuste = models.ForeignKey(AjusteInventario, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
