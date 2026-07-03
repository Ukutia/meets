import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  DollarSign,
  Percent,
  AlertTriangle,
  ShoppingCart,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  getReporteGanancias,
  getReportePerdidas,
  getFluctuacionPrecios,
} from '@/services/api';

const clp = (n: number | string | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;

const pct = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;

// --- Tipos de respuesta del backend ---
interface GananciaTotal {
  ganancia: number;
  ventas: number;
  costo: number;
  kilos: number;
  margen_pct: number;
}
interface FilaProducto {
  producto_id: number;
  nombre: string;
  ganancia: number;
  ventas: number;
  costo: number;
  kilos: number;
  margen_pct: number;
}
interface FilaMes {
  mes: string;
  ganancia: number;
  ventas: number;
  costo: number;
}
interface FilaVendedor {
  vendedor_id: number | null;
  nombre: string;
  ganancia: number;
  ventas: number;
  margen_pct: number;
}
interface ReporteGanancias {
  total: GananciaTotal;
  por_producto: FilaProducto[];
  por_mes: FilaMes[];
  por_vendedor: FilaVendedor[];
}
interface ReportePerdidas {
  total: { valor: number; kilos: number };
  por_producto: { producto_id: number; nombre: string; kilos: number; valor: number }[];
  por_mes: { mes: string; kilos: number; valor: number }[];
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'text-primary',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${accent}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-black ${accent}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function Reportes() {
  const {
    data: ganancias,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['reporte-ganancias'],
    queryFn: async () => (await getReporteGanancias()).data as ReporteGanancias,
  });

  const { data: perdidas } = useQuery({
    queryKey: ['reporte-perdidas'],
    queryFn: async () => (await getReportePerdidas()).data as ReportePerdidas,
  });

  const [productoFluct, setProductoFluct] = useState<string>('');

  const { data: fluctuacion } = useQuery({
    queryKey: ['fluctuacion-precios', productoFluct],
    queryFn: async () =>
      (await getFluctuacionPrecios(productoFluct || undefined)).data as {
        productos: { id: number; nombre: string }[];
        producto_id: number | null;
        compras: { fecha: string; costo: number }[];
        ventas: { fecha: string; precio: number }[];
      },
  });

  // Serie combinada compra/venta por mes para el gráfico de fluctuación
  const serieFluct = useMemo(() => {
    if (!fluctuacion) return [];
    const map = new Map<string, { fecha: string; costo?: number; precio?: number }>();
    for (const c of fluctuacion.compras) {
      map.set(c.fecha, { ...(map.get(c.fecha) || { fecha: c.fecha }), costo: Number(c.costo) });
    }
    for (const v of fluctuacion.ventas) {
      map.set(v.fecha, { ...(map.get(v.fecha) || { fecha: v.fecha }), precio: Number(v.precio) });
    }
    return Array.from(map.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [fluctuacion]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar los reportes" />;

  const total = ganancias?.total;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reportes y Ganancias</h1>
        <p className="text-muted-foreground">
          Rentabilidad por corte, vendedor y mes. No incluye pedidos anulados.
        </p>
      </div>

      {/* TARJETAS DE RESUMEN */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ganancia Total"
          value={clp(total?.ganancia)}
          sub="Margen bruto histórico"
          icon={TrendingUp}
          accent={Number(total?.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'}
        />
        <KpiCard label="Ventas Totales" value={clp(total?.ventas)} sub="Ingresos por ventas" icon={DollarSign} />
        <KpiCard
          label="Margen Promedio"
          value={pct(total?.margen_pct)}
          sub="Ganancia / Ventas"
          icon={Percent}
          accent="text-blue-600"
        />
        <KpiCard
          label="Pérdidas (Mermas)"
          value={clp(perdidas?.total.valor)}
          sub={`${Number(perdidas?.total.kilos ?? 0).toLocaleString('es-CL')} kg mermados`}
          icon={AlertTriangle}
          accent="text-destructive"
        />
      </div>

      {/* VISTAS DETALLADAS */}
      <Tabs defaultValue="mensual" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="mensual">Mensual</TabsTrigger>
          <TabsTrigger value="producto">Por Corte</TabsTrigger>
          <TabsTrigger value="vendedor">Por Vendedor</TabsTrigger>
          <TabsTrigger value="perdidas">Pérdidas</TabsTrigger>
          <TabsTrigger value="fluctuacion">Fluctuación de Precios</TabsTrigger>
        </TabsList>

        {/* --- MENSUAL --- */}
        <TabsContent value="mensual">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Mes</CardTitle>
            </CardHeader>
            <CardContent>
              {ganancias && ganancias.por_mes.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={ganancias.por_mes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="mes" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => clp(v)} width={80} />
                    <ReTooltip formatter={(v: number) => clp(v)} />
                    <Legend />
                    <Bar dataKey="ventas" name="Ventas" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ganancia" name="Ganancia" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-10">Sin datos.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- POR PRODUCTO / CORTE --- */}
        <TabsContent value="producto">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Corte (Producto)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corte</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ganancias?.por_producto ?? []).map((r) => (
                    <TableRow key={r.producto_id}>
                      <TableCell className="font-medium">{r.nombre}</TableCell>
                      <TableCell className="text-right">{clp(r.ventas)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{clp(r.costo)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          Number(r.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'
                        }`}
                      >
                        {clp(r.ganancia)}
                      </TableCell>
                      <TableCell className="text-right">{pct(r.margen_pct)}</TableCell>
                    </TableRow>
                  ))}
                  {(ganancias?.por_producto ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Sin datos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- POR VENDEDOR --- */}
        <TabsContent value="vendedor">
          <Card>
            <CardHeader>
              <CardTitle>Ganancia por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Ventas</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ganancias?.por_vendedor ?? []).map((r) => (
                    <TableRow key={`${r.vendedor_id}-${r.nombre}`}>
                      <TableCell className="font-medium flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" /> {r.nombre}
                      </TableCell>
                      <TableCell className="text-right">{clp(r.ventas)}</TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          Number(r.ganancia) >= 0 ? 'text-green-600' : 'text-destructive'
                        }`}
                      >
                        {clp(r.ganancia)}
                      </TableCell>
                      <TableCell className="text-right">{pct(r.margen_pct)}</TableCell>
                    </TableRow>
                  ))}
                  {(ganancias?.por_vendedor ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Sin datos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- PÉRDIDAS --- */}
        <TabsContent value="perdidas">
          <Card>
            <CardHeader>
              <CardTitle>Pérdidas por Merma</CardTitle>
              <p className="text-xs text-muted-foreground">
                Valorizadas con el último costo de compra conocido de cada producto.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Kilos mermados</TableHead>
                    <TableHead className="text-right">Valor perdido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(perdidas?.por_producto ?? []).map((r) => (
                    <TableRow key={r.producto_id}>
                      <TableCell className="font-medium">{r.nombre}</TableCell>
                      <TableCell className="text-right">
                        {Number(r.kilos).toLocaleString('es-CL')} kg
                      </TableCell>
                      <TableCell className="text-right font-bold text-destructive">{clp(r.valor)}</TableCell>
                    </TableRow>
                  ))}
                  {(perdidas?.por_producto ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        Sin mermas registradas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- FLUCTUACIÓN DE PRECIOS --- */}
        <TabsContent value="fluctuacion">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Fluctuación de Precios</CardTitle>
              <Select value={productoFluct} onValueChange={setProductoFluct}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Seleccione producto" />
                </SelectTrigger>
                <SelectContent>
                  {(fluctuacion?.productos ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {!productoFluct ? (
                <p className="text-center text-muted-foreground py-10">
                  Seleccione un producto para ver la evolución de su costo de compra y precio de venta.
                </p>
              ) : serieFluct.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={serieFluct}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="fecha" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => clp(v)} width={80} />
                    <ReTooltip formatter={(v: number) => clp(v)} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="costo"
                      name="Costo de compra"
                      stroke="hsl(var(--destructive))"
                      strokeWidth={2}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="precio"
                      name="Precio de venta"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-10">Sin datos para este producto.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
