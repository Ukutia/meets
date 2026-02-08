import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUpCircle, ArrowDownCircle, Filter } from 'lucide-react';
import { getDetalleFacturas, getDetallePedidos,getProductos } from '@/services/api'; // Asegúrate de tener estos servicios
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function MovimientosInventario() {
  const [activeTab, setActiveTab] = useState<'entradas' | 'salidas'>('entradas');
  const [filter, setFilter] = useState({
    search: '',
    cliente: '',
    producto: 'todos',
    minKilos: '',
    minUnidades: '',
    numDocumento: ''
  });

  // 1. Carga de datos simultánea (o podrías condicionar según la tab)
  const { data: entradas, isLoading: loadingE } = useQuery({
    queryKey: ['detalle-facturas'],
    queryFn: async () => (await getDetalleFacturas()).data
  });

  const { data: salidas, isLoading: loadingS } = useQuery({
    queryKey: ['detalle-pedidos'],
    queryFn: async () => (await getDetallePedidos()).data
  });

  // 2. Carga de Productos para el desplegable
  const { data: productosResponse } = useQuery({
    queryKey: ['productos-lista'],
    queryFn: getProductos
  });

  const listaProductos = useMemo(() => {
    return productosResponse?.data || [];
  }, [productosResponse]);

  // 2. Lógica de filtrado unificada
// 2. Lógica de filtrado unificada con protección contra nulos
  const filteredData = useMemo(() => {
    const data = activeTab === 'entradas' ? (entradas || []) : (salidas || []);
    
    return data.filter((item: any) => {
      console.log('Filtrando item:', item);
      // Normalización de valores para evitar errores si el campo no existe
      const clienteProv = (item.cliente_nombre || item.proveedor_nombre || '').toString().toLowerCase();
      const producto = (item.producto_nombre || item.producto.nombre||'').toString().toLowerCase();
      const numDoc = (item.pedido || item.factura || '').toString().toLowerCase();
      
      // Filtros
      const matchCliente = clienteProv.includes(filter.cliente.toLowerCase());
      const matchProducto = filter.producto === 'todos' || 
                            producto === filter.producto.toLowerCase();
      const matchNum = numDoc.includes(filter.numDocumento.toLowerCase());

      const kilos = Number(item.cantidad_kilos || 0);
      const unidades = Number(item.cantidad_unidades || 0);

      const matchKilos = filter.minKilos === '' || kilos >= Number(filter.minKilos);
      const matchUnidades = filter.minUnidades === '' || unidades >= Number(filter.minUnidades);

      return matchCliente && matchProducto && matchNum && matchKilos && matchUnidades;
    });
  }, [activeTab, entradas, salidas, filter]);
  if (loadingE || loadingS) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Movimientos de Inventario</h1>
        <p className="text-muted-foreground">Historial detallado de ingresos (facturas) y egresos (pedidos).</p>
      </div>

      {/* Panel de Filtros */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Pedido / Factura #</Label>
            <Input 
              placeholder="Ej: 1024" 
              value={filter.numDocumento}
              onChange={(e) => setFilter({...filter, numDocumento: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Cliente / Proveedor</Label>
            <Input 
              placeholder="Buscar cliente..." 
              value={filter.cliente}
              onChange={(e) => setFilter({...filter, cliente: e.target.value})}
            />
          </div>
          {/* FILTRO DE PRODUCTO DESPLEGABLE */}
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Producto</Label>
            <Select 
              value={filter.producto} 
              onValueChange={(v) => setFilter({...filter, producto: v})}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Seleccionar producto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los productos</SelectItem>
                {listaProductos.map((p: any) => (
                  <SelectItem key={p.id} value={p.nombre}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Min. Kilos</Label>
            <Input 
              type="number"
              placeholder="0.00" 
              value={filter.minKilos}
              onChange={(e) => setFilter({...filter, minKilos: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Min. Unidades</Label>
            <Input 
              type="number"
              placeholder="0" 
              value={filter.minUnidades}
              onChange={(e) => setFilter({...filter, minUnidades: e.target.value})}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="entradas" className="gap-2">
              <ArrowUpCircle className="h-4 w-4 text-green-600" /> Entradas (Facturas)
            </TabsTrigger>
            <TabsTrigger value="salidas" className="gap-2">
              <ArrowDownCircle className="h-4 w-4 text-blue-600" /> Salidas (Pedidos)
            </TabsTrigger>
          </TabsList>
          
          <div className="text-sm text-muted-foreground">
            Mostrando <b>{filteredData.length}</b> registros
          </div>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>Cliente / Proveedor</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">Kilos</TableHead>
                <TableHead className="text-right">Precio/Kg</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((item: any, index: number) => (
                <TableRow key={`${activeTab}-${index}`}>
                  <TableCell className="font-mono font-medium">
                    #{item.pedido || item.factura}
                  </TableCell>
                  {console.log(item)}
                  <TableCell>{item.cliente_nombre || item.proveedor_nombre || 'N/A'}</TableCell>
                  <TableCell className="font-semibold">{item.producto_nombre || item.producto.nombre}</TableCell>
                  <TableCell className="text-right">{Number(item.cantidad_unidades).toFixed(0)}</TableCell>
                  <TableCell className="text-right font-medium text-blue-600">
                    {Number(item.cantidad_kilos).toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-right">
                    ${Number(activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta).toLocaleString('es-CL')}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    ${(item.cantidad_kilos * (activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta)).toLocaleString('es-CL')}
                  </TableCell>
                </TableRow>
              ))}
              {filteredData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    No se encontraron movimientos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </Tabs>
    </div>
  );
}

// Pequeño componente interno para Labels si no los tienes importados de UI
function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <label className={`text-sm font-medium leading-none ${className}`}>{children}</label>;
}