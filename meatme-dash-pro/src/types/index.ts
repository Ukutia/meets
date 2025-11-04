export interface Vendedor {
  id: number;
  nombre: string;
  sigla: string;
}

export interface Cliente {
  id: number;
  nombre: string;
  telefono?: string;
  direccion?: string;
  vendedor: number;
  vendedor_nombre?: string;
  vendedor_sigla?: string;
}

export interface Producto {
  id: number;
  nombre: string;
  categoria: string;
  precio_por_kilo: number;
  estado: 'activo' | 'inactivo';
  descripcion?: string;
}

export interface DetallePedido {
  id?: number;
  producto: number;
  producto_nombre?: string;
  kilos: number;
  unidades: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Pedido {
  id: number;
  cliente: number;
  cliente_nombre?: string;
  vendedor_nombre?: string;
  fecha: string;
  estado: 'Reservado' | 'Preparado' | 'Entregado' | 'Cancelado';
  total: number;
  detalles: DetallePedido[];
  observaciones?: string;
}

export interface DetalleFactura {
  id?: number;
  producto: number;
  producto_nombre?: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Factura {
  id: number;
  fecha: string;
  total: number;
  pagado: boolean;
  fecha_pago?: string;
  metodo_pago?: string;
  detalles: DetalleFactura[];
  cliente?: number;
  cliente_nombre?: string;
}

export interface StockItem {
  producto: number;
  producto_nombre: string;
  categoria: string;
  stock_actual: number;
  precio_por_kilo: number;
  valor_total: number;
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
