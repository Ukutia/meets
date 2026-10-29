import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { getStock } from '@/services/api';
import { formatCLP, formatKg } from '@/lib/utils';
import type { StockItem } from '@/types';

// Vista rápida para consultar qué hay y a cuánto: solo productos disponibles,
// con stock, ordenados de mayor a menor existencia.
export default function Precios() {
  const [busqueda, setBusqueda] = useState('');

  const { data, isLoading, error } = useQuery({
    // Clave propia: otras pantallas guardan bajo ['stock'] la respuesta completa de axios.
    queryKey: ['stock', 'precios'],
    queryFn: async () => {
      const response = await getStock();
      return Array.isArray(response.data) ? (response.data as StockItem[]) : [];
    },
  });

  const productos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data ?? [])
      .filter((p) => p.estado === 'disponible' && Number(p.disponibles) > 0 && p.producto.toLowerCase().includes(q))
      .sort((a, b) => b.disponibles - a.disponibles || a.producto.localeCompare(b.producto));
  }, [data, busqueda]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los productos" />;

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Precios</h1>
        <p className="text-sm text-muted-foreground">Productos disponibles y su precio actual.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          aria-label="Buscar producto"
          className="h-10 bg-background pl-10"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[50%] text-xs uppercase">Producto</TableHead>
              <TableHead className="text-center text-xs uppercase">Stock</TableHead>
              <TableHead className="text-right text-xs uppercase">Precio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productos.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {busqueda ? 'Ningún producto coincide con la búsqueda.' : 'No hay productos disponibles.'}
                </TableCell>
              </TableRow>
            )}
            {productos.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <div className="text-sm font-semibold">{p.producto}</div>
                  <div className="text-xs text-muted-foreground">{formatKg(p.kilos_actuales, 1)} disponibles</div>
                </TableCell>
                <TableCell className="text-center">
                  <span className="text-sm font-bold tabular-nums">{p.disponibles}</span>
                  <span className="block text-[10px] uppercase text-muted-foreground">unid.</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm font-bold tabular-nums">{formatCLP(p.precio_por_kilo)}</span>
                  <span className="block text-[10px] uppercase text-muted-foreground">{p.venta_por_unidad ? 'c/u' : 'por kilo'}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
