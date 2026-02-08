import { Package, AlertCircle, Plus, Search, Scale, ShoppingCart } from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { StockItem } from '@/types';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: stockResponse, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: getStock,
  });

  // Normalización de datos para evitar errores de tipo
  const stockData = useMemo(() => {
    const rawData = stockResponse?.data || [];
    return Array.isArray(rawData) ? (rawData as StockItem[]) : [];
  }, [stockResponse]);

  // Filtrado de stock crítico (menos de 10 unidades)
  const stockCritico = useMemo(() => 
    stockData.filter(item => item.disponibles < 10), 
    [stockData]
  );

  // Filtrado por búsqueda para la sección principal
  const filteredStock = useMemo(() => 
    stockData.filter(item => 
      item.estado === 'disponible' && // <--- FILTRO DE ESTADO AGREGADO
      item.producto.toLowerCase().includes(searchTerm.toLowerCase())
    ), 
    [stockData, searchTerm]
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar el stock" />;

  return (
    <div className="space-y-6">
      {/* Cabecera Simple con Acción Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Disponibilidad de Productos</h1>
          <p className="text-muted-foreground">Consulta rápida de existencias y precios</p>
        </div>
        <Button 
          size="lg" 
          onClick={() => navigate('/pedidos/nuevo')} 
          className="h-14 px-8 text-lg font-bold shadow-xl transition-all hover:scale-105"
        >
          <Plus className="mr-2 h-6 w-6" /> Nuevo Pedido
        </Button>
      </div>

      {/* SECCIÓN 1: STOCK CRÍTICO (Solo aparece si hay productos en riesgo) */}
      {stockCritico.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 fill-destructive text-white" />
            <h2 className="text-lg font-bold uppercase tracking-wider">Stock Crítico (Reponer pronto)</h2>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {stockCritico.map(item => (
              <Card key={`critico-${item.producto}`} className="border-destructive/50 bg-destructive/5">
                <CardContent className="p-4 flex justify-between items-center">
                  <div>
                    <p className="font-bold text-destructive">{item.producto}</p>
                    <p className="text-2xl font-black">{item.disponibles} <span className="text-xs">UNS</span></p>
                  </div>
                  <Badge variant="destructive" className="animate-pulse">Bajo Stock</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* SECCIÓN 2: DISPONIBILIDAD TOTAL (Lo Principal) */}
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="px-0 flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-xl">Catálogo de Inventario</CardTitle>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Buscar producto..." 
              className="pl-10 h-11 bg-white shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredStock.map((item) => (
              <Card key={item.producto} className="overflow-hidden hover:border-primary transition-all shadow-sm">
                <div className="bg-primary/5 p-3 border-b border-primary/10 flex justify-between items-center">
                   <span className="font-bold text-primary truncate">{item.producto}</span>
                   <p className="text-lg font-black text-primary">
                    ${Number(item.precio_por_kilo).toLocaleString('es-CL')}
                  </p>
                </div>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center text-muted-foreground gap-1 text-xs">
                        <ShoppingCart className="h-3 w-3" /> Unidades
                      </div>
                      <p className="text-xl font-bold">{item.disponibles}</p>
                    </div>
                    <div className="space-y-1 border-l pl-4">
                      <div className="flex items-center text-muted-foreground gap-1 text-xs">
                        <Scale className="h-3 w-3" /> Kilos
                      </div>
                      <p className="text-xl font-bold text-blue-600">
                        {item.kilos_actuales.toFixed(1)} <span className="text-xs text-muted-foreground">kg</span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}