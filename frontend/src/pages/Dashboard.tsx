import { Package, AlertCircle, Plus, Search, Scale, ShoppingCart, ChevronDown } from 'lucide-react';
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
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data: stockResponse, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: getStock,
  });

  const stockData = useMemo(() => {
    const rawData = stockResponse?.data || [];
    return Array.isArray(rawData) ? (rawData as StockItem[]) : [];
  }, [stockResponse]);

  const stockCritico = useMemo(() => 
    stockData.filter(item => item.disponibles < 10), 
    [stockData]
  );

const filteredStock = useMemo(() => {
    return stockData
      .filter(item => 
        item.estado === 'disponible' && 
        item.producto.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => b.disponibles - a.disponibles); // <--- LÓGICA DE ORDENAMIENTO AGREGADA
  }, [stockData, searchTerm]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar el stock" />;

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] space-y-4 pb-20 md:pb-0">
      
      {/* 1. CABECERA COMPACTA */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">Existencias y precios actuales</p>
        </div>
        <Button 
          onClick={() => navigate('/pedidos/nuevo')} 
          className="hidden md:flex shadow-lg"
        >
          <Plus className="mr-2 h-4 w-4" /> Nuevo Pedido
        </Button>
      </div>

      {/* 2. ALERTAS DE STOCK (Acordeón Desplegable) */}
      {stockCritico.length > 0 && (
        <Accordion type="single" collapsible className="w-full bg-destructive/5 border border-destructive/20 rounded-lg px-4">
          <AccordionItem value="alerts" className="border-none">
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 fill-destructive text-white" />
                <span className="font-bold text-sm uppercase">Alertas de Stock ({stockCritico.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 pb-3">
                {stockCritico.map(item => (
                  <div key={`crit-${item.producto}`} className="flex justify-between items-center bg-white p-2 rounded border border-destructive/30 text-xs">
                    <span className="font-medium truncate mr-2">{item.producto}</span>
                    <Badge variant="destructive" className="h-5 text-[10px]">{item.disponibles} UN</Badge>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* 3. BUSCADOR FIJO */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input 
          placeholder="Buscar producto..." 
          className="pl-10 h-10 shadow-sm bg-white"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* 4. TABLA DE PRODUCTOS CON SCROLL INTERNO */}
      <Card className="flex-1 min-h-0 overflow-hidden border-none shadow-sm md:border md:shadow-none">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-[45%] text-xs uppercase font-bold">Producto</TableHead>
                <TableHead className="text-center text-xs uppercase font-bold">Stock</TableHead>
                <TableHead className="text-right text-xs uppercase font-bold">Precio/Kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStock.map((item) => (
                <TableRow key={item.producto} className="hover:bg-primary/5 transition-colors">
                  <TableCell className="py-3">
                    <div className="font-bold text-sm">{item.producto}</div>
                    <div className="text-[10px] text-blue-600 font-medium">
                      {item.kilos_actuales.toFixed(1)} Kg disponibles
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-sm font-black">{item.disponibles}</span>
                      <span className="text-[9px] text-muted-foreground uppercase">unidades</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold text-sm">
                    ${Number(item.precio_por_kilo).toLocaleString('es-CL')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>

      {/* 5. BOTÓN FLOTANTE MÓVIL (Fijado abajo) */}
      <div className="md:hidden fixed bottom-24 right-6 z-50">
        <Button 
          size="lg" 
          onClick={() => navigate('/pedidos/nuevo')} 
          className="h-14 w-14 rounded-full shadow-2xl bg-primary flex items-center justify-center p-0"
        >
          <Plus className="h-8 w-8 text-white" />
        </Button>
      </div>

    </div>
  );
}