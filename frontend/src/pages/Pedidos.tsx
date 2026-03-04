import { useMemo, useState } from 'react';
import { Plus, Search, MessageCircle, CheckCircle2, Save, Trash2, FileText, User } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';

// Librerías para PDF
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Pedidos() {
  const [search, setSearch] = useState('');
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  
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

  const anularMutation = useMutation({
    mutationFn: (id: number) => cancelarPedido(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: "Anulado", description: "El pedido fue anulado y el stock devuelto." });
      setSelectedPedido(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.response?.data?.error || "No se pudo anular", 
        variant: "destructive" 
      });
    }
  });

  const formatCurrency = (val: any) => 
    Number(val).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });

  const cobrarPedido = (pedido: Pedido) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`DETALLE DE PEDIDO #00${pedido.id}`, 14, 20);
    doc.setFontSize(11);
    doc.text(`Cliente: ${pedido.cliente.nombre}`, 14, 30);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, 14, 36);

    autoTable(doc, {
      startY: 45,
      head: [['Producto', 'Kilos', 'Unidades', 'Precio', 'Subtotal']],
      body: pedido.detalles.map(d => [
        d.producto.nombre,
        `${d.cantidad_kilos} kg`,
        d.cantidad_unidades || '-',
        formatCurrency(d.producto.precio_por_kilo),
        formatCurrency(d.total_venta)
      ]),
      foot: [[{ content: `TOTAL: ${formatCurrency(pedido.total)}`, colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } }]],
      headStyles: { fillColor: [71, 85, 105] },
    });

    doc.save(`Pedido_${pedido.id}.pdf`);

    const saludo = `*Hola ${pedido.cliente.nombre}, adjunto el detalle de tu pedido #00${pedido.id}:*\n\n`;
    const items = pedido.detalles.map(d => 
      `• ${d.producto.nombre}: ${d.cantidad_kilos}kg x ${formatCurrency(d.producto.precio_por_kilo)} = *${formatCurrency(d.total_venta)}*`
    ).join('\n');
    const totalMsg = `\n\n*TOTAL A PAGAR: ${formatCurrency(pedido.total)}*`;
    const url = `https://wa.me/${pedido.cliente.telefono}?text=${encodeURIComponent(saludo + items + totalMsg + "\n\n(Adjunto comprobante PDF descargado)")}`;
    window.open(url, '_blank');
  };

  // 1. Helper para los colores de los estados
  const getStatusColor = (estado: string) => {
    switch (estado) {
      case 'Preparado':
        return 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100'; // Naranja/Dorado suave
      case 'Pagado':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100'; // Verde
      case 'Reservado':
        return 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100'; // Azul
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  // 2. Helper para el color de fondo de la fila en móvil
  const getRowBgColor = (estado: string) => {
    switch (estado) {
      case 'Preparado': return 'bg-amber-50/50';
      case 'Pagado': return 'bg-emerald-50/50';
      case 'Reservado': return 'bg-blue-50/50';
      default: return '';
    }
  };

const handleSave = () => {
    if (!selectedPedido) return;

    // 1. Validar Pesos Mínimos
    for (const det of selectedPedido.detalles) {
      const unidades = Number(det.cantidad_unidades);
      const kilos = Number(det.cantidad_kilos);
      const minPeso = Number(det.producto.peso_minimo) || 0;

      if (unidades > 0 && kilos > 0) {
        const pesoPromedio = kilos / unidades;
        if (pesoPromedio < minPeso) {
          toast({
            title: "Error de Pesaje",
            description: `El producto ${det.producto.nombre} tiene un peso promedio menor al mínimo.`,
            variant: "destructive"
          });
          return;
        }
      }
    }

    // --- NUEVA LÓGICA DE ESTADO 'PREPARADO' ---
    // 2. Verificar si todos los productos tienen kilos ingresados
    const todosTienenKilos = selectedPedido.detalles.every(det => Number(det.cantidad_kilos) > 0);
    
    // Creamos una copia del pedido para enviarlo
    let pedidoParaEnviar = { ...selectedPedido };

    // Si el estado actual es 'Pendiente' y ya se pesó todo, lo pasamos a 'Preparado'
    if (todosTienenKilos && selectedPedido.estado === 'Reservado') {
      pedidoParaEnviar.estado = 'Preparado';
    } 
    // Opcional: Si borras un kilo y vuelve a faltar peso, podrías devolverlo a Pendiente
    else if (!todosTienenKilos && selectedPedido.estado === 'Preparado') {
      pedidoParaEnviar.estado = 'Reservado';
    }

    // 3. Ejecutar la mutación con el objeto actualizado
    mutation.mutate({ id: pedidoParaEnviar.id, data: pedidoParaEnviar });
  };

  // --- Lógica visual para que el usuario vea el cambio antes de guardar (Opcional pero recomendado) ---
  const todosPesados = useMemo(() => {
    return selectedPedido?.detalles.every(det => Number(det.cantidad_kilos) > 0);
  }, [selectedPedido?.detalles]);

  const handleEditLocal = (index: number, field: 'cantidad_kilos' | 'cantidad_unidades', value: string) => {
    if (!selectedPedido || selectedPedido.estado === 'Pagado') return;
    const valAsNum = value === '' ? 0 : (field === 'cantidad_kilos' ? parseFloat(value) : parseInt(value, 10));
    const nuevosDetalles = selectedPedido.detalles.map((det, i) => {
      if (i !== index) return det;
      const precioUnitario = Number(det.producto.precio_por_kilo) || 0;
      if (field === 'cantidad_kilos') {
        return { ...det, cantidad_kilos: valAsNum, total_venta: valAsNum * precioUnitario };
      }
      return { ...det, [field]: valAsNum };
    });
    const nuevoTotalGlobal = nuevosDetalles.reduce((sum, d) => sum + (Number(d.total_venta) || 0), 0);
    setSelectedPedido({ ...selectedPedido, detalles: nuevosDetalles, total: nuevoTotalGlobal });
  };

  const mutation = useMutation({
    mutationFn: (payload: { id: number, data: any }) => updatePedido(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: "Guardado", description: "Los cambios se guardaron correctamente." });
      setSelectedPedido(null);
    },
  });

  const filteredPedidos = useMemo(() => 
    (data ?? []).filter(p => p.cliente.nombre.toLowerCase().includes(search.toLowerCase()) || p.id.toString().includes(search)),
  [data, search]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar pedidos" />;

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tighter">Gestión de Pedidos</h1>
        <Button onClick={() => navigate('/pedidos/nuevo')} size="sm"><Plus className="mr-2 h-4 w-4" /> Nuevo Pedido</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-10 h-11" placeholder="Buscar por cliente o N°..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* TABLA RESPONSIVA */}
      <div className="rounded-xl border shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="w-20">N°</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="hidden sm:table-cell">Estado</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPedidos.map((pedido) => (
                <TableRow 
                  key={pedido.id} 
                  // APLICAMOS COLOR A LA FILA EN MÓVIL (md:bg-transparent limpia el color en desktop)
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${getRowBgColor(pedido.estado)} md:bg-transparent`}
                  onClick={() => setSelectedPedido(pedido)}
                >
                  <TableCell className="font-mono font-bold text-blue-600 text-xs md:text-sm">#{pedido.id}</TableCell>
                  <TableCell className="font-medium max-w-[120px] truncate md:max-w-none">
                    {pedido.cliente.nombre}
                    {/* Badge pequeño visible solo en móvil debajo del nombre */}
                    <div className="sm:hidden mt-1">
                      <Badge className={`text-[10px] px-1 py-0 h-4 uppercase ${getStatusColor(pedido.estado)}`}>
                        {pedido.estado}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge className={`font-semibold uppercase ${getStatusColor(pedido.estado)}`} variant="outline">
                      {pedido.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-bold text-xs md:text-sm">{formatCurrency(pedido.total)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 md:gap-2">
                      {pedido.estado !== 'Pagado' && (
                        <Button variant="outline" size="sm" className="h-8 px-2 text-blue-600 border-blue-200" onClick={() => mutation.mutate({ id: pedido.id, data: { ...pedido, estado: 'Pagado' }})}>
                          <CheckCircle2 className="h-4 w-4 md:mr-1" /> <span className="hidden md:inline">Pagado</span>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-8 px-2 text-green-600 border-green-200" onClick={() => cobrarPedido(pedido)}>
                        <MessageCircle className="h-4 w-4 md:mr-1" /> <span className="hidden md:inline">Cobrar</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {/* DIÁLOGO ADAPTADO A MÓVIL */}
      <Dialog open={!!selectedPedido} onOpenChange={() => setSelectedPedido(null)}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[95vh] overflow-y-auto p-4 md:p-6 border-t-8 border-primary">
          <DialogHeader>
            <div className="flex justify-between items-start">
              <div className="max-w-[70%]">
                <DialogTitle className="text-xl md:text-2xl font-black">Pedido #{selectedPedido?.id}</DialogTitle>
                <p className="text-sm text-muted-foreground truncate">{selectedPedido?.cliente.nombre}</p>
              </div>
              {/* Badge de estado dinámico también en el detalle */}
              <div className="flex flex-col items-end gap-1">
                <Badge className={`text-xs md:text-lg font-bold uppercase ${selectedPedido ? getStatusColor(selectedPedido.estado) : ''}`}>
                  {selectedPedido?.estado}
                </Badge>
                {todosPesados && selectedPedido?.estado === 'Reservado' && (
                  <span className="text-[10px] font-bold text-amber-600 animate-pulse">
                    Listo para marcar como PREPARADO
                  </span>
                )}
              </div>
            </div>
          </DialogHeader>

          {selectedPedido && (
            <div className="space-y-4 md:space-y-6">
              <div className="rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-100">
                      <TableRow className="text-[10px] md:text-xs">
                        <TableHead>Producto</TableHead>
                        <TableHead className="w-20 md:w-28 text-center">Kilos</TableHead>
                        <TableHead className="w-20 md:w-28 text-center">Unid.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedPedido.detalles.map((det, idx) => {
                        const esPesoInvalido = det.cantidad_unidades > 0 && 
                        det.cantidad_kilos > 0 && 
                        (det.cantidad_kilos / det.cantidad_unidades) < det.producto.peso_minimo;

                        return (
                          <TableRow key={idx} className="text-xs md:text-sm">
                            <TableCell className="font-medium p-2">
                              {det.producto.nombre}
                              {esPesoInvalido && <span className="block text-[8px] text-red-600 font-bold animate-pulse">PESO BAJO</span>}
                            </TableCell>
                            <TableCell className="p-1">
                              <Input type="number" className="h-8 text-center px-1" value={det.cantidad_kilos || ''} onChange={(e) => handleEditLocal(idx, 'cantidad_kilos', e.target.value)} />
                            </TableCell>
                            <TableCell className="p-1">
                              <Input type="number" className="h-8 text-center px-1" value={det.cantidad_unidades || ''} onChange={(e) => handleEditLocal(idx, 'cantidad_unidades', e.target.value)} />
                            </TableCell>
                            <TableCell className="text-right font-bold p-2">{formatCurrency(det.total_venta)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* FOOTER INTERNO DEL DIÁLOGO */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {selectedPedido.estado !== 'Pagado' && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => anularMutation.mutate(selectedPedido.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="text-right border-t pt-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Pedido</p>
                  <p className="text-3xl md:text-5xl font-black text-slate-800 tracking-tighter">{formatCurrency(selectedPedido.total)}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-row gap-2 pt-4">
            <Button variant="ghost" className="flex-1" onClick={() => setSelectedPedido(null)}>Cerrar</Button>
            {selectedPedido?.estado !== 'Pagado' && (
              <Button 
                className={`flex-1 px-2 md:px-8 ${todosPesados && selectedPedido?.estado === 'Reservado' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}`} 
                disabled={mutation.isPending} 
                onClick={handleSave}
              >
                {mutation.isPending ? <LoadingSpinner /> : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> 
                    {todosPesados && selectedPedido?.estado === 'Reservado' ? 'Confirmar Preparación' : 'Guardar Cambios'}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}