import axios from 'axios';
import type {
  Producto,
  Cliente,
  Pedido,
  Factura,
  StockItem,
  Vendedor,
  Proveedor
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/apaaaaaaaaaaaai';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Productos
export const getProveedores = () => api.get<Proveedor[]>('/proveedores/');
export const getProductos = () => api.get<Producto[]>('/productos/');
export const createProducto = (data: {
  nombre: string;
  descripcion?: string;
  categoria?: string;
  precio_por_kilo: number;
  estado?: string;
}) => api.post<Producto>('/productos/crear/', data);
export const updateProducto = (id: number, data: Partial<Producto>) =>
  api.put<Producto>(`/productos/${id}/`, data);

// Clientes
export const getClientes = () => api.get<Cliente[]>('/clientes/');
export const createCliente = (data: {
  nombre: string;
  direccion: string;
  telefono?: string;
  email?: string;
  vendedor: number;
}) => api.post<Cliente>('/clientes/crear/', data);

// Pedidos
export const getPedidos = () => api.get<Pedido[]>('/pedidos/');
export const getPedido = (id: number) => api.get<Pedido>(`/pedidos/${id}/`);
export const createPedido = (data: {
  cliente: number;
  vendedor: number;
  detalles: {
    producto: number;
    cantidad_kilos: number;
    cantidad_unidades: number;
  }[];
}) => api.post<Pedido>('/pedidos/crear/', data);
export const cancelarPedido = (id: number) => api.post(`/pedidos/cancelar/`, { pedido_id: id });
export const actualizarKilosPedido = (id: number, detalles: any[]) =>
  api.post(`/pedidos/actualizar_kilos/${id}/`, { detalles });

// Facturas
export const getFacturas = () => api.get<Factura[]>('/facturas/');
export const createFactura = (data: any) => api.post('/facturas/crear/', data);
export const pagarFactura = (factura: string, fecha_de_pago: string, monto_del_pago: number) =>
  api.post(`/facturas/pagar/`, {
    factura,
    fecha_de_pago,
    monto_del_pago,
  });

// Pagos Vendedores
export const getPagosVendedor = (vendedorId?: string) => 
  api.get(`/pagos-vendedor/${vendedorId ? `?vendedor=${vendedorId}` : ''}`);

export const createPagoVendedor = (formData: FormData) => 
  api.post('/pagos-vendedor/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

// En services/api.ts

// Obtener un solo pedido para editar
export const getPedidoById = async (id: number) => {
  const response = await api.get(`/pedidos/${id}/`);
  return response.data;
};



// Actualizar pedido (PUT o PATCH)
export const updatePedido = async (id: number, data: any) => {
  const response = await api.put(`/pedidos/${id}/`, data);
  return response.data;
};


export const getDetalleFacturas = async () => {
  return await api.get('/inventario/detalle-facturas/');
};

// Obtener detalles de todos los pedidos (Salidas)
export const getDetallePedidos = async () => {
  return await api.get('/inventario/detalle-pedidos/');
};

// Stock
export const getStock = () => api.get<StockItem[]>('/stock/');
// Vendedores
export const getVendedores = () => api.get<Vendedor[]>('/vendedores/');

export default api;
