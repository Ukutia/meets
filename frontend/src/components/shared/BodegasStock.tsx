import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { crearBodega, crearTraspaso, getBodegas, getTraspasos, guardarStockBodega } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import type { StockItem } from '@/types';

export const useBodegas = () => useQuery({ queryKey: ['bodegas'], queryFn: async () => (await getBodegas()).data });

const PRINCIPAL = 'principal';
const aId = (v: string) => (v === PRINCIPAL ? null : Number(v));

export function BodegasStock({ productos }: { productos: StockItem[] }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [producto, setProducto] = useState('');
  const [origen, setOrigen] = useState(PRINCIPAL);
  const [destino, setDestino] = useState('');
  const [unidades, setUnidades] = useState('');
  const [kilos, setKilos] = useState('');
  const [nota, setNota] = useState('');
  // Ajuste: fijar lo que de verdad hay en una bodega (la diferencia sale o vuelve a la principal).
  const [ajusteBodega, setAjusteBodega] = useState('');
  const [ajusteUnidades, setAjusteUnidades] = useState('');
  const [ajusteKilos, setAjusteKilos] = useState('');
  const [ajusteNota, setAjusteNota] = useState('');
  const { data: bodegas = [], error } = useBodegas();
  const { data: historial = [] } = useQuery({ queryKey: ['traspasos'], queryFn: async () => (await getTraspasos()).data, enabled: open });
  const client = useQueryClient();
  const { toast } = useToast();
  const item = productos.find((p) => p.id === Number(producto));

  // Lo que hay en cada ubicación para el producto elegido.
  const disponibleEn = (v: string) => {
    if (!item) return { unidades: 0, kilos: 0 };
    if (v === PRINCIPAL) return { unidades: Math.max(item.disponibles, 0), kilos: Math.max(Number(item.kilos_actuales), 0) };
    const e = item.bodegas?.find((b) => b.bodega === Number(v));
    return { unidades: e?.unidades ?? 0, kilos: Number(e?.kilos ?? 0) };
  };
  const hay = disponibleEn(origen);
  const enAjuste = ajusteBodega ? disponibleEn(ajusteBodega) : null;
  const principal = disponibleEn(PRINCIPAL);
  const opciones = [{ value: PRINCIPAL, label: 'Bodega principal' }, ...bodegas.map((b) => ({ value: String(b.id), label: b.nombre }))];

  const refrescar = () => {
    client.invalidateQueries({ queryKey: ['stock'] });
    client.invalidateQueries({ queryKey: ['traspasos'] });
  };
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
    mutationFn: () => crearTraspaso({
      producto: Number(producto), origen: aId(origen), destino: aId(destino),
      unidades: Number(unidades || 0), kilos: Number(kilos || 0), nota: nota.trim(),
    }),
    onSuccess: () => { refrescar(); toast({ title: 'Movimiento registrado' }); setUnidades(''); setKilos(''); setNota(''); },
    onError: fallo,
  });
  const ajustar = useMutation({
    mutationFn: () => guardarStockBodega(Number(ajusteBodega), {
      producto: Number(producto), unidades: Number(ajusteUnidades || 0), kilos: Number(ajusteKilos || 0), nota: ajusteNota.trim(),
    }),
    onSuccess: () => { refrescar(); toast({ title: 'Existencia ajustada' }); setAjusteUnidades(''); setAjusteKilos(''); setAjusteNota(''); },
    onError: fallo,
  });
  const invalido = !producto || !destino || origen === destino || (!Number(unidades) && !Number(kilos))
    || Number(unidades || 0) > hay.unidades || Number(kilos || 0) > hay.kilos;
  const ajusteInvalido = !producto || !ajusteBodega || ajusteUnidades === '' || !ajusteNota.trim()
    || (enAjuste !== null && Number(ajusteUnidades) - enAjuste.unidades > principal.unidades);

  const selector = (label: string, value: string, set: (v: string) => void, excluir?: string, soloBodegas = false) => (
    <div className="space-y-2"><Label>{label}</Label>
      <Select value={value} onValueChange={set}><SelectTrigger aria-label={label}><SelectValue placeholder="Seleccionar" /></SelectTrigger>
        <SelectContent>{opciones.filter((o) => o.value !== excluir && !(soloBodegas && o.value === PRINCIPAL)).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
  );

  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Warehouse className="mr-2 h-4 w-4" /> Bodegas</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Movimientos de bodega</DialogTitle><DialogDescription>El stock siempre sale de una bodega y entra a otra. Todo queda registrado con usuario y nota.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las bodegas.</p>}
        <form className="space-y-2 border-b pb-4" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <Label htmlFor="bodega-nombre">Agregar bodega</Label>
          <div className="flex gap-2"><Input id="bodega-nombre" placeholder="Ej: Bodega norte" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /><Button disabled={!nombre.trim() || crear.isPending}>Agregar</Button></div>
        </form>
        <div className="space-y-2"><Label>Producto</Label><Select value={producto} onValueChange={setProducto}><SelectTrigger aria-label="Producto en bodega"><SelectValue placeholder="Seleccionar producto" /></SelectTrigger><SelectContent>{productos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.producto}</SelectItem>)}</SelectContent></Select></div>
        {item && <p className="text-xs text-muted-foreground">
          {opciones.map((o) => `${o.label}: ${disponibleEn(o.value).unidades} un`).join(' · ')}
        </p>}
        <Tabs defaultValue="mover">
          <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="mover">Traspasar</TabsTrigger><TabsTrigger value="ajustar">Ajustar existencia</TabsTrigger></TabsList>
          <TabsContent value="mover">
            <form className="space-y-4 pt-2" onSubmit={(e) => { e.preventDefault(); mover.mutate(); }}>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                {selector('Desde', origen, setOrigen, destino)}
                <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground" />
                {selector('Hacia', destino, setDestino, origen)}
              </div>
              {producto && <p className="text-xs text-muted-foreground">En el origen hay {hay.unidades} un / {hay.kilos} kg.</p>}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label htmlFor="bodega-unidades">Unidades</Label><Input id="bodega-unidades" type="number" min={0} max={hay.unidades} step={1} value={unidades} onChange={(e) => setUnidades(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="bodega-kilos">Kilos</Label><Input id="bodega-kilos" type="number" min={0} max={hay.kilos} step="0.01" value={kilos} onChange={(e) => setKilos(e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="bodega-nota">Nota (opcional)</Label><Input id="bodega-nota" maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
              <Button className="w-full" disabled={invalido || mover.isPending}>Mover stock</Button>
            </form>
          </TabsContent>
          <TabsContent value="ajustar">
            <form className="space-y-4 pt-2" onSubmit={(e) => { e.preventDefault(); ajustar.mutate(); }}>
              <p className="text-xs text-muted-foreground">Fija lo que de verdad hay en una bodega. La diferencia sale de la bodega principal o vuelve a ella; el inventario total no cambia.</p>
              {selector('Bodega', ajusteBodega, setAjusteBodega, undefined, true)}
              {enAjuste && <p className="text-xs text-muted-foreground">Hoy figura con {enAjuste.unidades} un / {enAjuste.kilos} kg. La principal tiene {principal.unidades} un / {principal.kilos} kg.</p>}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label htmlFor="ajuste-unidades">Unidades reales</Label><Input id="ajuste-unidades" type="number" min={0} step={1} value={ajusteUnidades} onChange={(e) => setAjusteUnidades(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="ajuste-kilos">Kilos reales</Label><Input id="ajuste-kilos" type="number" min={0} step="0.01" value={ajusteKilos} onChange={(e) => setAjusteKilos(e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="ajuste-nota">Motivo</Label><Input id="ajuste-nota" maxLength={180} placeholder="Ej: conteo físico" value={ajusteNota} onChange={(e) => setAjusteNota(e.target.value)} /></div>
              {enAjuste && Number(ajusteUnidades) - enAjuste.unidades > principal.unidades && <p role="alert" className="text-xs text-destructive">La principal no tiene tantas unidades. Si faltan en el inventario, registra primero un ajuste de inventario.</p>}
              <Button className="w-full" disabled={ajusteInvalido || ajustar.isPending}>Guardar ajuste</Button>
            </form>
          </TabsContent>
        </Tabs>
        {historial.length > 0 && <div className="space-y-1 border-t pt-3">
          <Label>Registro de movimientos</Label>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs text-muted-foreground">
            {historial.slice(0, 60).map((m) => <li key={m.id}>
              {new Date(m.fecha).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · <span className="text-foreground">{m.producto_nombre}</span> {m.unidades} un{Number(m.kilos) ? ` / ${m.kilos} kg` : ''}: {m.origen_nombre} → {m.destino_nombre}
              {(m.nota || m.usuario) && <span className="block pl-2">{[m.nota, m.usuario].filter(Boolean).join(' · ')}</span>}
            </li>)}
          </ul>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
