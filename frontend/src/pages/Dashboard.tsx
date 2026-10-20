import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, ShoppingCart, TrendingUp, HandCoins, FileText, AlertCircle, Scale, Wallet, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/StatCard';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  getStock, getPedidos, getFacturas, getReporteGanancias, getVendedores, getPagosVendedor,
} from '@/services/api';
import type { Factura, Pedido, StockItem, Vendedor } from '@/types';
import { diasDesde, enRango, formatCLP, formatFecha, rangoDesdePreset } from '@/lib/utils';
import { calcularSaldosVendedores, pagosDesdeRespuesta } from '@/lib/saldos';

// Bajo este número de unidades disponibles un corte aparece en "Stock bajo".
const UMBRAL_STOCK_BAJO = 10;

export default function Dashboard() {
  const navigate = useNavigate();

  // Mismas claves y formas que las páginas de detalle para compartir caché.
  const pedidosQ = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => (await getPedidos(true)).data as Pedido[],
  });
  const stockQ = useQuery({
    queryKey: ['stock'],
    queryFn: async () => (await getStock()).data,
  });
  const facturasQ = useQuery({
    queryKey: ['facturas'],
    queryFn: async () => (await getFacturas()).data as Factura[],
  });
  const mes = rangoDesdePreset('mes');
  const gananciaQ = useQuery({
    queryKey: ['reporte-ganancias', mes],
    queryFn: async () => (await getReporteGanancias(mes)).data,
  });
  const vendedoresQ = useQuery({ queryKey: ['vendedores'], queryFn: async () => (await getVendedores()).data as Vendedor[] });
  const pagosQ = useQuery({ queryKey: ['pagos-vendedor'], queryFn: async () => pagosDesdeRespuesta((await getPagosVendedor()).data) });

  const pedidos = useMemo(() => (pedidosQ.data ?? []).filter((p) => p.estado !== 'Anulado'), [pedidosQ.data]);
  const stock: StockItem[] = Array.isArray(stockQ.data) ? stockQ.data : [];
  const facturas = facturasQ.data ?? [];

  // Ventas del mes vs. el mismo tramo del mes anterior (1 al día de hoy).
  const ventas = useMemo(() => {
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const finMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    const tramoAnterior = {
      desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, Math.min(hoy.getDate(), finMesAnterior.getDate()))),
    };
    const delMes = pedidos.filter((p) => enRango(p.fecha, mes));
    const actual = delMes.reduce((s, p) => s + Number(p.total), 0);
    const anterior = pedidos.filter((p) => enRango(p.fecha, tramoAnterior)).reduce((s, p) => s + Number(p.total), 0);
    return { actual, cantidad: delMes.length, variacion: anterior > 0 ? ((actual - anterior) / anterior) * 100 : NaN };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos]);

  const porPesar = pedidos.filter((p) => p.estado === 'Reservado').sort((a, b) => a.id - b.id);
  const porCobrar = pedidos.filter((p) => p.estado === 'Preparado').sort((a, b) => a.id - b.id);
  const montoPorCobrar = [...porPesar, ...porCobrar].reduce((s, p) => s + Number(p.total), 0);

  const facturasPendientes = facturas.filter((f) => !f.pago_factura);
  const montoFacturasPendientes = facturasPendientes.reduce((s, f) => s + Number(f.total), 0);
  const facturaMasAntigua = facturasPendientes.reduce<number | null>((max, f) => {
    const d = diasDesde(f.fecha);
    return max == null || d > max ? d : max;
  }, null);

  const stockBajo = stock
    .filter((s) => s.estado === 'disponible' && s.disponibles < UMBRAL_STOCK_BAJO)
    .sort((a, b) => a.disponibles - b.disponibles);

  const saldos = useMemo(
    () => calcularSaldosVendedores(vendedoresQ.data ?? [], pedidos, pagosQ.data ?? []),
    [vendedoresQ.data, pedidos, pagosQ.data]
  );
  const saldoTotal = saldos.reduce((s, v) => s + v.saldo, 0);

  if (pedidosQ.isLoading || stockQ.isLoading) return <LoadingSpinner />;
  if (pedidosQ.error) return <ErrorMessage message="Error al cargar el resumen" />;

  const ganancia = gananciaQ.data?.total;

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Resumen</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Button onClick={() => navigate('/pedidos/nuevo')} className="hidden md:flex">
          <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Ventas del mes"
          value={formatCLP(ventas.actual)}
          icon={ShoppingCart}
          trend={{ value: ventas.variacion, label: 'vs. mismo período del mes anterior' }}
          description={`${ventas.cantidad} pedidos · con IVA`}
          onClick={() => navigate('/pedidos')}
        />
        <StatCard
          title="Ganancia neta del mes"
          value={ganancia ? formatCLP(ganancia.ganancia) : '—'}
          icon={TrendingUp}
          accent={ganancia && Number(ganancia.ganancia) < 0 ? 'text-destructive' : 'text-green-600'}
          description={ganancia ? `Margen ${Number(ganancia.margen_pct).toFixed(1)}% · sin IVA` : 'Calculando…'}
          onClick={() => navigate('/reportes')}
        />
        <StatCard
          title="Por cobrar a clientes"
          value={formatCLP(montoPorCobrar)}
          icon={HandCoins}
          accent="text-amber-600"
          description={`${porPesar.length} por pesar · ${porCobrar.length} por cobrar`}
          onClick={() => navigate('/pedidos')}
        />
        <StatCard
          title="Facturas por pagar"
          value={formatCLP(montoFacturasPendientes)}
          icon={FileText}
          accent={facturasPendientes.length ? 'text-destructive' : undefined}
          description={
            facturasPendientes.length
              ? `${facturasPendientes.length} pendientes · la más antigua hace ${facturaMasAntigua} días`
              : 'Todo al día'
          }
          onClick={() => navigate('/facturas?pago=pendientes')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* PEDIDOS POR ATENDER */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Pedidos por atender</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/pedidos')}>
              Ver todos <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ListaPedidos
              titulo="Por pesar"
              icono={Scale}
              pedidos={porPesar}
              color="bg-blue-100 text-blue-700"
              onVerTodos={() => navigate('/pedidos?estado=Reservado')}
            />
            <ListaPedidos
              titulo="Por cobrar"
              icono={HandCoins}
              pedidos={porCobrar}
              color="bg-amber-100 text-amber-700"
              onVerTodos={() => navigate('/pedidos?estado=Preparado')}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* STOCK BAJO */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className={`h-4 w-4 ${stockBajo.length ? 'text-destructive' : 'text-muted-foreground'}`} />
                Stock bajo
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/stock')}>
                Stock <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {stockBajo.length === 0 && <p className="text-sm text-muted-foreground">Ningún corte bajo {UMBRAL_STOCK_BAJO} unidades.</p>}
              {stockBajo.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="truncate mr-2">{s.producto}</span>
                  <Badge variant={s.disponibles === 0 ? 'destructive' : 'outline'} className="shrink-0">
                    {s.disponibles} un
                  </Badge>
                </div>
              ))}
              {stockBajo.length > 6 && <p className="text-xs text-muted-foreground">y {stockBajo.length - 6} más</p>}
            </CardContent>
          </Card>

          {/* SALDO VENDEDORES */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" /> Saldo de vendedores
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/gestion-pagos')}>
                Pagos <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {saldos.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm">
                  <span className="truncate mr-2">{v.nombre}</span>
                  <span className={`font-semibold tabular-nums ${v.saldo > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    {v.saldo >= 0 ? formatCLP(v.saldo) : `${formatCLP(-v.saldo)} a favor`}
                  </span>
                </div>
              ))}
              {saldos.length > 1 && (
                <div className="flex items-center justify-between border-t pt-1.5 text-sm font-bold">
                  <span>Total por rendir</span>
                  <span className="tabular-nums">{formatCLP(saldoTotal)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* BOTÓN FLOTANTE MÓVIL */}
      <div className="md:hidden fixed bottom-6 right-6 z-50">
        <Button
          size="lg"
          aria-label="Nuevo pedido"
          onClick={() => navigate('/pedidos/nuevo')}
          className="h-14 w-14 rounded-full shadow-2xl p-0"
        >
          <Plus className="h-8 w-8" />
        </Button>
      </div>
    </div>
  );
}

function ListaPedidos({
  titulo, icono: Icono, pedidos, color, onVerTodos,
}: {
  titulo: string;
  icono: React.ComponentType<{ className?: string }>;
  pedidos: Pedido[];
  color: string;
  onVerTodos: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-2">
      <button onClick={onVerTodos} className="flex w-full items-center justify-between text-sm font-semibold hover:text-primary">
        <span className="flex items-center gap-2">
          <Icono className="h-4 w-4 text-muted-foreground" /> {titulo}
        </span>
        <Badge className={`border-none ${color}`}>{pedidos.length}</Badge>
      </button>
      {pedidos.length === 0 && <p className="text-sm text-muted-foreground">Sin pedidos.</p>}
      {pedidos.slice(0, 6).map((p) => (
        <button
          key={p.id}
          onClick={() => navigate(`/pedidos?buscar=${p.id}`)}
          className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="font-mono text-xs text-primary shrink-0">#{p.id}</span>
              <span className="font-medium truncate">{p.cliente.nombre}</span>
            </span>
            <span className="block text-xs text-muted-foreground">{formatFecha(p.fecha)}</span>
          </span>
          <span className="font-semibold tabular-nums shrink-0 ml-2">{formatCLP(p.total)}</span>
        </button>
      ))}
      {pedidos.length > 6 && (
        <button onClick={onVerTodos} className="text-xs text-primary hover:underline">
          Ver los {pedidos.length} pedidos
        </button>
      )}
    </div>
  );
}
