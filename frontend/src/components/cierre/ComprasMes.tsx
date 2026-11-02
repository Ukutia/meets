import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getFacturas } from '@/services/api';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { formatCLP, formatFecha } from '@/lib/utils';
import { totalAPagar } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';

export function ComprasMes({ mes }: { mes: string }) {
  const { enPeriodo } = usePeriodo();
  const [busqueda, setBusqueda] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['facturas'], queryFn: async () => (await getFacturas()).data });
  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar las facturas de compra" />;
  const facturas = (data ?? []).filter(f => f.fecha.slice(0, 7) === mes && enPeriodo(f.fecha));
  const fueraDelMes = (data ?? []).filter(f => f.fecha.slice(0, 7) !== mes && enPeriodo(f.fecha)).length;
  const filtradas = facturas.filter(f => `${f.numero_factura} ${f.proveedor_nombre ?? ''}`.toLowerCase().includes(busqueda.trim().toLowerCase()))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const compras = facturas.reduce((s, f) => s + Number(f.total), 0);
  const notas = facturas.reduce((s, f) => s + Number(f.total_notas_credito ?? 0), 0);
  const pendiente = facturas.reduce((s, f) => s + Math.max(totalAPagar(f) - Number(f.pago_factura?.monto_del_pago ?? 0), 0), 0);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Facturas de compra registradas</h2><p className="text-sm text-muted-foreground">Según fecha de la factura, dentro del mes y período seleccionados.</p></div><Button variant="outline" asChild><Link to="/facturas">Administrar facturas</Link></Button></div>
    <div className="grid gap-3 sm:grid-cols-3">
      {[['Compras con IVA', compras], ['Notas de crédito de estas facturas', notas], ['Saldo por pagar de estas facturas', pendiente]].map(([label, valor]) => <div key={String(label)} className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{formatCLP(Number(valor))}</p></div>)}
    </div>
    <Input aria-label="Buscar factura de compra" placeholder="Buscar por folio o proveedor…" value={busqueda} onChange={e => setBusqueda(e.target.value)} className="max-w-sm" />
    <div className="rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>Factura</TableHead><TableHead>Fecha</TableHead><TableHead>Proveedor</TableHead><TableHead className="text-right">Total con IVA</TableHead><TableHead className="text-right">Notas de crédito</TableHead><TableHead className="text-right">Saldo por pagar</TableHead></TableRow></TableHeader><TableBody>
      {filtradas.map(f => <TableRow key={f.numero_factura}><TableCell className="font-medium"><Link className="underline underline-offset-4" to={`/facturas?buscar=${encodeURIComponent(f.numero_factura)}`}>{f.numero_factura}</Link></TableCell><TableCell>{formatFecha(f.fecha)}</TableCell><TableCell>{f.proveedor_nombre ?? 'Sin proveedor'}</TableCell><TableCell className="text-right tabular-nums">{formatCLP(f.total)}</TableCell><TableCell className="text-right tabular-nums">{formatCLP(f.total_notas_credito ?? 0)}</TableCell><TableCell className="text-right tabular-nums">{formatCLP(Math.max(totalAPagar(f) - Number(f.pago_factura?.monto_del_pago ?? 0), 0))}</TableCell></TableRow>)}
      {!filtradas.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">{busqueda ? 'No hay facturas que coincidan con la búsqueda.' : 'No hay facturas de compra en este mes y período. Revisa el selector de mes o administra tus facturas.'}</TableCell></TableRow>}
    </TableBody></Table></div>
    <p className="text-xs text-muted-foreground">{facturas.length} facturas del período. Los saldos incluyen los pagos y notas de crédito registrados hasta ahora. La comparación con el SII está en Revisión tributaria.</p>
    {fueraDelMes > 0 && <p className="text-sm text-muted-foreground">Hay {fueraDelMes} facturas en otros meses del período seleccionado. Cambia el mes o usa Administrar facturas para verlas.</p>}
  </div>;
}
