import { useMemo, useState } from 'react';
import React from 'react';
import {
  Plus, Search, MessageCircle, CheckCircle2,
  Trash2, ChevronDown, ChevronRight, MoreVertical, Edit2, TrendingUp, XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { enRango, formatCLP } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPedidos, updatePedido, cancelarPedido, cancelarProductoPedido, agregarProductoPedido, getProductos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Pedido, Producto } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ESTADOS = [
  { value: 'Reservado', label: 'Por pesar' },
  { value: 'Preparado', label: 'Por cobrar' },
  { value: 'Pagado', label: 'Pagados' },
  { value: 'Anulado', label: 'Anulados' },
] as const;

export default function Pedidos() {
  // ?estado=Reservado y ?buscar=123 llegan desde el Resumen.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('buscar') ?? '');
  const [filterEstado, setFilterEstado] = useState(searchParams.get('estado') ?? 'Todos');
  const [rango, setRango] = useState<RangoState>(rangoInicial('todo'));
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [filterCorte, setFilterCorte] = useState('Todos');
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [selectedPedidoGanancia, setSelectedPedidoGanancia] = useState<Pedido | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterVendedor, setFilterVendedor] = useState('Todos');
  const [selectedIds, setSelectedIds] = useState<number[]>([]); // Para la selección múltiple
  const [nuevoProductoId, setNuevoProductoId] = useState('');
  const [nuevoProductoKilos, setNuevoProductoKilos] = useState('');
  const [nuevoProductoUnidades, setNuevoProductoUnidades] = useState('');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => {
      const response = await getPedidos(true);
      return response.data as Pedido[];
    },
  });

  const { data: productosData } = useQuery({
    queryKey: ['productos'],
    queryFn: async () => {
      const response = await getProductos();
      return response.data as Producto[];
    },
  });

  // --- MUTACIONES ---
  const mutation = useMutation({
    mutationFn: (payload: { id: number, data: any }) => updatePedido(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: "Actualizado", description: "Pedido actualizado correctamente." });
      setSelectedPedido(null);
    },
  });

  const anularMutation = useMutation({
    mutationFn: (id: number) => cancelarPedido(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: "Anulado", description: "El pedido fue anulado." });
      setSelectedPedido(null);
    },
  });

  const cancelarProductoMutation = useMutation({
    mutationFn: (payload: { pedidoId: number, detalleId: number }) =>
      cancelarProductoPedido(payload.pedidoId, payload.detalleId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      // Refrescamos el pedido abierto en el dialog con la respuesta del backend
      // (stock revertido, total recalculado, y posiblemente el pedido entero
      // Anulado si esa era la última línea activa).
      setSelectedPedido(response.data);
      toast({ title: "Producto cancelado", description: "El stock fue devuelto al inventario." });
    },
  });

  const agregarProductoMutation = useMutation({
    mutationFn: (payload: { pedidoId: number, producto_id: number, cantidad_kilos: number, cantidad_unidades: number }) =>
      agregarProductoPedido(payload.pedidoId, {
        producto_id: payload.producto_id,
        cantidad_kilos: payload.cantidad_kilos,
        cantidad_unidades: payload.cantidad_unidades,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      setSelectedPedido(response.data);
      setNuevoProductoId('');
      setNuevoProductoKilos('');
      setNuevoProductoUnidades('');
      toast({ title: "Producto agregado", description: "Se agregó el producto al pedido." });
    },
    onError: (err: any) => {
      toast({
        title: "No se pudo agregar",
        description: err?.response?.data?.error ?? 'Error al agregar el producto',
        variant: "destructive",
      });
    },
  });

  // --- HELPERS ---
  const formatCurrency = formatCLP;

  const formatDate = (val?: string) => {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const FACTOR_IVA = 1.19;

  // total_venta viene CON IVA incluido (precio de boleta) y total_costo ya es
  // neto; la ganancia real se calcula neta de IVA en ambos lados, si no queda
  // inflada con el débito fiscal que corresponde enterar al Fisco.
  const gananciaLinea = (det: Pedido['detalles'][number]) =>
    Number(det.total_venta) / FACTOR_IVA - Number(det.total_costo);

  const getStatusColor = (estado: string) => {
    switch (estado) {
      case 'Preparado': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Pagado': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Reservado': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Anulado': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  // Las líneas Canceladas quedan en el pedido solo como historial: conservan
  // total_venta/total_costo, pero ya no forman parte del total ni de la ganancia.
  const lineasActivas = (pedido: Pedido) => pedido.detalles.filter(d => d.estado !== 'Cancelado');

  const cobrarPedido = (pedido: Pedido) => {
    let telefono = (pedido.cliente.telefono ?? '').replace(/\D/g, '');
    if (!telefono) {
      toast({ title: "Sin teléfono", description: `${pedido.cliente.nombre} no tiene teléfono registrado.`, variant: "destructive" });
      return;
    }
    if (!telefono.startsWith('56')) telefono = '56' + telefono;

    const saludo = `*Hola ${pedido.cliente.nombre}, detalle pedido #${pedido.id}:*\n\n`;
    const items = lineasActivas(pedido).map(d =>
      `• ${d.producto.nombre}: ${d.cantidad_kilos}kg = *${formatCurrency(d.total_venta)}*`
    ).join('\n');
    const totalMsg = `\n\n*TOTAL: ${formatCurrency(pedido.total)}*`;

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(saludo + items + totalMsg)}`;
    window.open(whatsappUrl, '_blank');
  };

  const filteredPedidos = useMemo(() => {
    let filtered = data ?? [];
    if (search) {
      const searchLower = search.toLowerCase().replace(/^#/, '');
      filtered = filtered.filter(p => 
        p.cliente.nombre.toLowerCase().includes(searchLower) || 
        p.id.toString() === searchLower
      );
    }
    if (filterEstado === 'Todos') {
      filtered = filtered.filter(p => p.estado !== 'Anulado');
    } else {
      filtered = filtered.filter(p => p.estado === filterEstado);
    }
    if (filterVendedor !== 'Todos') {
      filtered = filtered.filter(p => p.vendedor?.id?.toString() === filterVendedor);
    }
    if (filterCorte !== 'Todos') {
      filtered = filtered.filter(p => p.detalles.some(d => d.producto.nombre === filterCorte));
    }
    filtered = filtered.filter(p => enRango(p.fecha, rango.rango));
    return [...filtered].sort((a, b) => b.id - a.id);
  }, [data, search, filterEstado, filterCorte, filterVendedor, rango]);

  // Conteo y monto por estado dentro del período y filtros actuales (sin el de estado).
  const resumenEstados = useMemo(() => {
    const base = (data ?? []).filter(p =>
      enRango(p.fecha, rango.rango) &&
      (filterVendedor === 'Todos' || p.vendedor?.id?.toString() === filterVendedor) &&
      (filterCorte === 'Todos' || p.detalles.some(d => d.producto.nombre === filterCorte))
    );
    return ESTADOS.map(e => {
      const del = base.filter(p => p.estado === e.value);
      return { ...e, cantidad: del.length, monto: del.reduce((s, p) => s + Number(p.total), 0) };
    });
  }, [data, rango, filterVendedor, filterCorte]);

  const vendedoresEnPedidos = useMemo(() => {
    const m = new Map<number, string>();
    (data ?? []).forEach(p => p.vendedor && m.set(p.vendedor.id, p.vendedor.nombre));
    return Array.from(m, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [data]);

  // Suma de pedidos seleccionados (Solo se mostrará en pantallas grandes)
  const sumaSeleccionados = useMemo(() => {
    return data?.filter(p => selectedIds.includes(p.id))
              .reduce((acc, p) => acc + Number(p.total), 0) || 0;
  }, [data, selectedIds]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };
  const productosDisponiblesParaAgregar = useMemo(() => {
    const productos = productosData ?? [];
    const idsEnPedido = new Set(
      (selectedPedido?.detalles ?? [])
        .filter(d => d.estado !== 'Cancelado')
        .map(d => d.producto.id)
    );
    return productos.filter(p => p.estado !== 'desactivado' && !idsEnPedido.has(p.id));
  }, [productosData, selectedPedido]);

  const todosPesados = useMemo(() => {
    const activos = selectedPedido?.detalles.filter(det => det.estado !== 'Cancelado') ?? [];
    return activos.length > 0 && activos.every(det => Number(det.cantidad_kilos) > 0);
  }, [selectedPedido?.detalles]);

  const handleEditLocal = (index: number, field: string, value: any) => {
    if (!selectedPedido) return;
    if (selectedPedido.detalles[index]?.estado === 'Cancelado') return;
    const valAsNum = typeof value === 'string' ? (value === '' ? 0 : parseFloat(value)) : value;
    const nuevosDetalles = selectedPedido.detalles.map((det, i) => {
      if (i !== index) return det;
      if (field === 'cantidad_kilos') {
        const kilos = valAsNum;
        // Usamos el precio_venta ya guardado en la línea (no producto.precio_por_kilo):
        // si la línea tiene un descuento por kilo aplicado, precio_venta ya lo refleja,
        // y el backend recalcula el total de la misma forma al guardar (kilos * precio_venta).
        return { ...det, cantidad_kilos: kilos, total_venta: kilos * Number(det.precio_venta) };
      }
      if (field === 'cantidad_unidades') {
        return { ...det, cantidad_unidades: Math.trunc(valAsNum) };
      }
      return { ...det, [field]: valAsNum };
    });
    // Las líneas Canceladas ya no cuentan para el total: su stock/costo fue
    // revertido al inventario y solo se conservan como historial.
    const nuevoTotal = nuevosDetalles
      .filter(d => d.estado !== 'Cancelado')
      .reduce((sum, d) => sum + (Number(d.total_venta) || 0), 0);
    setSelectedPedido({ ...selectedPedido, detalles: nuevosDetalles, total: nuevoTotal });
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar pedidos" />;

  return (
    <div className="max-w-[100vw] overflow-x-hidden space-y-4 pb-24">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 md:px-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground text-sm hidden sm:block">Toca un pedido para ver sus productos.</p>
        </div>
        <div className="flex items-center gap-2">
          <RangoFechaSelect value={rango} onChange={setRango} />
          <Button onClick={() => navigate('/pedidos/nuevo')}>
            <Plus className="mr-1 h-4 w-4" /> Nuevo
          </Button>
        </div>
      </div>

      {/* RESUMEN POR ESTADO: tocar uno filtra la lista */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-2 md:px-0">
        {resumenEstados.map(e => {
          const activo = filterEstado === e.value;
          return (
            <button
              key={e.value}
              onClick={() => setFilterEstado(activo ? 'Todos' : e.value)}
              className={`rounded-xl border p-3 text-left transition-colors ${activo ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/50'}`}
            >
              <div className="flex items-center justify-between">
                <Badge className={`text-[10px] border-none ${getStatusColor(e.value)}`}>{e.label}</Badge>
                <span className="text-xs text-muted-foreground">{e.cantidad}</span>
              </div>
              <div className="mt-1.5 text-lg font-bold tabular-nums">{formatCLP(e.monto)}</div>
            </button>
          );
        })}
      </div>

{/* FILTROS ACTUALIZADOS */}
<div className="grid grid-cols-1 px-2 md:grid-cols-4 gap-3"> {/* Cambiado a grid-cols-4 en md */}
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input 
      className="pl-9 h-12 bg-white border-slate-200" 
      placeholder="Cliente o N° de pedido..." 
      value={search} 
      onChange={e => setSearch(e.target.value)} 
    />
  </div>
  
  <div className="grid grid-cols-2 gap-2 md:contents">
    <Select value={filterEstado} onValueChange={setFilterEstado}>
      <SelectTrigger className="h-12 bg-white"><SelectValue placeholder="Estado" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Todos">Todos (sin anulados)</SelectItem>
        {ESTADOS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
      </SelectContent>
    </Select>

    {/* NUEVO FILTRO VENDEDOR */}
    <Select value={filterVendedor} onValueChange={setFilterVendedor}>
      <SelectTrigger className="h-12 bg-white"><SelectValue placeholder="Vendedor" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Todos">Todos los Vendedores</SelectItem>
        {vendedoresEnPedidos.map(v => <SelectItem key={v.id} value={v.id.toString()}>{v.nombre}</SelectItem>)}
      </SelectContent>
    </Select>
          <Select value={filterCorte} onValueChange={setFilterCorte}>
            <SelectTrigger className="h-12 bg-white">
              <SelectValue placeholder="Producto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos los cortes</SelectItem>
              {Array.from(new Set(data?.flatMap(p => p.detalles.map(d => d.producto.nombre)))).sort().map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* TABLA PRINCIPAL - Optimizada para no salirse */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-8 px-2"></TableHead>
              <TableHead className="w-8 px-2"></TableHead>
              <TableHead className="w-12 px-1">N°</TableHead>
              <TableHead className="px-2">Cliente</TableHead>
              <TableHead className="px-2 hidden lg:table-cell">Vendedor</TableHead>
              <TableHead className="px-2 hidden lg:table-cell">Estado</TableHead>
              <TableHead className="px-2 hidden lg:table-cell">Fecha</TableHead>
              <TableHead className="text-right px-2">Total</TableHead>
              <TableHead className="w-10 px-2"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPedidos.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  No hay pedidos con estos filtros.
                </TableCell>
              </TableRow>
            )}
            {filteredPedidos.map((pedido) => (
              <React.Fragment key={pedido.id}>
                <TableRow className="border-b last:border-0" onClick={() => setExpandedId(expandedId === pedido.id ? null : pedido.id)}>
                  <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
              <input 
                type="checkbox" 
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={selectedIds.includes(pedido.id)}
                onChange={() => toggleSelect(pedido.id)}
              />
            </TableCell>
                  <TableCell className="px-2">
                    {expandedId === pedido.id ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </TableCell>
                  <TableCell className="px-1 font-mono text-xs font-bold text-blue-600">#{pedido.id}</TableCell>
                  <TableCell className="px-2 py-3">
                    <div className="font-semibold text-sm line-clamp-1">{pedido.cliente.nombre}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 lg:hidden">
                      <Badge className={`text-[9px] px-1 py-0 h-4 border-none ${getStatusColor(pedido.estado)}`}>{pedido.estado}</Badge>
                      <span className="text-[10px] text-slate-400 font-medium">{formatDate(pedido.fecha)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 hidden lg:table-cell text-sm text-slate-600">{pedido.vendedor?.nombre ?? '—'}</TableCell>
                  <TableCell className="px-2 hidden lg:table-cell">
                    <Badge className={`text-[10px] px-2 py-0.5 h-5 border-none ${getStatusColor(pedido.estado)}`}>{pedido.estado}</Badge>
                  </TableCell>
                  <TableCell className="px-2 hidden lg:table-cell text-sm text-slate-500">{formatDate(pedido.fecha)}</TableCell>
                  <TableCell className="px-2 text-right font-bold text-sm">{formatCurrency(pedido.total)}</TableCell>
                  <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => setSelectedPedido(pedido)}>
                          <Edit2 className="mr-2 h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedPedidoGanancia(pedido)}>
                          <TrendingUp className="mr-2 h-4 w-4" /> Ver ganancia
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => cobrarPedido(pedido)} className="text-green-600">
                          <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                        </DropdownMenuItem>
                        {pedido.estado !== 'Pagado' && pedido.estado !== 'Anulado' && (
                          <DropdownMenuItem
                            onClick={() => confirm({
                              title: `¿Marcar el pedido #${pedido.id} como pagado?`,
                              description: `${pedido.cliente.nombre} · ${formatCurrency(pedido.total)}`,
                              confirmLabel: 'Marcar pagado',
                              onConfirm: () => mutation.mutate({ id: pedido.id, data: { ...pedido, estado: 'Pagado' }}),
                            })}
                            className="text-blue-600"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar Pagado
                          </DropdownMenuItem>
                        )}
                        {/* SECCIÓN DE ANULACIÓN */}
                        {pedido.estado !== 'Anulado' && (
                          <DropdownMenuItem
                            onClick={() => confirm({
                              title: `¿Anular el pedido #${pedido.id}?`,
                              description: `${pedido.cliente.nombre} · ${formatCurrency(pedido.total)}. El stock será devuelto al inventario.`,
                              confirmLabel: 'Anular pedido',
                              destructive: true,
                              onConfirm: () => anularMutation.mutate(pedido.id),
                            })}
                            className="text-red-600 focus:text-red-600 focus:bg-red-50"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Anular Pedido
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>

                {expandedId === pedido.id && (
                  <TableRow className="bg-slate-50/80">
                    <TableCell colSpan={9} className="p-2">
                      {pedido.observaciones && (
                        <p className="mx-1 mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                          <span className="font-bold">Nota:</span> {pedido.observaciones}
                        </p>
                      )}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5 w-full">
                        {pedido.detalles.map((det, idx) => (
                          <div key={idx} className={`flex justify-between items-center p-2.5 bg-white rounded-lg border border-slate-200 shadow-xs mx-1 ${det.estado === 'Cancelado' ? 'opacity-50' : ''}`}>
                            <div className="flex flex-col">
                              <span className={`text-xs font-bold text-slate-700 ${det.estado === 'Cancelado' ? 'line-through' : ''}`}>{det.producto.nombre}</span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {det.estado === 'Cancelado' ? 'Cancelado' : `${det.cantidad_unidades} un.`}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-bold text-blue-600 block">{det.cantidad_kilos} kg</span>
                              <span className="text-[10px] text-slate-500 font-bold">{formatCurrency(det.total_venta)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
        {/* BARRA DE SUMA FLOTANTE (Desktop Only) */}
  {selectedIds.length > 0 && (
    <div className="flex fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-4 md:px-6 py-3 rounded-full shadow-2xl items-center gap-4 md:gap-6 animate-in slide-in-from-bottom-4 max-w-[calc(100vw-2rem)]">
      <div className="flex flex-col border-r border-slate-700 pr-6">
        <span className="text-[10px] text-slate-400 font-bold uppercase">Seleccionados</span>
        <span className="font-mono font-bold">{selectedIds.length} pedidos</span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] text-slate-400 font-bold uppercase">Suma Total</span>
        <span className="text-xl font-black text-blue-400">{formatCurrency(sumaSeleccionados)}</span>
      </div>
      <Button 
        variant="ghost" 
        size="sm" 
        className="text-slate-400 hover:text-white"
        onClick={() => setSelectedIds([])}
      >
        Limpiar
      </Button>
    </div>
  )}
      </div>

      {/* DIÁLOGO DE EDICIÓN RESPONSIVO (VISTA TARJETAS EN MÓVIL) */}
      <Dialog open={!!selectedPedido} onOpenChange={() => setSelectedPedido(null)}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-4 border-b bg-slate-50/50">
            <DialogTitle className="flex items-center gap-2">
              Pedido <span className="text-blue-600">#{selectedPedido?.id}</span>
              {selectedPedido?.fecha && (
                <span className="text-xs font-normal text-slate-400">{formatDate(selectedPedido.fecha)}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedPedido?.observaciones && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <span className="font-bold">Nota de entrega:</span> {selectedPedido.observaciones}
              </p>
            )}
            {selectedPedido?.detalles.map((det, idx) => {
              const cancelado = det.estado === 'Cancelado';
              return (
                <div key={idx} className={`p-4 border rounded-xl bg-white shadow-sm space-y-4 ${cancelado ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-start">
                    <h3 className={`font-bold text-slate-900 ${cancelado ? 'line-through' : ''}`}>{det.producto.nombre}</h3>
                    <div className="flex items-center gap-1.5">
                      {cancelado ? (
                        <Badge className="text-[10px] bg-red-100 text-red-700 border-none">Cancelado</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">{formatCurrency(det.precio_venta)}/kg</Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Unidades</label>
                      <Input
                        type="number"
                        disabled={cancelado}
                        className="h-12 text-center text-lg font-bold bg-slate-50"
                        value={det.cantidad_unidades || ''}
                        onChange={(e) => handleEditLocal(idx, 'cantidad_unidades', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Kilos</label>
                      <Input
                        type="number"
                        step="0.01"
                        disabled={cancelado}
                        className="h-12 text-center text-lg font-bold border-blue-200 focus:ring-blue-500"
                        value={det.cantidad_kilos || ''}
                        onChange={(e) => handleEditLocal(idx, 'cantidad_kilos', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-dashed flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400">SUBTOTAL</span>
                    <span className="font-black text-blue-600">{formatCurrency(det.total_venta)}</span>
                  </div>

                  {!cancelado && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      disabled={cancelarProductoMutation.isPending}
                      onClick={() => {
                        if (!selectedPedido) return;
                        const pedidoId = selectedPedido.id;
                        confirm({
                          title: `¿Cancelar "${det.producto.nombre}"?`,
                          description: 'Se quita de este pedido y el stock vuelve al inventario.',
                          confirmLabel: 'Cancelar producto',
                          destructive: true,
                          onConfirm: () => cancelarProductoMutation.mutate({ pedidoId, detalleId: det.id }),
                        });
                      }}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> Cancelar producto
                    </Button>
                  )}
                </div>
              );
            })}

            {selectedPedido && selectedPedido.estado !== 'Anulado' && (
              <div className="p-4 border rounded-xl bg-slate-50 space-y-3">
                <h3 className="text-xs font-black uppercase text-slate-400">Agregar producto</h3>
                <Select value={nuevoProductoId} onValueChange={setNuevoProductoId}>
                  <SelectTrigger className="h-12 bg-white">
                    <SelectValue placeholder="Selecciona un producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {productosDisponiblesParaAgregar.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Unidades</label>
                    <Input
                      type="number"
                      className="h-12 text-center text-lg font-bold bg-white"
                      value={nuevoProductoUnidades}
                      onChange={(e) => setNuevoProductoUnidades(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Kilos</label>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-12 text-center text-lg font-bold bg-white"
                      value={nuevoProductoKilos}
                      onChange={(e) => setNuevoProductoKilos(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={!nuevoProductoId || agregarProductoMutation.isPending}
                  onClick={() => {
                    if (!selectedPedido || !nuevoProductoId) return;
                    agregarProductoMutation.mutate({
                      pedidoId: selectedPedido.id,
                      producto_id: parseInt(nuevoProductoId, 10),
                      cantidad_kilos: nuevoProductoKilos ? parseFloat(nuevoProductoKilos) : 0,
                      cantidad_unidades: nuevoProductoUnidades ? parseInt(nuevoProductoUnidades, 10) : 0,
                    });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" /> Agregar al pedido
                </Button>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Total Pedido</span>
              <span className="text-2xl font-black">{formatCurrency(selectedPedido?.total || 0)}</span>
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 font-bold px-6 h-12"
              onClick={() => {
                if (selectedPedido) {
                  let p = {...selectedPedido};
                  if (todosPesados && p.estado === 'Reservado') p.estado = 'Preparado';
                  mutation.mutate({ id: p.id, data: p });
                }
              }}
            >
              Listo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO DE ANÁLISIS DE COSTO Y GANANCIA (SOLO LECTURA) */}
      <Dialog open={!!selectedPedidoGanancia} onOpenChange={() => setSelectedPedidoGanancia(null)}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-4 border-b bg-slate-50/50">
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Ganancia — Pedido <span className="text-blue-600">#{selectedPedidoGanancia?.id}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {selectedPedidoGanancia && (() => {
              const detalles = lineasActivas(selectedPedidoGanancia);
              const totalVenta = detalles.reduce((sum, d) => sum + Number(d.total_venta), 0);
              const totalVentaNeta = totalVenta / FACTOR_IVA;
              const totalCostoNeto = detalles.reduce((sum, d) => sum + Number(d.total_costo), 0);
              const totalCostoConIva = totalCostoNeto * FACTOR_IVA;
              const gananciaTotal = totalVentaNeta - totalCostoNeto;
              const margenPct = totalVentaNeta > 0 ? (gananciaTotal / totalVentaNeta) * 100 : 0;

              return (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2">Producto</TableHead>
                        <TableHead className="text-right px-2">Costo/Kg</TableHead>
                        <TableHead className="text-right px-2">Costo</TableHead>
                        <TableHead className="text-right px-2">Venta</TableHead>
                        <TableHead className="text-right px-2">Ganancia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalles.map((det, idx) => {
                        const costoConIva = Number(det.total_costo) * FACTOR_IVA;
                        const kilos = Number(det.cantidad_kilos);
                        const costoPorKilo = kilos > 0 ? costoConIva / kilos : 0;
                        const ganancia = gananciaLinea(det);
                        return (
                          <TableRow key={idx}>
                            <TableCell className="px-2">
                              <div className="font-semibold text-sm">{det.producto.nombre}</div>
                              <div className="text-[10px] text-slate-400">{det.cantidad_kilos} kg</div>
                            </TableCell>
                            <TableCell className="text-right px-2 text-sm text-slate-500">{formatCurrency(costoPorKilo)}</TableCell>
                            <TableCell className="text-right px-2 text-sm">{formatCurrency(costoConIva)}</TableCell>
                            <TableCell className="text-right px-2 text-sm">{formatCurrency(det.total_venta)}</TableCell>
                            <TableCell className={`text-right px-2 text-sm font-bold ${ganancia >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                              {formatCurrency(ganancia)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <div className="mt-4 p-4 rounded-xl border bg-slate-50 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Costo total (con IVA)</span>
                      <span className="font-semibold">{formatCurrency(totalCostoConIva)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Venta total</span>
                      <span className="font-semibold">{formatCurrency(totalVenta)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-dashed">
                      <span className="text-xs font-bold uppercase text-slate-400">Ganancia total</span>
                      <span className={`text-xl font-black ${gananciaTotal >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {formatCurrency(gananciaTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase text-slate-400">Margen</span>
                      <span className={`text-sm font-bold ${margenPct >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {margenPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}