import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { crearBodega, crearTraspaso, getBodegas, getTraspasos } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import type { StockItem } from '@/types';

export const useBodegas = () => useQuery({ queryKey: ['bodegas'], queryFn: async () => (await getBodegas()).data });

const SIN_ASIGNAR = 'sin';
const aId = (v: string) => (v === SIN_ASIGNAR ? null : Number(v));

export function BodegasStock({ productos }: { productos: StockItem[] }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [producto, setProducto] = useState('');
  const [origen, setOrigen] = useState(SIN_ASIGNAR);
  const [destino, setDestino] = useState('');
  const [unidades, setUnidades] = useState('');
  const [kilos, setKilos] = useState('');
  const { data: bodegas = [], error } = useBodegas();
  const { data: historial = [] } = useQuery({ queryKey: ['traspasos'], queryFn: async () => (await getTraspasos()).data, enabled: open });
  const client = useQueryClient();
  const { toast } = useToast();
  const item = productos.find((p) => p.id === Number(producto));

  // Lo que hay en cada ubicación para el producto elegido (el origen no puede dar más que esto).
  const disponibleEn = (v: string) => {
    if (!item) return { unidades: 0, kilos: 0 };
    if (v === SIN_ASIGNAR) return { unidades: item.sin_asignar ?? 0, kilos: null as number | null };
    const e = item.bodegas?.find((b) => b.bodega === Number(v));
    return { unidades: e?.unidades ?? 0, kilos: Number(e?.kilos ?? 0) };
  };
  const hay = disponibleEn(origen);
  const opciones = [{ value: SIN_ASIGNAR, label: 'Sin asignar' }, ...bodegas.map((b) => ({ value: String(b.id), label: b.nombre }))];

  const fallo = (e: any) => {
    const d = e?.response?.data;
    const msg = d?.unidades?.[0] ?? d?.kilos?.[0] ?? d?.non_field_errors?.[0] ?? d?.nombre?.[0] ?? 'Revisa los datos e intenta nuevamente.';
    toast({ title: 'No se pudo guardar', description: String(msg), variant: 'destructive' });
  };
  const crear = useMutation({
    mutationFn: () => crearBodega(nombre.trim()),
    onSuccess: (r) => { client.invalidateQueries({ queryKey: ['bodegas'] }); setDestino(String(r.data.id)); setNombre(''); },
    onError: fallo,
  });
  const mover = useMutation({
    mutationFn: () => crearTraspaso({ producto: Number(producto), origen: aId(origen), destino: aId(destino), unidades: Number(unidades || 0), kilos: Number(kilos || 0) }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['stock'] }); client.invalidateQueries({ queryKey: ['traspasos'] });
      toast({ title: 'Movimiento registrado' }); setUnidades(''); setKilos('');
    },
    onError: fallo,
  });
  const invalido = !producto || !destino || origen === destino || (!Number(unidades) && !Number(kilos))
    || Number(unidades || 0) > hay.unidades || (hay.kilos !== null && Number(kilos || 0) > hay.kilos);

  const selector = (label: string, value: string, set: (v: string) => void, excluir?: string) => (
    <div className="space-y-2"><Label>{label}</Label>
      <Select value={value} onValueChange={set}><SelectTrigger aria-label={label}><SelectValue placeholder="Seleccionar" /></SelectTrigger>
        <SelectContent>{opciones.filter((o) => o.value !== excluir).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
  );

  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Warehouse className="mr-2 h-4 w-4" /> Bodegas</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Movimientos de bodega</DialogTitle><DialogDescription>El stock siempre sale de un lado y entra a otro. "Sin asignar" es el inventario que aún no está en ninguna bodega.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las bodegas.</p>}
        <form className="space-y-2 border-b pb-4" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <Label htmlFor="bodega-nombre">Agregar bodega</Label>
          <div className="flex gap-2"><Input id="bodega-nombre" placeholder="Ej: Bodega norte" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /><Button disabled={!nombre.trim() || crear.isPending}>Agregar</Button></div>
        </form>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mover.mutate(); }}>
          <div className="space-y-2"><Label>Producto</Label><Select value={producto} onValueChange={setProducto}><SelectTrigger aria-label="Producto en bodega"><SelectValue placeholder="Seleccionar producto" /></SelectTrigger><SelectContent>{productos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.producto}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            {selector('Desde', origen, setOrigen, destino)}
            <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
            {selector('Hacia', destino, setDestino, origen)}
          </div>
          {producto && <p className="text-xs text-muted-foreground">En el origen hay {hay.unidades} un{hay.kilos !== null ? ` / ${hay.kilos} kg` : ''}.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="bodega-unidades">Unidades</Label><Input id="bodega-unidades" type="number" min={0} max={hay.unidades} step={1} value={unidades} onChange={(e) => setUnidades(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="bodega-kilos">Kilos</Label><Input id="bodega-kilos" type="number" min={0} max={hay.kilos ?? undefined} step="0.01" value={kilos} onChange={(e) => setKilos(e.target.value)} /></div>
          </div>
          <Button className="w-full" disabled={invalido || mover.isPending}>Mover stock</Button>
        </form>
        {historial.length > 0 && <div className="space-y-1 border-t pt-3">
          <Label>Últimos movimientos</Label>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {historial.slice(0, 15).map((m) => <li key={m.id}>
              {new Date(m.fecha).toLocaleDateString('es-CL')} · <span className="text-foreground">{m.producto_nombre}</span> {m.unidades} un{Number(m.kilos) ? ` / ${m.kilos} kg` : ''}: {m.origen_nombre} → {m.destino_nombre}
            </li>)}
          </ul>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
