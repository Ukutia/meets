// Tipos y etiquetas del Cierre de mes (ver backend core/views_cierre.py).
type Num = number | string;

export type EstadoCobro = 'pagado' | 'parcial' | 'pendiente';
export type EstadoTributario = 'emitido' | 'pendiente' | 'por_revisar';
export type Receptor = 'vendedor' | 'empresa';
export type EstadoDeclaracion = 'declarado' | 'pendiente' | 'diferido';

export interface CobroCierre {
  id: number; pedido: number; fecha: string; monto: Num; medio: string; receptor: Receptor;
  vendedor: number | null; vendedor_nombre: string | null; desde_banco: boolean; automatico: boolean;
  comprobante: string | null; comentario: string; usuario: string | null; creado: string;
}

export interface DocumentoCierre {
  id: number; tipo: number; tipo_nombre: string; folio: number; fecha_emision: string; pedido: number | null;
  rut_receptor: string; razon_social: string; exento: Num; neto: Num; iva: Num; total: Num;
  origen: 'manual' | 'sii' | 'openfactura'; ambiente: 'produccion' | 'pruebas'; estado_sii: string;
  pdf: string | null; comentario: string; usuario: string | null; creado: string;
}

export interface Emision { habilitada: boolean; ambiente: 'produccion' | 'pruebas' }

export interface PedidoCierre {
  id: number; fecha: string; estado: string;
  cliente: { id: number; nombre: string; tipo: string; rut: string; razon_social: string };
  vendedor: { id: number; nombre: string; sigla: string } | null;
  documento_requerido: 'Boleta' | 'Factura';
  total: Num; neto: Num; iva: Num; costo: Num; margen: Num; margen_pct: Num | null;
  cobrado: Num; saldo: Num; estado_cobro: EstadoCobro; estado_tributario: EstadoTributario;
  alertas: string[]; observaciones: string;
  // mes: el mes en que se considera; diferido = pasó a un mes posterior.
  declaracion: { estado: EstadoDeclaracion; mes: string; arrastrado: boolean; editable: boolean };
  lineas: { id: number; producto: string; kilos: Num; unidades: Num | null; venta_por_unidad: boolean;
    precio_venta: Num; total: Num; costo: Num; margen: Num }[];
  cobros: CobroCierre[];
  documentos: DocumentoCierre[];
}

export interface VentasMes {
  mes: string;
  rango: { desde: string; hasta: string } | null;
  resumen: {
    ventas_total: Num; ventas_netas: Num; iva_debito_teorico: Num; iva_debito_documentos: Num;
    cobrado: Num; saldo_pendiente: Num; costo: Num; margen: Num; margen_pct: Num | null;
    cobros_recibidos_mes: Num;
    cantidad: number; con_documento: number; sin_documento: number; por_revisar: number;
    pagados: number; parciales: number; pendientes_cobro: number; pagado_sin_cobro: number;
    cobros_por_confirmar: number;
    iva_declarado: Num; declarados: number; diferidos: number; arrastrados: number;
  };
  recibido_por: { nombre: string; monto: Num }[];
  por_vendedor: { vendedor: number | null; nombre: string; ventas_total: Num; cobrado: Num;
    saldo_pendiente: Num; margen: Num; cantidad: number }[];
  pedidos: PedidoCierre[];
  documentos_sin_pedido: DocumentoCierre[];
  config: { tasa_iva: Num; receptor_cobro: Receptor; emision: Emision };
}

export const MEDIOS_PAGO = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
];

export const TIPOS_DOCUMENTO = [
  { value: 39, label: 'Boleta electrónica' },
  { value: 33, label: 'Factura electrónica' },
  { value: 41, label: 'Boleta exenta' },
  { value: 34, label: 'Factura exenta' },
  { value: 61, label: 'Nota de crédito' },
  { value: 56, label: 'Nota de débito' },
];

export const ETIQUETA_COBRO: Record<EstadoCobro, { texto: string; clase: string }> = {
  pagado: { texto: 'Pagado', clase: 'bg-green-600/15 text-green-700 dark:text-green-400' },
  parcial: { texto: 'Parcial', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  pendiente: { texto: 'Por cobrar', clase: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
};

export const ETIQUETA_TRIBUTARIO: Record<EstadoTributario, { texto: string; clase: string }> = {
  emitido: { texto: 'Emitido', clase: 'bg-green-600/15 text-green-700 dark:text-green-400' },
  pendiente: { texto: 'Sin documento', clase: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  por_revisar: { texto: 'Revisar', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

export const ETIQUETA_DECLARACION: Record<EstadoDeclaracion, { texto: string; clase: string }> = {
  declarado: { texto: 'Declarado', clase: 'bg-green-600/15 text-green-700 dark:text-green-400' },
  pendiente: { texto: 'Sin declarar', clase: 'bg-muted text-muted-foreground' },
  diferido: { texto: 'Pasa a', clase: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
};

export const mesSiguiente = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

export const mesActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
