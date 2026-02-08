import { useMemo, useState } from 'react';
import { Search, AlertTriangle, Package, Scale, TrendingUp, Info } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Stock() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => {
      const response = await getStock();
      const rawData = response.data?.data || response.data || [];
      return Array.isArray(rawData) ? rawData : [];
    },
    refetchOnMount: true 
  });

  const filteredStock = useMemo(() => {
    const stock = Array.isArray(data) ? data : [];
    return stock.filter((item) =>
      item.producto.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  // Cálculos globales
  const totalValor = filteredStock.reduce(
    (sum, item) => sum + (Number(item.precio_por_kilo) * Number(item.kilos_actuales)),
    0
  );
  const totalKilos = filteredStock.reduce((sum, item) => sum + Number(item.kilos_actuales), 0);
  const itemsCriticos = filteredStock.filter((item) => item.disponibles < 10).length;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudo cargar el inventario" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventario de Productos</h1>
        <p className="text-muted-foreground">
          Gestión de stock físico, reservas de pedidos y pesos promedio.
        </p>
      </div>

      {/* Tarjetas de Resumen */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valor del Inventario</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalValor.toLocaleString('es-CL')}</p>
            <p className="text-xs text-muted-foreground">Valorización por Kilos actuales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Kilos en Bodega</CardTitle>
            <Scale className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalKilos.toFixed(2)} Kg</p>
          </CardContent>
        </Card>

        <Card className={itemsCriticos > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alertas de Stock</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${itemsCriticos > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${itemsCriticos > 0 ? "text-destructive" : ""}`}>{itemsCriticos}</p>
            <p className="text-xs text-muted-foreground">Productos con baja disponibilidad</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filtrar por nombre de producto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-bold">Producto</TableHead>
              <TableHead className="text-center font-bold">Disponibles</TableHead>
              <TableHead className="text-center font-bold">Reservas</TableHead>
              <TableHead className="text-center font-bold">Stock Físico</TableHead>
              <TableHead className="text-right font-bold">Kilos</TableHead>
              <TableHead className="text-right font-bold">Peso Prom.</TableHead>
              <TableHead className="text-right font-bold">Precio/Kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.map((item, index) => {
              // Cálculo de Peso Promedio: Kilos actuales / (Unidades de Stock Físico)
              // Usamos item.stock porque representa las unidades reales que generan esos kilos
              const pesoPromedio = item.stock > 0 
                ? (Number(item.kilos_actuales) / item.stock) 
                : 0;

              return (
                <TableRow key={`${item.id}-${index}`} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {item.producto}
                    </div>
                  </TableCell>
                  
                  <TableCell className="text-center font-bold text-green-600">
                    {item.disponibles}
                  </TableCell>
                  
                  <TableCell className="text-center">
                    <Badge variant="outline" className={item.reservas > 0 ? "text-orange-600 border-orange-200 bg-orange-50" : "text-muted-foreground"}>
                      {item.reservas}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-center font-medium bg-muted/20">
                    {item.stock}
                  </TableCell>

                  <TableCell className="text-right font-medium">
                    {Number(item.kilos_actuales).toFixed(2)} <span className="text-[10px] text-muted-foreground">kg</span>
                  </TableCell>

                  <TableCell className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">
                           <span className="text-blue-600 font-semibold">
                            {pesoPromedio.toFixed(3)}
                          </span>
                          <span className="text-[10px] ml-1 text-muted-foreground">kg/u</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Promedio basado en Stock Físico ({item.stock} un.)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>

                  <TableCell className="text-right font-mono text-sm">
                    ${Number(item.precio_por_kilo).toLocaleString('es-CL')}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}