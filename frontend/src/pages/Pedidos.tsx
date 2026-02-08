import { useMemo, useState } from 'react';
import { Plus, Search, MessageCircle, CheckCircle2, Save, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPedidos, updatePedido, cancelarPedido} from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Pedido } from '@/types';
import { useToast } from '@/hooks/use-toast';

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


  // Dentro del componente Pedidos
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

  // Modifica el botón de anular en el JSX:


  const formatCurrency = (val: any) => 
    Number(val).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 });

  // --- LÓGICA PDF + WHATSAPP ---
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

  // ... dentro del componente Pedidos ...

const handleSave = () => {
  if (!selectedPedido) return;

  // 1. Validar Pesos Mínimos antes de enviar al servidor
  for (const det of selectedPedido.detalles) {
    const unidades = Number(det.cantidad_unidades);
    const kilos = Number(det.cantidad_kilos);
    const minPeso = Number(det.producto.peso_minimo) || 0;

    // Solo validamos si hay unidades y kilos ingresados
    if (unidades > 0 && kilos > 0) {
      const pesoPromedio = kilos / unidades;
      
      if (pesoPromedio < minPeso) {
        toast({
          title: "Error de Pesaje",
          description: `El producto ${det.producto.nombre} tiene un peso promedio (${pesoPromedio.toFixed(3)}kg) menor al mínimo configurado (${minPeso}kg). Revise los kilos.`,
          variant: "destructive"
        });
        return; // Detiene la ejecución
      }
    }
  }

  // 2. Si todo está bien, ejecutar la mutación
  mutation.mutate({ id: selectedPedido.id, data: selectedPedido });
};

  const handleEditLocal = (index: number, field: 'cantidad_kilos' | 'cantidad_unidades', value: string) => {
    if (!selectedPedido || selectedPedido.estado === 'Pagado') return;

    const valAsNum = value === '' ? 0 : (field === 'cantidad_kilos' ? parseFloat(value) : parseInt(value, 10));

    // Clonar profundamente para forzar re-render
    const nuevosDetalles = selectedPedido.detalles.map((det, i) => {
      if (i !== index) return det;

      const precioUnitario = Number(det.producto.precio_por_kilo) || 0;
      
      // Si actualizamos kilos, recalculamos el subtotal de la línea
      if (field === 'cantidad_kilos') {
        return {
          ...det,
          cantidad_kilos: valAsNum,
          total_venta: valAsNum * precioUnitario
        };
      }

      return { ...det, [field]: valAsNum };
    });

    // Recalcular el total general del pedido
    const nuevoTotalGlobal = nuevosDetalles.reduce((sum, d) => sum + (Number(d.total_venta) || 0), 0);

    setSelectedPedido({
      ...selectedPedido,
      detalles: nuevosDetalles,
      total: nuevoTotalGlobal
    });
  };

  const mutation = useMutation({
    mutationFn: (payload: { id: number, data: any }) => updatePedido(payload.id, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: "Guardado", description: "Los cambios se guardaron correctamente." });
      setSelectedPedido(null);
    },
    onError: (error: any) => {
      console.error(error);
      toast({ 
        title: "Error de Servidor", 
        description: "No se pudo actualizar el pedido. Revisa la consola.",
        variant: "destructive" 
      });
    }
  });

  const filteredPedidos = useMemo(() => 
    (data ?? []).filter(p => p.cliente.nombre.toLowerCase().includes(search.toLowerCase()) || p.id.toString().includes(search)),
  [data, search]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar pedidos" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tighter">Gestión de Pedidos</h1>
        <Button onClick={() => navigate('/pedidos/nuevo')}><Plus className="mr-2 h-4 w-4" /> Nuevo Pedido</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-10" placeholder="Buscar por cliente o N°..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border shadow-sm overflow-hidden bg-white">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-20">N°</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPedidos.map((pedido) => (
              <TableRow 
                key={pedido.id} 
                className="cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setSelectedPedido(pedido)}
              >
                <TableCell className="font-mono font-bold text-blue-600">#{pedido.id}</TableCell>
                <TableCell className="font-medium">{pedido.cliente.nombre}</TableCell>
                <TableCell><Badge variant={pedido.estado === 'Pagado' ? 'outline' : 'default'}>{pedido.estado}</Badge></TableCell>
                <TableCell className="font-bold">{formatCurrency(pedido.total)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    {pedido.estado !== 'Pagado' && (
                      <Button variant="outline" size="sm" className="text-blue-600 border-blue-200" onClick={() => mutation.mutate({ id: pedido.id, data: { ...pedido, estado: 'Pagado' }})}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Pagado
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="text-green-600 border-green-200" onClick={() => cobrarPedido(pedido)}>
                      <MessageCircle className="h-4 w-4 mr-1" /> Cobrar
                    </Button>
                    
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selectedPedido} onOpenChange={() => setSelectedPedido(null)}>
        <DialogContent className="max-w-4xl border-t-8 border-primary">
          <DialogHeader>
            <div className="flex justify-between items-start">
              <div>
                <DialogTitle className="text-2xl font-black">Pedido #{selectedPedido?.id}</DialogTitle>
                <p className="text-sm text-muted-foreground">{selectedPedido?.cliente.nombre}</p>
              </div>
              <Badge className="text-lg px-4 py-1">{selectedPedido?.estado}</Badge>
            </div>
          </DialogHeader>

          {selectedPedido && (
            <div className="space-y-6">
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-100">
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-28">Kilos</TableHead>
                      <TableHead className="w-28">Unidades</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedPedido.detalles.map((det, idx) => {
                      const esPesoInvalido = det.cantidad_unidades > 0 && 
                      det.cantidad_kilos > 0 && 
                      (det.cantidad_kilos / det.cantidad_unidades) < det.producto.peso_minimo;

                      return (
                      
                      <TableRow key={`${selectedPedido.id}-det-${idx}`}>
                        <TableCell className="font-medium">
                          {det.producto.nombre}
                          {esPesoInvalido && (
                            <p className="text-[10px] font-bold text-red-600 animate-pulse">
                              PESO BAJO EL MÍNIMO ({det.producto.peso_minimo}kg)
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            className="h-8" 
                            readOnly={selectedPedido.estado === 'Pagado'}
                            value={det.cantidad_kilos === 0 ? '' : det.cantidad_kilos} 
                            onChange={(e) => handleEditLocal(idx, 'cantidad_kilos', e.target.value)}
                            onFocus={(e) => e.target.select()} 
                            step="any"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            className="h-8" 
                            readOnly={selectedPedido.estado === 'Pagado'}
                            value={det.cantidad_unidades === 0 ? '' : det.cantidad_unidades} 
                            onChange={(e) => handleEditLocal(idx, 'cantidad_unidades', e.target.value)}
                            onFocus={(e) => e.target.select()}
                          />
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatCurrency(Number(det.cantidad_kilos) * Number(det.producto.precio_por_kilo))}
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between items-center p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => cobrarPedido(selectedPedido)}>
                    <FileText className="h-4 w-4 mr-2" /> PDF + WhatsApp
                  </Button>
                  {selectedPedido.estado !== 'Pagado' && (
                    <Button 
                      variant="ghost" 
                      className="text-destructive hover:bg-destructive/10" 
                      onClick={() => {
                        if(confirm('¿Está seguro de anular este pedido? El stock volverá a inventario.')) {
                          anularMutation.mutate(selectedPedido.id);
                        }
                      }}
                      disabled={anularMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> 
                      {anularMutation.isPending ? 'Anulando...' : 'Anular Pedido'}
                    </Button>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-500 uppercase">Total Pedido</p>
                  <p className="text-5xl font-black text-slate-900 tracking-tighter">{formatCurrency(selectedPedido.total)}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSelectedPedido(null)}>Cerrar</Button>
            {selectedPedido?.estado !== 'Pagado' && (
              <Button 
                className="px-8"
                disabled={mutation.isPending}
                onClick={handleSave} // <--- Llamamos a la validación local
              >
                {mutation.isPending ? (
                  <LoadingSpinner />
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Guardar Cambios Realizados
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