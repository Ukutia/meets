import { useMemo, useState, useEffect } from 'react';
import { Search, Plus, Trash2, Package, Calculator, FileText, Eye, Pencil, Lock, AlertTriangle, BadgeCheck } from 'lucide-react';
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
import { getFacturas, createFactura, updateFactura, getProveedores, getProductos, getMargenProductos, pagarFactura } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Factura, EstadoEdicionLinea } from '@/types';
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

// Línea en el formulario de edición: arrastra el estado de consumo calculado
// por el backend para saber qué campos bloquear y por qué.
interface EditLinea {
  id?: number;
  producto: number;
  nombre_producto: string;
  cantidad_kilos: number;
  cantidad_unidades: number;
  costo_por_kilo: number;
  estado_edicion: EstadoEdicionLinea;
  unidades_consumidas: number;
  pedidos_consumidores: number[];
}

export default function Facturas() {
  const [search, setSearch] = useState('');
  const [pagoFilter, setPagoFilter] = useState<'todas' | 'pagadas' | 'pendientes'>('todas');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null);
  const [detalles, setDetalles] = useState<DetalleFacturaForm[]>([]);
  // Estado del diálogo de EDICIÓN de una factura existente.
  const [editFactura, setEditFactura] = useState<Factura | null>(null);
  const [editProveedor, setEditProveedor] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editDetalles, setEditDetalles] = useState<EditLinea[]>([]);
  const [pagoFecha, setPagoFecha] = useState('');
  const [pagoMonto, setPagoMonto] = useState('');
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
  // Margen actual/histórico por producto para la vista previa en vivo (Plan 03)
  const { data: margenProductos } = useQuery({
    queryKey: ['margen-productos'],
    queryFn: async () => (await getMargenProductos()).data as any[],
  });

  const margenMap = useMemo(() => {
    const m = new Map<string, any>();
    (margenProductos ?? []).forEach((r) => m.set(String(r.producto_id), r));
    return m;
  }, [margenProductos]);

  // El costo_por_kilo ingresado en este formulario es SIN IVA (el IVA se
  // calcula aparte para el total de la factura, ver useEffect de subtotal/iva
  // más abajo). El costo real pagado al proveedor incluye ese 19%, así que el
  // margen proyectado debe descontar el costo CON IVA, no el neto ingresado.
  const IVA_RATE = 1.19;

  // Margen proyectado de una línea: precio de venta vigente vs. costo real (con IVA).
  const calcMargen = (item: DetalleFacturaForm) => {
    const info = margenMap.get(String(item.producto));
    const precio = Number(info?.precio_por_kilo ?? 0);
    const costoConIva = Number(item.costo_por_kilo || 0) * IVA_RATE;
    const margenUnit = precio - costoConIva;
    const pct = precio ? (margenUnit / precio) * 100 : 0;
    const hist = info?.margen_pct_historico;
    // Verde si el margen proyectado supera (o iguala) el margen histórico del
    // producto; si no hay histórico, verde cuando el margen es positivo.
    const mejor = hist == null ? margenUnit >= 0 : pct >= Number(hist);
    return { precio, margenUnit, pct, hist, mejor, tieneInfo: !!info };
  };
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

  // Abrir el diálogo de edición pre-poblado con la factura seleccionada.
  const openEdit = (f: Factura) => {
    setEditFactura(f);
    setEditProveedor(f.proveedor != null ? String(f.proveedor) : '');
    setEditFecha(f.fecha ? String(f.fecha).split('T')[0] : '');
    setEditDetalles((f.detalles || []).map((d: any) => ({
      id: d.id,
      producto: Number(d.producto),
      nombre_producto: d.producto_nombre || '',
      cantidad_kilos: Number(d.cantidad_kilos) || 0,
      cantidad_unidades: Number(d.cantidad_unidades) || 0,
      costo_por_kilo: Number(d.costo_por_kilo) || 0,
      estado_edicion: (d.estado_edicion || 'libre') as EstadoEdicionLinea,
      unidades_consumidas: Number(d.unidades_consumidas) || 0,
      pedidos_consumidores: d.pedidos_consumidores || [],
    })));
    setSelectedFactura(null);
  };

  const updateLinea = (idx: number, patch: Partial<EditLinea>) =>
    setEditDetalles(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // Totales proyectados de la edición (mismo cálculo que en creación: subtotal + IVA 19%).
  const editSubtotal = editDetalles.reduce((acc, l) => acc + l.cantidad_kilos * l.costo_por_kilo, 0);
  const editTotal = editSubtotal + editSubtotal * 0.19;
  // Una línea parcial no puede quedar por debajo de lo ya vendido.
  const editTieneError = editDetalles.some(
    l => l.estado_edicion === 'parcial' && l.cantidad_unidades < l.unidades_consumidas
  );
  // Advertencia (no bloqueo) si ya hay un pago y el total cambia.
  const totalOriginal = Number(editFactura?.total ?? 0);
  const totalCambia = Math.round(editTotal) !== Math.round(totalOriginal);
  const advertirPago = Boolean(editFactura?.pago_factura) && totalCambia;

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFactura(editFactura!.numero_factura, {
        proveedor: editProveedor,
        fecha: editFecha,
        detalles: editDetalles.map(l => ({
          id: l.id,
          producto: l.producto,
          cantidad_kilos: l.cantidad_kilos,
          cantidad_unidades: l.cantidad_unidades,
          costo_por_kilo: l.costo_por_kilo,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['margen-productos'] });
      toast({ title: 'Éxito', description: 'Factura actualizada.' });
      setEditFactura(null);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al actualizar', variant: 'destructive' });
    },
  });

  const pagarMutation = useMutation({
    mutationFn: () =>
      pagarFactura(selectedFactura!.numero_factura, pagoFecha, Number(pagoMonto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      toast({ title: 'Éxito', description: 'Pago registrado.' });
      setSelectedFactura(null);
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.response?.data?.error || 'Error al registrar el pago', variant: 'destructive' });
    },
  });

  // Al abrir el detalle de una factura sin pago, precarga fecha de hoy y el total como default.
  useEffect(() => {
    if (selectedFactura && !selectedFactura.pago_factura) {
      setPagoFecha(new Date().toISOString().split('T')[0]);
      setPagoMonto(String(selectedFactura.total));
    }
  }, [selectedFactura]);

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
                        <th className="p-2 text-right">Margen Proy.</th>
                        <th className="p-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalles.map((item, i) => {
                        const m = calcMargen(item);
                        return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2">{item.nombre_producto}</td>
                          <td className="p-2 text-right">{item.cantidad_kilos} Kg</td>
                          <td className="p-2 text-right font-semibold">${item.costo_total.toLocaleString()}</td>
                          <td className="p-2 text-right">
                            {m.tieneInfo ? (
                              <div className={m.mejor ? 'text-green-600' : 'text-destructive'}>
                                <div className="font-bold leading-tight">${Math.round(m.margenUnit).toLocaleString('es-CL')}/kg</div>
                                <div className="text-[10px] leading-tight">
                                  {m.pct.toFixed(1)}%
                                  {m.hist != null && (
                                    <span className="text-muted-foreground"> (hist {Number(m.hist).toFixed(1)}%)</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-2"><Button variant="ghost" size="icon" onClick={() => setDetalles(detalles.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                        </tr>
                        );
                      })}
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

              {/* Estado de pago */}
              {selectedFactura.pago_factura ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  <span>
                    Pagada el {new Date(selectedFactura.pago_factura.fecha_de_pago).toLocaleDateString('es-CL')} —
                    ${Number(selectedFactura.pago_factura.monto_del_pago).toLocaleString('es-CL')}
                  </span>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                  <Label className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" /> Marcar como pagada</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Fecha de pago</Label>
                      <Input type="date" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Monto pagado</Label>
                      <Input type="number" value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => pagarMutation.mutate()}
                    disabled={pagarMutation.isPending || !pagoFecha || !pagoMonto}
                  >
                    <BadgeCheck className="h-4 w-4" /> Registrar pago
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-start">
            <Button variant="secondary" onClick={() => setSelectedFactura(null)}>
              Cerrar Detalle
            </Button>
            <Button variant="default" onClick={() => selectedFactura && openEdit(selectedFactura)} className="ml-auto gap-2">
              <Pencil className="h-4 w-4" /> Editar
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO EDICIÓN DE FACTURA */}
      <Dialog open={!!editFactura} onOpenChange={(o) => !o && setEditFactura(null)}>
        <DialogContent className="sm:max-w-[820px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Pencil className="h-6 w-6 text-primary" /> Editar Factura #{editFactura?.numero_factura}
            </DialogTitle>
            <DialogDescription>
              Los cambios de cantidad/costo están limitados según cuánto stock de cada línea ya se vendió.
              Los márgenes de ventas pasadas no se recalculan.
            </DialogDescription>
          </DialogHeader>

          {editFactura && (
            <div className="space-y-6">
              {/* Cabecera editable */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Select value={editProveedor} onValueChange={setEditProveedor}>
                    <SelectTrigger><SelectValue placeholder="Seleccione proveedor" /></SelectTrigger>
                    <SelectContent>
                      {proveedores?.map((p: any) => (
                        <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input type="date" value={editFecha} onChange={(e) => setEditFecha(e.target.value)} />
                </div>
              </div>

              {/* Líneas con guardas de stock */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2"><Package className="h-4 w-4" /> Líneas de la factura</Label>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b text-xs uppercase text-muted-foreground font-medium">
                      <tr>
                        <th className="p-2 text-left">Producto</th>
                        <th className="p-2 text-right w-24">Kg</th>
                        <th className="p-2 text-right w-24">Unid.</th>
                        <th className="p-2 text-right w-28">Costo/Kg</th>
                        <th className="p-2 text-left w-40">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editDetalles.map((l, i) => {
                        const bloqueada = l.estado_edicion === 'bloqueada';
                        const parcial = l.estado_edicion === 'parcial';
                        const errorLinea = parcial && l.cantidad_unidades < l.unidades_consumidas;
                        return (
                          <tr key={l.id ?? i} className="border-b last:border-0 align-top">
                            <td className="p-2 font-medium">{l.nombre_producto}</td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className="text-right h-8"
                                disabled={bloqueada}
                                value={l.cantidad_kilos}
                                onChange={(e) => updateLinea(i, { cantidad_kilos: parseFloat(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className={`text-right h-8 ${errorLinea ? 'border-destructive' : ''}`}
                                disabled={bloqueada}
                                min={parcial ? l.unidades_consumidas : 0}
                                value={l.cantidad_unidades}
                                onChange={(e) => updateLinea(i, { cantidad_unidades: parseInt(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                className="text-right h-8"
                                disabled={bloqueada}
                                value={l.costo_por_kilo}
                                onChange={(e) => updateLinea(i, { costo_por_kilo: parseFloat(e.target.value) || 0 })}
                              />
                            </td>
                            <td className="p-2">
                              {bloqueada ? (
                                <div
                                  className="space-y-1"
                                  title={l.pedidos_consumidores.length ? `Vendida en pedido(s): ${l.pedidos_consumidores.join(', ')}` : 'Stock totalmente consumido'}
                                >
                                  <Badge variant="destructive" className="gap-1"><Lock className="h-3 w-3" /> Vendida</Badge>
                                  <p className="text-[10px] text-muted-foreground leading-tight">
                                    {l.pedidos_consumidores.length
                                      ? `Pedido(s): ${l.pedidos_consumidores.join(', ')}`
                                      : 'Sin stock disponible'}
                                  </p>
                                </div>
                              ) : parcial ? (
                                <div className="space-y-1">
                                  <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Parcial
                                  </Badge>
                                  <p className={`text-[10px] leading-tight ${errorLinea ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                                    {l.unidades_consumidas} unid. ya vendidas (mínimo)
                                  </p>
                                </div>
                              ) : (
                                <Badge variant="secondary">Editable</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Advertencia de pago desincronizado */}
              {advertirPago && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Esta factura ya tiene un pago registrado. El nuevo total (${Math.round(editTotal).toLocaleString('es-CL')})
                    no coincide con el monto pagado; deberás reconciliar el pago manualmente.
                  </span>
                </div>
              )}

              {/* Totales proyectados */}
              <div className="flex justify-end border-t pt-4 gap-8">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase">Subtotal</p>
                  <p className="font-bold">${Math.round(editSubtotal).toLocaleString('es-CL')}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase">Total</p>
                  <p className="font-black text-xl text-primary">${Math.round(editTotal).toLocaleString('es-CL')}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditFactura(null)}>Cancelar</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || editTieneError}
            >
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}