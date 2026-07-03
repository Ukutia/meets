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


const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- INTERCEPTOR DE SEGURIDAD ---
// Este código se ejecuta antes de CADA petición a la API
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    // Agrega el token de Django (SimpleJWT) a las cabeceras
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const REFRESH_URL = '/token/refresh/';

const forceLogout = () => {
  localStorage.clear();
  window.location.href = '/login';
};

// Comparte una única llamada de refresh entre múltiples 401 simultáneos.
let refreshPromise: Promise<string> | null = null;

export const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = localStorage.getItem('refreshToken');
      if (!refresh) {
        throw new Error('No hay refreshToken disponible');
      }
      const response = await axios.post(`${API_BASE_URL}${REFRESH_URL}`, { refresh });
      const newAccess = response.data.access;
      localStorage.setItem('token', newAccess);
      return newAccess;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

// Interceptor para manejar errores 401 (Token expirado): refresca en background y reintenta.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes(REFRESH_URL)
    ) {
      originalRequest._retry = true;
      try {
        const newAccess = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return api(originalRequest);
      } catch {
        forceLogout();
        return new Promise(() => {}); // corta la cadena: ya estamos redirigiendo
      }
    }

    if (error.response?.status === 401 && originalRequest?.url?.includes(REFRESH_URL)) {
      forceLogout();
      return new Promise(() => {});
    }

    return Promise.reject(error);
  }
);

// --- AUTENTICACIÓN ---
export const loginRequest = (credentials: { username: string; password: string }) =>
  api.post('/token/', credentials); // El endpoint que configuramos en Django

export const refreshToken = (refresh: string) =>
  api.post(REFRESH_URL, { refresh });

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
  vendedor_id: number;
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
export const updateFactura = (numeroFactura: string, data: any) =>
  api.put<Factura>(`/facturas/${encodeURIComponent(numeroFactura)}/`, data);
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

export const updateCliente = (id: number, data: {
  nombre: string;
  direccion: string;
  telefono?: string;
  email?: string;
  vendedor_id: number;
}) => api.put<Cliente>(`/clientes/${id}/`, data);

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

// --- Reportes (Plan 03) ---
export const getReporteGanancias = (params?: { desde?: string; hasta?: string }) =>
  api.get('/reportes/ganancias/', { params });
export const getReportePerdidas = () => api.get('/reportes/perdidas/');
export const getFluctuacionPrecios = (productoId?: number | string) =>
  api.get('/reportes/fluctuacion-precios/', {
    params: productoId ? { producto: productoId } : undefined,
  });
export const getMargenProductos = () => api.get('/reportes/margen-productos/');

export default api;
