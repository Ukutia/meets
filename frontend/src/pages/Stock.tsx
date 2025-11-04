import { useMemo, useState } from 'react';
import { Search, AlertTriangle } from 'lucide-react';
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
import { useQuery } from '@tanstack/react-query';
import { getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { StockItem } from '@/types';

export default function Stock() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => {
      const response = await getStock();
      return response.data as StockItem[];
    },
  });

  const stock = data ?? [];

  const filteredStock = useMemo(() => {
    return stock.filter((item) =>
      item.producto.toLowerCase().includes(search.toLowerCase())
    );
  }, [stock, search]);

  const totalValor = filteredStock.reduce(
    (sum, item) => sum + item.precio_por_kilo * item.kilos_actuales,
    0
  );
  const itemsCriticos = filteredStock.filter((item) => item.disponibles < 10).length;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="No se pudo cargar el stock" />;
  }

  const getStockBadge = (disponibles: number) => {
    if (disponibles < 10) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Bajo
        </Badge>
      );
    }
    if (disponibles < 30) {
      return <Badge variant="secondary">Medio</Badge>;
    }
    return <Badge variant="outline">Normal</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stock</h1>
        <p className="text-muted-foreground">
          Control consolidado de inventario disponible
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Valor Total (estimado)</p>
          <p className="text-2xl font-bold">${totalValor.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Productos en Stock</p>
          <p className="text-2xl font-bold">{filteredStock.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Stock Crítico</p>
          <p className="text-2xl font-bold text-destructive">{itemsCriticos}</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar productos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Disponibles (unidades)</TableHead>
              <TableHead>Reservas</TableHead>
              <TableHead>Kilos actuales</TableHead>
              <TableHead>Precio/Kg</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.map((item, index) => (
              <TableRow key={`${item.producto}-${index}`}>
                <TableCell className="font-medium">{item.producto}</TableCell>
                <TableCell>{item.disponibles}</TableCell>
                <TableCell>{item.reservas}</TableCell>
                <TableCell>{item.kilos_actuales.toFixed(2)} kg</TableCell>
                <TableCell>${item.precio_por_kilo.toFixed(2)}</TableCell>
                <TableCell>{getStockBadge(item.disponibles)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
