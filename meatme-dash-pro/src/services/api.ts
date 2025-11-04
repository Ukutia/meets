import axios from 'axios';
import type {
  Producto,
  Cliente,
  Pedido,
  Factura,
  StockItem,
  Vendedor,
} from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Productos
export const getProductos = () => api.get<Producto[]>('/productos/');
export const getProducto = (id: number) => api.get<Producto>(`/productos/${id}/`);
export const createProducto = (data: Partial<Producto>) => api.post<Producto>('/productos/', data);
export const updateProducto = (id: number, data: Partial<Producto>) =>
  api.put<Producto>(`/productos/${id}/`, data);
export const deleteProducto = (id: number) => api.delete(`/productos/${id}/`);

// Clientes
export const getClientes = () => api.get<Cliente[]>('/clientes/');
export const getCliente = (id: number) => api.get<Cliente>(`/clientes/${id}/`);
export const createCliente = (data: Partial<Cliente>) => api.post<Cliente>('/clientes/', data);
export const updateCliente = (id: number, data: Partial<Cliente>) =>
  api.put<Cliente>(`/clientes/${id}/`, data);
export const deleteCliente = (id: number) => api.delete(`/clientes/${id}/`);

// Pedidos
export const getPedidos = () => api.get<Pedido[]>('/pedidos/');
export const getPedido = (id: number) => api.get<Pedido>(`/pedidos/${id}/`);
export const createPedido = (data: Partial<Pedido>) => api.post<Pedido>('/pedidos/', data);
export const updatePedido = (id: number, data: Partial<Pedido>) =>
  api.put<Pedido>(`/pedidos/${id}/`, data);
export const cancelarPedido = (id: number) => api.post(`/pedidos/cancelar/`, { pedido_id: id });
export const actualizarKilosPedido = (id: number, detalles: any[]) =>
  api.post(`/pedidos/actualizar_kilos/${id}/`, { detalles });

// Facturas
export const getFacturas = () => api.get<Factura[]>('/facturas/');
export const getFactura = (id: number) => api.get<Factura>(`/facturas/${id}/`);
export const createFactura = (data: Partial<Factura>) => api.post<Factura>('/facturas/', data);
export const pagarFactura = (id: number, metodoPago: string, fechaPago: string) =>
  api.post(`/facturas/pagar/`, {
    factura_id: id,
    metodo_pago: metodoPago,
    fecha_pago: fechaPago,
  });

// Stock
export const getStock = () => api.get<StockItem[]>('/stock/');

// Vendedores
export const getVendedores = () => api.get<Vendedor[]>('/vendedores/');

export default api;
