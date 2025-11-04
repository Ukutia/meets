export interface Vendedor {
  id: number;
  nombre: string;
  sigla: string;
}

export interface Cliente {
  id: number;
  nombre: string;
  telefono?: string | null;
  direccion?: string | null;
  email?: string | null;
  vendedor: Vendedor;
}

export interface Producto {
  id: number;
  nombre: string;
  descripcion?: string | null;
  categoria?: string | null;
  precio_por_kilo: number;
  estado: 'disponible' | 'agotado';
}

export interface DetallePedido {
  id: number;
  producto: Producto;
  cantidad_unidades: number;
  cantidad_kilos: number;
  total_venta: number;
  total_costo: number;
  facturas: number[];
}

export interface Pedido {
  id: number;
  cliente: Cliente;
  vendedor: Vendedor;
  fecha: string;
  estado: 'Reservado' | 'Preparado' | 'Anulado' | 'Pagado';
  total: number;
  detalles: DetallePedido[];
}

export interface DetalleFactura {
  producto: Producto;
  cantidad_kilos: number;
  costo_total: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
}

export interface PagoFactura {
  fecha_de_pago: string;
  monto_del_pago: number;
}

export interface Factura {
  proveedor: string;
  fecha: string;
  numero_factura: string;
  detalles: DetalleFactura[];
  pago_factura?: PagoFactura | null;
  total: number;
  subtotal: number;
  iva: number;
}

export interface StockItem {
  producto: string;
  precio_por_kilo: number;
  disponibles: number;
  stock: number;
  reservas: number;
  kilos_actuales: number;
}

export interface KPI {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: {
    value: number;
    positive: boolean;
  };
}
