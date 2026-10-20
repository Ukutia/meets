import { useMemo, useState } from 'react';
import { Search, AlertTriangle, Package, Scale, TrendingUp, Coins } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { getStock, getMargenProductos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { StatCard } from '@/components/shared/StatCard';
import type { MargenProducto, StockItem } from '@/types';
import { formatCLP } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Mismo umbral que las alertas del Resumen.
const UMBRAL_STOCK_BAJO = 10;

type Filtro = 'todos' | 'bajo' | 'reservado';

export default function Stock() {
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => (await getStock()).data,
    refetchOnMount: true,
  });
  // costo_reciente viene CON IVA, igual que precio_por_kilo: se pueden comparar directo.
  const { data: margenes } = useQuery({
    queryKey: ['margen-productos'],
    queryFn: async () => (await getMargenProductos()).data as MargenProducto[],
  });
  const costoPorId = useMemo(() => {
    const m = new Map<number, number>();
    (margenes ?? []).forEach((r) => r.costo_reciente != null && m.set(r.producto_id, Number(r.costo_reciente)));
    return m;
  }, [margenes]);

  const stock: StockItem[] = Array.isArray(data) ? data : [];

  const filteredStock = useMemo(() => {
    const q = search.toLowerCase();
    return stock
      .filter((item) => item.producto.toLowerCase().includes(q))
      .filter((item) =>
        filtro === 'bajo' ? item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO
        : filtro === 'reservado' ? item.reservas > 0
        : true
      )
      .sort((a, b) => b.stock - a.stock);
  }, [stock, search, filtro]);

  const totales = useMemo(() => {
    let venta = 0;
    let costo = 0;
    let kilos = 0;
    let sinCosto = 0;
    filteredStock.forEach((item) => {
      const kg = Number(item.kilos_actuales);
      kilos += kg;
      venta += kg * Number(item.precio_por_kilo);
      const c = costoPorId.get(item.id);
      if (c != null) costo += kg * c;
      else if (kg > 0) sinCosto += 1;
    });
    return { venta, costo, kilos, sinCosto };
  }, [filteredStock, costoPorId]);

  const itemsBajos = stock.filter((item) => item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO).length;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudo cargar el inventario" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Stock</h1>
        <p className="text-muted-foreground">Unidades disponibles, reservadas por pedidos y kilos en bodega.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Valor a costo"
          value={formatCLP(totales.costo)}
          icon={Coins}
          description={totales.sinCosto ? `${totales.sinCosto} cortes sin costo de compra` : 'Último costo de compra, con IVA'}
        />
        <StatCard
          title="Valor a precio de venta"
          value={formatCLP(totales.venta)}
          icon={TrendingUp}
          accent="text-green-600"
          description={totales.costo > 0 ? `Ganancia potencial ${formatCLP(totales.venta - totales.costo)} (con IVA)` : 'Precio vigente, con IVA'}
        />
        <StatCard
          title="Kilos en bodega"
          value={`${totales.kilos.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`}
          icon={Scale}
          accent="text-blue-600"
        />
        <StatCard
          title="Stock bajo"
          value={itemsBajos}
          icon={AlertTriangle}
          accent={itemsBajos > 0 ? 'text-destructive' : undefined}
          description={`Cortes con menos de ${UMBRAL_STOCK_BAJO} unidades`}
          onClick={() => setFiltro(filtro === 'bajo' ? 'todos' : 'bajo')}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar por nombre de producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
          <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los cortes</SelectItem>
            <SelectItem value="bajo">Solo stock bajo</SelectItem>
            <SelectItem value="reservado">Con reservas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Producto</TableHead>
              <TableHead className="text-center">Disponibles</TableHead>
              <TableHead className="text-center">Reservas</TableHead>
              <TableHead className="text-center hidden md:table-cell">Stock físico</TableHead>
              <TableHead className="text-right">Kilos</TableHead>
              <TableHead className="text-right hidden md:table-cell">Peso prom.</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Costo/kg</TableHead>
              <TableHead className="text-right">Precio/kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No hay cortes con estos filtros.</TableCell>
              </TableRow>
            )}
            {filteredStock.map((item) => {
              // Peso promedio sobre el stock físico: son las unidades que generan esos kilos.
              const pesoPromedio = item.stock > 0 ? Number(item.kilos_actuales) / item.stock : 0;
              const bajo = item.estado === 'disponible' && item.disponibles < UMBRAL_STOCK_BAJO;
              const costo = costoPorId.get(item.id);
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{item.producto}</span>
                      {item.estado === 'agotado' && <Badge variant="outline" className="text-[10px] text-muted-foreground">Agotado</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className={`text-center font-bold tabular-nums ${bajo ? 'text-destructive' : 'text-green-600'}`}>
                    {item.disponibles}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={item.reservas > 0 ? 'text-orange-600 border-orange-200 bg-orange-50' : 'text-muted-foreground'}>
                      {item.reservas}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center font-medium hidden md:table-cell tabular-nums">{item.stock}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                    {Number(item.kilos_actuales).toFixed(2)} <span className="text-[10px] text-muted-foreground">kg</span>
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help tabular-nums">
                          {pesoPromedio.toFixed(3)}
                          <span className="text-[10px] ml-1 text-muted-foreground">kg/u</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Promedio basado en stock físico ({item.stock} un.)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                    {costo != null ? formatCLP(costo) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(item.precio_por_kilo)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
