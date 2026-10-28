import type { PreReservaAsignada } from '@/types';

// Texto para el toast cuando una entrada de stock llena pre-reservas pendientes.
export function resumenPreReservas(asignadas?: PreReservaAsignada[]): string {
  if (!asignadas || asignadas.length === 0) return '';
  return asignadas
    .map((a) =>
      `Pedido #${a.pedido}: ${a.unidades} un. de ${a.producto} asignadas` +
      (a.completa ? ' (pasa a Reservado)' : ' (aún quedan unidades pendientes)')
    )
    .join('\n');
}
