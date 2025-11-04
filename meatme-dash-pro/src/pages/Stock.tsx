import { useState } from 'react';
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

interface StockItem {
  producto_nombre: string;
  categoria: string;
  stock_actual: number;
  precio_por_kilo: number;
  valor_total: number;
}

export default function Stock() {
  const [search, setSearch] = useState('');

  // Mock data
  const stock: StockItem[] = [
    {
      producto_nombre: 'Bife de Chorizo',
      categoria: 'Cortes Premium',
      stock_actual: 45,
      precio_por_kilo: 8.5,
      valor_total: 382.5,
    },
    {
      producto_nombre: 'Asado',
      categoria: 'Cortes Tradicionales',
      stock_actual: 32,
      precio_por_kilo: 6.2,
      valor_total: 198.4,
    },
    {
      producto_nombre: 'Vacío',
      categoria: 'Cortes Tradicionales',
      stock_actual: 8,
      precio_por_kilo: 7.8,
      valor_total: 62.4,
    },
    {
      producto_nombre: 'Matambre',
      categoria: 'Cortes Especiales',
      stock_actual: 15,
      precio_por_kilo: 5.9,
      valor_total: 88.5,
    },
  ];

  const filteredStock = stock.filter((item) =>
    item.producto_nombre.toLowerCase().includes(search.toLowerCase())
  );

  const totalValor = filteredStock.reduce((sum, item) => sum + item.valor_total, 0);
  const itemsCriticos = filteredStock.filter((item) => item.stock_actual < 10).length;

  const getStockBadge = (stock: number) => {
    if (stock < 10) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Bajo
        </Badge>
      );
    }
    if (stock < 30) {
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
          <p className="text-sm font-medium text-muted-foreground">Valor Total</p>
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
              <TableHead>Categoría</TableHead>
              <TableHead>Stock Actual (kg)</TableHead>
              <TableHead>Precio/Kg</TableHead>
              <TableHead>Valor Total</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{item.producto_nombre}</TableCell>
                <TableCell>{item.categoria}</TableCell>
                <TableCell>{item.stock_actual} kg</TableCell>
                <TableCell>${item.precio_por_kilo.toFixed(2)}</TableCell>
                <TableCell className="font-semibold">${item.valor_total.toFixed(2)}</TableCell>
                <TableCell>{getStockBadge(item.stock_actual)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
