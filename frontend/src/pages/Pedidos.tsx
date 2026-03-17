import { useMemo, useState } from 'react';
import React from 'react';
import { 
  Plus, Search, MessageCircle, CheckCircle2, 
  Trash2, ChevronDown, ChevronRight, MoreVertical, Edit2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPedidos, updatePedido, cancelarPedido } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Pedido } from '@/types';
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

export default function Pedidos() {
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('Todos');
  const [filterCorte, setFilterCorte] = useState('Todos');
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterVendedor, setFilterVendedor] = useState('Todos');
  const [selectedIds, setSelectedIds] = useState<number[]>([]); // Para la selección múltiple
  
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => {
      const response = await getPedidos();
      return response.data as Pedido[];
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

  // --- HELPERS ---
  const formatCurrency = (val: any) => 
    Number(val).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });

  const getStatusColor = (estado: string) => {
    switch (estado) {
      case 'Preparado': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Pagado': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'Reservado': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const cobrarPedido = (pedido: Pedido) => {
    const saludo = `*Hola ${pedido.cliente.nombre}, detalle pedido #00${pedido.id}:*\n\n`;
    const items = pedido.detalles.map(d => 
      `• ${d.producto.nombre}: ${d.cantidad_kilos}kg = *${formatCurrency(d.total_venta)}*`
    ).join('\n');
    const totalMsg = `\n\n*TOTAL: ${formatCurrency(pedido.total)}*`;
    
    let telefono = pedido.cliente.telefono.replace(/\s/g, '');
    if (!telefono.startsWith('56')) telefono = '56' + telefono;

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(saludo + items + totalMsg)}`;
    window.open(whatsappUrl, '_blank');
  };

  const filteredPedidos = useMemo(() => {
    let filtered = data ?? [];
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(p => 
        p.cliente.nombre.toLowerCase().includes(searchLower) || 
        p.id.toString().includes(searchLower)
      );
    }
    if (filterEstado !== 'Todos') filtered = filtered.filter(p => p.estado === filterEstado);
    if (filterVendedor !== 'Todos') {
      filtered = filtered.filter(p => p.vendedor?.id?.toString() === filterVendedor || p.vendedor_id?.toString() === filterVendedor);
    }
    if (filterCorte !== 'Todos') {
      filtered = filtered.filter(p => p.detalles.some(d => d.producto.nombre === filterCorte));
    }
    return [...filtered].sort((a, b) => b.id - a.id);
  }, [data, search, filterEstado, filterCorte, filterVendedor]);

  // Suma de pedidos seleccionados (Solo se mostrará en pantallas grandes)
  const sumaSeleccionados = useMemo(() => {
    return data?.filter(p => selectedIds.includes(p.id))
              .reduce((acc, p) => acc + Number(p.total), 0) || 0;
  }, [data, selectedIds]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };
  const todosPesados = useMemo(() => {
    return selectedPedido?.detalles.every(det => Number(det.cantidad_kilos) > 0);
  }, [selectedPedido?.detalles]);

  const handleEditLocal = (index: number, field: string, value: any) => {
    if (!selectedPedido) return;
    const valAsNum = typeof value === 'string' ? (value === '' ? 0 : parseFloat(value)) : value;
    const nuevosDetalles = selectedPedido.detalles.map((det, i) => {
      if (i !== index) return det;
      if (field === 'cantidad_kilos') {
        const kilos = valAsNum;
        return { ...det, cantidad_kilos: kilos, total_venta: kilos * Number(det.producto.precio_por_kilo) };
      }
      if (field === 'cantidad_unidades') {
        return { ...det, cantidad_unidades: Math.trunc(valAsNum) };
      }
      return { ...det, [field]: valAsNum };
    });
    const nuevoTotal = nuevosDetalles.reduce((sum, d) => sum + (Number(d.total_venta) || 0), 0);
    setSelectedPedido({ ...selectedPedido, detalles: nuevosDetalles, total: nuevoTotal });
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar pedidos" />;

  return (
    <div className="max-w-[100vw] overflow-x-hidden px-0 md:px-6 space-y-4 pb-24">
      <div className="flex items-center justify-between mt-4">
        <h1 className="text-xl md:text-2xl font-bold">Pedidos</h1>
        <Button onClick={() => navigate('/pedidos/nuevo')} size="sm" className="rounded-full shadow-lg">
          <Plus className="mr-1 h-4 w-4" /> Nuevo
        </Button>
      </div>

{/* FILTROS ACTUALIZADOS */}
<div className="grid grid-cols-1 px-2 md:grid-cols-4 gap-3"> {/* Cambiado a grid-cols-4 en md */}
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input 
      className="pl-9 h-12 bg-white border-slate-200" 
      placeholder="Buscar..." 
      value={search} 
      onChange={e => setSearch(e.target.value)} 
    />
  </div>
  
  <div className="grid grid-cols-2 gap-2 md:contents">
    <Select value={filterEstado} onValueChange={setFilterEstado}>
      <SelectTrigger className="h-12 bg-white"><SelectValue placeholder="Estado" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Todos">Todos los Estados</SelectItem>
        <SelectItem value="Reservado">Reservados</SelectItem>
        <SelectItem value="Preparado">Preparados</SelectItem>
        <SelectItem value="Pagado">Pagados</SelectItem>
      </SelectContent>
    </Select>

    {/* NUEVO FILTRO VENDEDOR */}
    <Select value={filterVendedor} onValueChange={setFilterVendedor}>
      <SelectTrigger className="h-12 bg-white"><SelectValue placeholder="Vendedor" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="Todos">Todos los Vendedores</SelectItem>
        {Array.from(new Set(data?.map(p => JSON.stringify(p.vendedor)).filter(Boolean))).map(vStr => {
          const v = JSON.parse(vStr as string);
          return <SelectItem key={v.id} value={v.id.toString()}>{v.nombre}</SelectItem>
        })}
      </SelectContent>
    </Select>
          <Select value={filterCorte} onValueChange={setFilterCorte}>
            <SelectTrigger className="h-12 bg-white">
              <SelectValue placeholder="Producto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Cortes</SelectItem>
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
              <TableHead className="w-8 px-2 hidden lg:table-cell"></TableHead>
              <TableHead className="w-8 px-2"></TableHead>
              <TableHead className="w-12 px-1">N°</TableHead>
              <TableHead className="px-2">Cliente</TableHead>
              <TableHead className="text-right px-2">Total</TableHead>
              <TableHead className="w-10 px-2"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPedidos.map((pedido) => (
              <React.Fragment key={pedido.id}>
                <TableRow className="border-b last:border-0" onClick={() => setExpandedId(expandedId === pedido.id ? null : pedido.id)}>
                  <TableCell className="px-2 hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
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
                    <Badge className={`text-[9px] px-1 py-0 h-4 mt-0.5 border-none ${getStatusColor(pedido.estado)}`}>{pedido.estado}</Badge>
                  </TableCell>
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
                        <DropdownMenuItem onClick={() => cobrarPedido(pedido)} className="text-green-600">
                          <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                        </DropdownMenuItem>
                        {pedido.estado !== 'Pagado' && (
                          <DropdownMenuItem onClick={() => mutation.mutate({ id: pedido.id, data: { ...pedido, estado: 'Pagado' }})} className="text-blue-600">
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar Pagado
                          </DropdownMenuItem>
                        )}
                        {/* SECCIÓN DE ANULACIÓN */}
                        <DropdownMenuItem 
                          onClick={() => {
                            if (confirm(`¿Estás seguro de anular el pedido #00${pedido.id}? El stock será devuelto.`)) {
                              anularMutation.mutate(pedido.id);
                            }
                          }} 
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Anular Pedido
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>

                {expandedId === pedido.id && (
                  <TableRow className="bg-slate-50/80">
                    <TableCell colSpan={5} className="p-2">
                      <div className="grid grid-cols-1 gap-1.5 w-full">
                        {pedido.detalles.map((det, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-white rounded-lg border border-slate-200 shadow-xs mx-1">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-700">{det.producto.nombre}</span>
                              <span className="text-[10px] text-slate-400 font-medium">{det.cantidad_unidades} un.</span>
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
    <div className="hidden lg:flex fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl items-center gap-6 animate-in slide-in-from-bottom-4">
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
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedPedido?.detalles.map((det, idx) => (
              <div key={idx} className="p-4 border rounded-xl bg-white shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-slate-900">{det.producto.nombre}</h3>
                  <Badge variant="outline" className="text-[10px]">{formatCurrency(det.producto.precio_por_kilo)}/kg</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Unidades</label>
                    <Input 
                      type="number" 
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
              </div>
            ))}
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
    </div>
  );
}