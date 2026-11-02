import type { Pedido, Vendedor } from '@/types';
import { enRango, type RangoFecha } from '@/lib/utils';

export interface PagoVendedor {
  id: number;
  vendedor: number;
  monto: number | string;
  comentario?: string;
  tipo: 'pago' | 'adelanto';
  fecha: string;
  comprobante?: string | null;
}

export interface SaldoVendedor extends Vendedor {
  saldoInicial: number;
  ventas: number;
  pagos: number;
  adelantos: number;
  // Lo que el vendedor aún debe rendir, incluido el saldo anterior.
  // Negativo = saldo a favor del vendedor.
  saldo: number;
}

// /pagos-vendedor/ responde { data: [...] }.
export function pagosDesdeRespuesta(body: unknown): PagoVendedor[] {
  if (Array.isArray(body)) return body;
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? data : [];
}

const idVendedorDe = (v: unknown) =>
  Number(typeof v === 'object' && v !== null ? (v as { id?: number }).id : v);

// `pedidos` debe venir SIN anulados. El adelanto es "saldo a favor" del
// vendedor (ver PagoVendedor.TIPOS en el backend), así que también descuenta.
export function calcularSaldosVendedores(
  vendedores: Vendedor[],
  pedidos: Pedido[],
  pagos: PagoVendedor[],
  rango: RangoFecha = {}
): SaldoVendedor[] {
  return vendedores.map((v) => {
    const anteriores = rango.desde ? { hasta: rango.desde } : null;
    const esAnterior = (fecha: string) => !!anteriores && enRango(fecha, anteriores) && !enRango(fecha, { desde: rango.desde });
    const saldoInicial = pedidos
      .filter((p) => idVendedorDe(p.vendedor) === v.id && esAnterior(p.fecha))
      .reduce((s, p) => s + Number(p.total || 0), 0)
      - pagos.filter((p) => idVendedorDe(p.vendedor) === v.id && esAnterior(p.fecha))
        .reduce((s, p) => s + Number(p.monto || 0), 0);
    const ventas = pedidos
      .filter((p) => idVendedorDe(p.vendedor) === v.id && enRango(p.fecha, rango))
      .reduce((s, p) => s + Number(p.total || 0), 0);
    const suma = (tipo: PagoVendedor['tipo']) =>
      pagos
        .filter((p) => idVendedorDe(p.vendedor) === v.id && p.tipo === tipo && enRango(p.fecha, rango))
        .reduce((s, p) => s + Number(p.monto || 0), 0);
    const pagosV = suma('pago');
    const adelantos = suma('adelanto');
    return { ...v, saldoInicial, ventas, pagos: pagosV, adelantos, saldo: saldoInicial + ventas - pagosV - adelantos };
  });
}
