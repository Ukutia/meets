import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { crearBodega, getBodegas, guardarStockBodega } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import type { StockItem } from '@/types';

export const useBodegas = () => useQuery({ queryKey: ['bodegas'], queryFn: async () => (await getBodegas()).data });

export function BodegasStock({ productos }: { productos: StockItem[] }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [bodega, setBodega] = useState('');
  const [producto, setProducto] = useState('');
  const [unidades, setUnidades] = useState('');
  const [kilos, setKilos] = useState('');
  const { data: bodegas = [], error } = useBodegas();
  const client = useQueryClient();
  const { toast } = useToast();
  const fallo = () => toast({ title: 'No se pudo guardar', description: 'Revisa los datos e intenta nuevamente.', variant: 'destructive' });
  const crear = useMutation({
    mutationFn: () => crearBodega(nombre.trim()),
    onSuccess: (r) => { client.invalidateQueries({ queryKey: ['bodegas'] }); setBodega(String(r.data.id)); setNombre(''); setProducto(''); setUnidades(''); setKilos(''); },
    onError: fallo,
  });
  const guardar = useMutation({
    mutationFn: () => guardarStockBodega(Number(bodega), { producto: Number(producto), unidades: Number(unidades), kilos: Number(kilos) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['stock'] }); toast({ title: 'Stock de bodega actualizado' }); setOpen(false); },
    onError: fallo,
  });
  const cargar = (b: string, p: string) => {
    const actual = productos.find((item) => item.id === Number(p))?.bodegas?.find((item) => item.bodega === Number(b));
    setUnidades(String(actual?.unidades ?? 0)); setKilos(String(actual?.kilos ?? 0));
  };
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}><Warehouse className="mr-2 h-4 w-4" /> Bodegas</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Stock por bodega</DialogTitle><DialogDescription>Registra existencias separadas del inventario de ventas. Las cantidades se actualizan manualmente.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las bodegas.</p>}
        <form className="space-y-2 border-b pb-4" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <Label htmlFor="bodega-nombre">Agregar bodega</Label>
          <div className="flex gap-2"><Input id="bodega-nombre" placeholder="Ej: Bodega norte" maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /><Button disabled={!nombre.trim() || crear.isPending}>Agregar</Button></div>
        </form>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
          <div className="space-y-2"><Label>Bodega</Label><Select value={bodega} onValueChange={(v) => { setBodega(v); cargar(v, producto); }}><SelectTrigger aria-label="Bodega"><SelectValue placeholder="Seleccionar bodega" /></SelectTrigger><SelectContent>{bodegas.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.nombre}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Producto</Label><Select value={producto} onValueChange={(v) => { setProducto(v); cargar(bodega, v); }}><SelectTrigger aria-label="Producto en bodega"><SelectValue placeholder="Seleccionar producto" /></SelectTrigger><SelectContent>{productos.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.producto}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="bodega-unidades">Unidades</Label><Input id="bodega-unidades" type="number" required min={0} step={1} value={unidades} onChange={(e) => setUnidades(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="bodega-kilos">Kilos</Label><Input id="bodega-kilos" type="number" required min={0} step="0.01" value={kilos} onChange={(e) => setKilos(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Guardar reemplaza el stock registrado para este producto en esta bodega.</p>
          <Button className="w-full" disabled={!bodega || !producto || guardar.isPending}>Guardar stock</Button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
