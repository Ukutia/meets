import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Search, ArrowUpCircle, ArrowDownCircle, PackageMinus, Plus, Filter, FileSpreadsheet, FileText } from 'lucide-react';
import { getDetalleFacturas, getDetallePedidos, getProductos, getAjustesInventario, createAjusteInventario } from '@/services/api'; // Asegúrate de tener estos servicios
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import type { AjusteInventario } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AjusteForm {
  producto: string;
  tipo: 'merma' | 'exceso' | 'ajuste';
  cantidad: string;
  razon: string;
}

// Los costos de compra se ingresan sin IVA (ver nota en backend/core/views.py,
// seccion Reportes Financieros); para que la ganancia mostrada aca sea
// consistente con Pedidos.tsx y Reportes.tsx hay que descontar el costo CON IVA.
const FACTOR_IVA = 1.19;

// Redondea a pesos enteros antes de formatear: con decimales sin redondear,
// la coma decimal de es-CL se confunde visualmente con un separador de miles
// (ej. "$12.319,475" se lee como si fuera doce millones).
const formatMonto = (val: number) => Math.round(val).toLocaleString('es-CL');

export default function MovimientosInventario() {
  const [activeTab, setActiveTab] = useState<'entradas' | 'salidas' | 'ajustes'>('entradas');
  const [filter, setFilter] = useState({
    search: '',
    cliente: '',
    producto: 'todos',
    minKilos: '',
    minUnidades: '',
    numDocumento: ''
  });
  const [selectedFacturas, setSelectedFacturas] = useState<any | null>(null);
  const [ajusteDialogOpen, setAjusteDialogOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 1. Carga de datos simultánea (o podrías condicionar según la tab)
  const { data: entradas, isLoading: loadingE } = useQuery({
    queryKey: ['detalle-facturas'],
    queryFn: async () => (await getDetalleFacturas()).data
  });

  const { data: salidas, isLoading: loadingS } = useQuery({
    queryKey: ['detalle-pedidos'],
    queryFn: async () => (await getDetallePedidos()).data
  });

  const { data: ajustes, isLoading: loadingA } = useQuery({
    queryKey: ['ajustes-inventario'],
    queryFn: async () => (await getAjustesInventario()).data
  });

  // 2. Carga de Productos para el desplegable
  const { data: productosResponse } = useQuery({
    queryKey: ['productos-lista'],
    queryFn: getProductos
  });

  const listaProductos = useMemo(() => {
    return productosResponse?.data || [];
  }, [productosResponse]);

  const ajusteForm = useForm<AjusteForm>({
    defaultValues: { producto: '', tipo: 'merma', cantidad: '', razon: '' },
  });

  const ajusteMutation = useMutation({
    mutationFn: (values: AjusteForm) =>
      createAjusteInventario({
        producto: Number(values.producto),
        tipo: values.tipo,
        cantidad: Number(values.cantidad),
        razon: values.razon || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ajustes-inventario'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({ title: 'Ajuste registrado', description: 'El movimiento de inventario se guardó con éxito.' });
      setAjusteDialogOpen(false);
      ajusteForm.reset({ producto: '', tipo: 'merma', cantidad: '', razon: '' });
    },
    onError: (err: any) => {
      toast({
        title: 'Error al registrar',
        description: err.response?.data?.error || 'Verifica los datos ingresados.',
        variant: 'destructive',
      });
    },
  });

  const filteredAjustes = useMemo(() => {
    const data: AjusteInventario[] = Array.isArray(ajustes) ? ajustes : [];
    return data.filter((a) => {
      const matchProducto = filter.producto === 'todos' ||
        a.producto_nombre.toLowerCase() === filter.producto.toLowerCase();
      const matchSearch = (a.razon || '').toLowerCase().includes(filter.search.toLowerCase()) ||
        a.producto_nombre.toLowerCase().includes(filter.search.toLowerCase());
      return matchProducto && matchSearch;
    });
  }, [ajustes, filter.producto, filter.search]);

  // 2. Lógica de filtrado unificada
// 2. Lógica de filtrado unificada con protección contra nulos
  const filteredData = useMemo(() => {
    const data = activeTab === 'entradas' ? (entradas || []) : (salidas || []);
    
    return data.filter((item: any) => {
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

  const exportarExcel = () => {
    const filas = filteredData.map((item: any) => {
      const base: Record<string, any> = {
        '#': item.pedido || item.factura,
        'Cliente / Proveedor': item.cliente_nombre || item.proveedor_nombre || 'N/A',
        'Producto': item.producto_nombre || item.producto?.nombre || 'N/A',
        'Unidades': Number(item.cantidad_unidades || 0),
        'Kilos': Number(item.cantidad_kilos || 0),
        'Precio/Kg': Number(activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta) || 0,
        'Total': Number(item.cantidad_kilos) * Number(activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta) || 0,
      };
      if (activeTab === 'salidas') {
        const costoConIva = Number(item.costo_por_kilo || 0) * FACTOR_IVA;
        const costoTotalConIva = Number(item.total_costo || 0) * FACTOR_IVA;
        base['Vendedor'] = item.vendedor_nombre || 'N/A';
        base['Costo/Kg'] = costoConIva;
        base['Costo Total'] = costoTotalConIva;
        base['Ganancia/Kg'] = Number(item.precio_venta || 0) - costoConIva;
        base['Ganancia Total'] = Number(item.total_venta || 0) - costoTotalConIva;
      }
      return base;
    });

    const worksheet = XLSX.utils.json_to_sheet(filas);
    const workbook = XLSX.utils.book_new();
    const nombreHoja = activeTab === 'entradas' ? 'Entradas' : 'Salidas';
    XLSX.utils.book_append_sheet(workbook, worksheet, nombreHoja);

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `movimientos-${activeTab}-${fecha}.xlsx`);
  };

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
            <TabsTrigger value="ajustes" className="gap-2">
              <PackageMinus className="h-4 w-4 text-destructive" /> Mermas / Ajustes
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4">
            {activeTab === 'ajustes' ? (
              <Button size="sm" className="gap-2" onClick={() => setAjusteDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Registrar Merma / Ajuste
              </Button>
            ) : (
              <>
                <div className="text-sm text-muted-foreground">
                  Mostrando <b>{filteredData.length}</b> registros
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={exportarExcel}
                  disabled={filteredData.length === 0}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Exportar a Excel
                </Button>
              </>
            )}
          </div>
        </div>

        {activeTab === 'ajustes' ? (
          loadingA ? (
            <LoadingSpinner />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-center">Tipo</TableHead>
                    <TableHead className="text-right">Cantidad (Kg)</TableHead>
                    <TableHead>Razón</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAjustes.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{new Date(a.fecha).toLocaleDateString('es-CL')}</TableCell>
                      <TableCell className="font-semibold">{a.producto_nombre}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={a.tipo === 'merma' ? 'destructive' : a.tipo === 'exceso' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {a.tipo === 'ajuste' ? 'Ajuste manual' : a.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${Number(a.cantidad) < 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {Number(a.cantidad) > 0 ? '+' : ''}{Number(a.cantidad).toFixed(2)} kg
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.razon || '—'}</TableCell>
                    </TableRow>
                  ))}
                  {filteredAjustes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        Sin mermas o ajustes registrados.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          )
        ) : (
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
                {activeTab === 'salidas' && <TableHead>Vendedor</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-right">Costo/Kg</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-right">Costo Total</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-right">Ganancia/Kg</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-right">Ganancia Total</TableHead>}
                {activeTab === 'salidas' && <TableHead className="text-center">Facturas</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((item: any, index: number) => {
                const costoConIva = Number(item.costo_por_kilo || 0) * FACTOR_IVA;
                const costoTotalConIva = Number(item.total_costo || 0) * FACTOR_IVA;
                const gananciaKg = Number(item.precio_venta || 0) - costoConIva;
                const gananciaTotal = Number(item.total_venta || 0) - costoTotalConIva;
                return (
                <TableRow key={`${activeTab}-${index}`}>
                  <TableCell className="font-mono font-medium">
                    #{item.pedido || item.factura}
                  </TableCell>
                  <TableCell>{item.cliente_nombre || item.proveedor_nombre || 'N/A'}</TableCell>
                  <TableCell className="font-semibold">{item.producto_nombre || item.producto.nombre}</TableCell>
                  <TableCell className="text-right">{Number(item.cantidad_unidades).toFixed(0)}</TableCell>
                  <TableCell className="text-right font-medium text-blue-600">
                    {Number(item.cantidad_kilos).toFixed(2)} kg
                  </TableCell>
                  <TableCell className="text-right">
                    ${formatMonto(Number(activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta))}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    ${formatMonto(item.cantidad_kilos * (activeTab === 'entradas' ? item.costo_por_kilo : item.precio_venta))}
                  </TableCell>
                  {activeTab === 'salidas' && (
                    <TableCell>{item.vendedor_nombre || 'N/A'}</TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className="text-right">${formatMonto(costoConIva)}</TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className="text-right">${formatMonto(costoTotalConIva)}</TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className={`text-right font-semibold ${gananciaKg >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                      ${formatMonto(gananciaKg)}
                    </TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className={`text-right font-bold ${gananciaTotal >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                      ${formatMonto(gananciaTotal)}
                    </TableCell>
                  )}
                  {activeTab === 'salidas' && (
                    <TableCell className="text-center">
                      {item.facturas_detalle?.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 px-2"
                          onClick={() => setSelectedFacturas(item)}
                        >
                          <FileText className="h-3 w-3" />
                          {item.facturas_detalle.length}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                );
              })}
              {filteredData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeTab === 'salidas' ? 12 : 7} className="h-32 text-center text-muted-foreground">
                    No se encontraron movimientos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        )}
      </Tabs>

      {/* DIÁLOGO: REGISTRAR MERMA / EXCESO / AJUSTE MANUAL */}
      <Dialog open={ajusteDialogOpen} onOpenChange={setAjusteDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Registrar Merma / Ajuste</DialogTitle>
            <DialogDescription>
              Registra una pérdida de inventario (merma), un excedente encontrado, o una corrección manual.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={ajusteForm.handleSubmit((v) => ajusteMutation.mutate(v))}
            className="space-y-4 py-2"
          >
            <div className="grid gap-2">
              <Label htmlFor="ajuste-producto">Producto</Label>
              <Select
                value={ajusteForm.watch('producto')}
                onValueChange={(v) => ajusteForm.setValue('producto', v)}
              >
                <SelectTrigger id="ajuste-producto">
                  <SelectValue placeholder="Seleccione un producto" />
                </SelectTrigger>
                <SelectContent>
                  {listaProductos.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ajuste-tipo">Tipo</Label>
                <Select
                  value={ajusteForm.watch('tipo')}
                  onValueChange={(v: any) => ajusteForm.setValue('tipo', v)}
                >
                  <SelectTrigger id="ajuste-tipo"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merma">Merma (pérdida)</SelectItem>
                    <SelectItem value="exceso">Exceso (encontrado)</SelectItem>
                    <SelectItem value="ajuste">Ajuste manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ajuste-cantidad">Cantidad (Kg)</Label>
                <Input
                  id="ajuste-cantidad"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  {...ajusteForm.register('cantidad', { required: true })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              {ajusteForm.watch('tipo') === 'ajuste'
                ? 'Se guarda con el signo ingresado (negativo resta stock, positivo suma).'
                : 'Ingresa la cantidad como un valor positivo; el signo se ajusta automáticamente según el tipo.'}
            </p>

            <div className="grid gap-2">
              <Label htmlFor="ajuste-razon">Razón (opcional)</Label>
              <Textarea
                id="ajuste-razon"
                placeholder="Ej: Producto vencido, error de conteo, etc."
                {...ajusteForm.register('razon')}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setAjusteDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={ajusteMutation.isPending || !ajusteForm.watch('producto')}>
                {ajusteMutation.isPending ? 'Guardando...' : 'Registrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO: DESGLOSE DE FACTURAS QUE ABASTECIERON ESTA SALIDA */}
      <Dialog open={!!selectedFacturas} onOpenChange={() => setSelectedFacturas(null)}>
        <DialogContent className="max-w-2xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>
              Facturas asociadas — Pedido #{selectedFacturas?.pedido} / {selectedFacturas?.producto_nombre || selectedFacturas?.producto?.nombre}
            </DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Unidades</TableHead>
                <TableHead className="text-right">Kilos atribuidos</TableHead>
                <TableHead className="text-right">Costo/Kg (con IVA)</TableHead>
                <TableHead className="text-right">Costo atribuido (con IVA)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(selectedFacturas?.facturas_detalle || []).map((f: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">{f.numero_factura}</TableCell>
                  <TableCell>{f.proveedor_nombre || 'N/A'}</TableCell>
                  <TableCell className="text-right">{f.unidades_consumidas}</TableCell>
                  <TableCell className="text-right">{f.kilos_atribuidos != null ? Number(f.kilos_atribuidos).toFixed(2) + ' kg' : '—'}</TableCell>
                  <TableCell className="text-right">{f.costo_por_kilo != null ? `$${formatMonto(Number(f.costo_por_kilo) * FACTOR_IVA)}` : '—'}</TableCell>
                  <TableCell className="text-right font-semibold">{f.costo_atribuido != null ? `$${formatMonto(Number(f.costo_atribuido) * FACTOR_IVA)}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground px-1">
            "Kilos atribuidos" reparte los kilos realmente vendidos (báscula) en
            proporción a las unidades tomadas de cada factura — por eso puede no
            coincidir con el peso que esas piezas tenían al comprarlas (el peso
            de una pieza varía de forma natural respecto al promedio del lote).
            Este reparto es el que hace que el costo atribuido (neto) sume exacto
            contra el costo neto total de la línea; los montos de esta tabla se
            muestran con IVA para ser consistentes con la columna "Costo Total"
            de la fila de Salidas.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Pequeño componente interno para Labels si no los tienes importados de UI
function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <label className={`text-sm font-medium leading-none ${className}`}>{children}</label>;
}