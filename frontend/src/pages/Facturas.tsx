import { useMemo, useState, useEffect } from 'react';
import { Search, Plus, Trash2, Package, Calculator, FileText, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFacturas, createFactura, getProveedores, getProductos } from '@/services/api'; 
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Factura } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface DetalleFacturaForm {
  producto: string;
  nombre_producto: string;
  cantidad_kilos: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
  costo_total: number;
}

interface FacturaForm {
  numero_factura: string;
  proveedor_id: string;
  fecha: string;
  subtotal: string;
  iva: string;
  total: string;
}

export default function Facturas() {
  const [search, setSearch] = useState('');
  const [pagoFilter, setPagoFilter] = useState<'todas' | 'pagadas' | 'pendientes'>('todas');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null);
  const [detalles, setDetalles] = useState<DetalleFacturaForm[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [nuevoItem, setNuevoItem] = useState({
    producto_id: '',
    cantidad_kilos: '',
    cantidad_unidades: '0',
    costo_por_kilo: ''
  });

  const form = useForm<FacturaForm>({
    defaultValues: {
      numero_factura: '',
      proveedor_id: '',
      fecha: new Date().toISOString().split('T')[0],
      subtotal: '0',
      iva: '0',
      total: '0',
    },
  });

  const { data: proveedores } = useQuery({ queryKey: ['proveedores'], queryFn: async () => (await getProveedores()).data });
  const { data: productos } = useQuery({ queryKey: ['productos'], queryFn: async () => (await getProductos()).data });
  const { data: facturasData, isLoading, error } = useQuery({
    queryKey: ['facturas'],
    queryFn: async () => (await getFacturas()).data as Factura[],
  });

  const agregarItem = () => {
    const prod = productos?.find(p => p.id.toString() === nuevoItem.producto_id);
    const kilos = parseFloat(nuevoItem.cantidad_kilos);
    const unidades = parseInt(nuevoItem.cantidad_unidades) || 0;
    const costo = parseFloat(nuevoItem.costo_por_kilo);

    if (!prod || isNaN(kilos) || isNaN(costo)) {
      toast({ title: "Datos incompletos", description: "Verifica los datos del producto.", variant: "destructive" });
      return;
    }

    const item: DetalleFacturaForm = {
      producto: nuevoItem.producto_id,
      nombre_producto: prod.nombre,
      cantidad_kilos: kilos,
      cantidad_unidades: unidades,
      costo_por_kilo: costo,
      costo_total: kilos * costo
    };

    setDetalles([...detalles, item]);
    setNuevoItem({ producto_id: '', cantidad_kilos: '', cantidad_unidades: '0', costo_por_kilo: '' });
  };

  useEffect(() => {
    const subtotal = detalles.reduce((acc, curr) => acc + curr.costo_total, 0);
    const iva = subtotal * 0.19;
    form.setValue('subtotal', subtotal.toFixed(0));
    form.setValue('iva', iva.toFixed(0));
    form.setValue('total', (subtotal + iva).toFixed(0));
  }, [detalles, form]);

  
  const createMutation = useMutation({
    mutationFn: (values: FacturaForm) =>
      createFactura({
        numero_factura: values.numero_factura,
        proveedor: values.proveedor_id,
        fecha: values.fecha,
        subtotal: Number(values.subtotal),
        iva: Number(values.iva),
        total: Number(values.total),
        detalles: detalles.map(d => ({
          producto: d.producto, // ID del producto
          cantidad_kilos: d.cantidad_kilos,
          cantidad_unidades: d.cantidad_unidades,
          costo_por_kilo: d.costo_por_kilo,
          costo_total: d.costo_total
        }))
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast({ title: 'Éxito', description: 'Factura registrada.' });
      form.reset();
      setDetalles([]);
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al guardar', variant: 'destructive' });
    }
  });

  const filteredFacturas = useMemo(() => {
    return (facturasData ?? []).filter((f) => {
      const matchesSearch = (f.proveedor_nombre || '').toLowerCase().includes(search.toLowerCase()) || 
                            f.numero_factura.toLowerCase().includes(search.toLowerCase());
      const pagado = Boolean(f.pago_factura);
      const matchesPago = pagoFilter === 'todas' || (pagoFilter === 'pagadas' && pagado) || (pagoFilter === 'pendientes' && !pagado);
      return matchesSearch && matchesPago;
    });
  }, [facturasData, search, pagoFilter]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar facturas" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Facturas de Entrada</h1>
          <p className="text-muted-foreground">Gestiona tus compras y aumenta tu inventario.</p>
        </div>
        
        {/* DIÁLOGO NUEVA FACTURA */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg"><Plus className="mr-2 h-5 w-5" /> Nueva Factura</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[800px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><FileText className="text-primary" /> Registrar Compra</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Controller
                    control={form.control}
                    name="proveedor_id"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Seleccione proveedor" /></SelectTrigger>
                        <SelectContent>
                          {proveedores?.map((p: any) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>N° Factura</Label>
                  <Input {...form.register('numero_factura', { required: true })} placeholder="0001" />
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-muted/30 space-y-4">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <Select value={nuevoItem.producto_id} onValueChange={(v) => setNuevoItem({ ...nuevoItem, producto_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Producto" /></SelectTrigger>
                      <SelectContent>
                        {productos?.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Input type="number" placeholder="Kg" value={nuevoItem.cantidad_kilos} onChange={e => setNuevoItem({ ...nuevoItem, cantidad_kilos: e.target.value })} /></div>
                  <div className="col-span-2"><Input type="number" placeholder="Unid." value={nuevoItem.cantidad_unidades} onChange={e => setNuevoItem({ ...nuevoItem, cantidad_unidades: e.target.value })} /></div>
                  <div className="col-span-3"><Input type="number" placeholder="Costo/Kg" value={nuevoItem.costo_por_kilo} onChange={e => setNuevoItem({ ...nuevoItem, costo_por_kilo: e.target.value })} /></div>
                  <div className="col-span-1"><Button type="button" onClick={agregarItem} className="w-full"><Plus className="h-4 w-4" /></Button></div>
                </div>

                <div className="bg-background rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b text-xs uppercase text-muted-foreground font-medium">
                      <tr>
                        <th className="p-2 text-left">Producto</th>
                        <th className="p-2 text-right">Cant.</th>
                        <th className="p-2 text-right">Total</th>
                        <th className="p-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalles.map((item, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2">{item.nombre_producto}</td>
                          <td className="p-2 text-right">{item.cantidad_kilos} Kg</td>
                          <td className="p-2 text-right font-semibold">${item.costo_total.toLocaleString()}</td>
                          <td className="p-2"><Button variant="ghost" size="icon" onClick={() => setDetalles(detalles.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end border-t pt-4 gap-8">
                <div className="text-right"><p className="text-xs text-muted-foreground uppercase">Subtotal</p><p className="font-bold">${Number(form.watch('subtotal')).toLocaleString()}</p></div>
                <div className="text-right"><p className="text-xs text-muted-foreground uppercase">Total Factura</p><p className="font-black text-xl text-primary">${Number(form.watch('total')).toLocaleString()}</p></div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={form.handleSubmit((v) => createMutation.mutate(v))} disabled={createMutation.isPending || detalles.length === 0}>Guardar Factura</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* FILTROS */}
      <div className="flex gap-4 p-4 bg-card border rounded-lg shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por número o proveedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={pagoFilter} onValueChange={(v) => setPagoFilter(v as any)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos los estados</SelectItem>
            <SelectItem value="pagadas">Pagadas</SelectItem>
            <SelectItem value="pendientes">Pendientes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* LISTADO DE FACTURAS */}
      <div className="grid gap-4">
        {filteredFacturas.map((f) => (
          <Card 
            key={f.numero_factura} 
            className="hover:border-primary cursor-pointer transition-all active:scale-[0.98]"
            onClick={() => setSelectedFactura(f)}
          >
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-muted rounded-full text-muted-foreground"><FileText className="h-6 w-6" /></div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-lg">Factura #{f.numero_factura}</h3>
                    <Badge variant={f.pago_factura ? 'outline' : 'secondary'} className={f.pago_factura ? 'border-green-500 text-green-600' : ''}>
                      {f.pago_factura ? 'Pagada' : 'Pendiente'}
                    </Badge>
                  </div>
                  <p className="font-medium text-muted-foreground">{f.proveedor_nombre}</p>
                  <p className="text-xs text-muted-foreground">{new Date(f.fecha).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-primary">${Number(f.total).toLocaleString('es-CL')}</p>
                <span className="text-xs text-primary flex items-center gap-1 justify-end mt-1"><Eye className="h-3 w-3" /> Ver detalle</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* DIÁLOGO DETALLE DE FACTURA EXISTENTE */}
      <Dialog open={!!selectedFactura} onOpenChange={() => setSelectedFactura(null)}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" /> 
              Factura #{selectedFactura?.numero_factura}
            </DialogTitle>
            <DialogDescription>
              Detalle completo de la entrada de mercadería.
            </DialogDescription>
          </DialogHeader>
          
          {selectedFactura && (
            <div className="space-y-6">
              {/* Info Cabecera */}
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-xl border">
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Proveedor</Label>
                  <p className="font-semibold text-base">{selectedFactura.proveedor_nombre || 'No especificado'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground uppercase text-[10px] font-bold">Fecha de Ingreso</Label>
                  <p className="font-semibold text-base">{new Date(selectedFactura.fecha).toLocaleDateString('es-CL')}</p>
                </div>
              </div>

              {/* Tabla de Productos */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2"><Package className="h-4 w-4" /> Productos Recibidos</Label>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="p-3 text-left">Producto</th>
                        <th className="p-3 text-right">Cantidad</th>
                        <th className="p-3 text-right">Costo Unit.</th>
                        <th className="p-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Intentamos leer de 'detalles' o 'entradas' según tu modelo de Django */}
                      {(selectedFactura.detalles || []).length > 0 ? (
                        selectedFactura.detalles?.map((d: any, i: number) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                            <td className="p-3 font-medium">{d.producto_nombre}</td>
                            <td className="p-3 text-right">{d.cantidad_kilos} Kg / {d.cantidad_unidades} Un.</td>
                            <td className="p-3 text-right">${Number(d.costo_por_kilo).toLocaleString('es-CL')}</td>
                            <td className="p-3 text-right font-bold text-primary">
                              ${Number(d.costo_total).toLocaleString('es-CL')}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-muted-foreground italic">
                            No hay detalles registrados para esta factura en la base de datos.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Resumen de Totales */}
              <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal Neto:</span>
                  <span className="font-medium">${Number(selectedFactura.subtotal).toLocaleString('es-CL')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA (19%):</span>
                  <span className="font-medium">${Number(selectedFactura.iva).toLocaleString('es-CL')}</span>
                </div>
                <div className="flex justify-between text-xl font-black text-primary border-t pt-2">
                  <span>TOTAL:</span>
                  <span>${Number(selectedFactura.total).toLocaleString('es-CL')}</span>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter className="sm:justify-start">
            <Button variant="secondary" onClick={() => setSelectedFactura(null)}>
              Cerrar Detalle
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="ml-auto">
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}