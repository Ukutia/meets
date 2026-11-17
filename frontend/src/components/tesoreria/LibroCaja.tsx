import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Landmark, MessageSquare, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { StatCard } from '@/components/shared/StatCard';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import {
  createComentarioCaja, createMovimientoCaja, deleteComentarioCaja, deleteMovimientoCaja, getLibroCaja, updateMovimientoCaja,
} from '@/services/api';
import { cn, decimalATexto, formatCLP, formatFecha, hoyISO, parseDecimal, type RangoFecha } from '@/lib/utils';

interface Comentario { id: number; texto: string; creado: string; usuario: string }

type Origen = 'pedido' | 'factura' | 'manual';

interface Linea {
  clave: string;
  fecha: string;
  descripcion: string;
  origen: Origen;
  entrada: number;
  salida: number;
  saldo: number;
  editable: boolean;
  ref: Record<string, number | string>;
  categoria?: string;
  comentario?: string;
  medio?: string;
  receptor?: string;
  automatico?: boolean;
  comentarios: Comentario[];
}

interface Libro {
  saldo_anterior: number;
  total_entradas: number;
  total_salidas: number;
  saldo_final: number;
  movimientos: Linea[];
  categorias: { value: string; label: string }[];
}

const ETIQUETA_ORIGEN: Record<Origen, string> = { pedido: 'Pedido', factura: 'Factura', manual: 'Manual' };
const VACIO = { fecha: hoyISO(), monto: '', descripcion: '', categoria: 'otro', comentario: '' };

export function LibroCaja({ rango }: { rango: RangoFecha }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [receptor, setReceptor] = useState<'todos' | 'empresa'>('todos');
  const [origen, setOrigen] = useState<'todos' | Origen>('todos');
  const [editando, setEditando] = useState<{ id?: number; tipo: 'entrada' | 'salida' } | null>(null);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState('');

  const q = useQuery({
    queryKey: ['libro-caja', rango.desde, rango.hasta, receptor],
    queryFn: async () => (await getLibroCaja({ desde: rango.desde, hasta: rango.hasta, receptor })).data as Libro,
  });
  const libro = q.data;
  const categorias = libro?.categorias ?? [];
  const nombreCategoria = (v?: string) => categorias.find((c) => c.value === v)?.label ?? v ?? '';
  const lineas = useMemo(
    () => (libro?.movimientos ?? []).filter((l) => origen === 'todos' || l.origen === origen),
    [libro, origen],
  );

  const abrir = (tipo: 'entrada' | 'salida', l?: Linea) => {
    setEditando({ id: l ? Number(l.ref.id) : undefined, tipo });
    setForm(l ? {
      fecha: l.fecha, monto: decimalATexto(l.entrada || l.salida), descripcion: l.descripcion,
      categoria: l.categoria ?? 'otro', comentario: l.comentario ?? '',
    } : { ...VACIO, fecha: hoyISO() });
  };

  const guardar = async () => {
    if (!editando) return;
    setGuardando(true);
    try {
      const datos = { ...form, monto: parseDecimal(form.monto), tipo: editando.tipo };
      if (editando.id) await updateMovimientoCaja(editando.id, datos);
      else await createMovimientoCaja(datos);
      queryClient.invalidateQueries({ queryKey: ['libro-caja'] });
      setEditando(null);
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({ title: 'Error', description: err.response?.data?.error || 'No se pudo guardar', variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['libro-caja'] });
  const errorToast = (e: unknown, defecto: string) => {
    const err = e as { response?: { data?: { error?: string } } };
    toast({ title: 'Error', description: err.response?.data?.error || defecto, variant: 'destructive' });
  };
  const comentar = async (clave: string) => {
    const texto = nuevo.trim();
    if (!texto) return;
    try {
      await createComentarioCaja(clave, texto);
      setNuevo('');
      refrescar();
    } catch (e) {
      errorToast(e, 'No se pudo guardar el comentario');
    }
  };
  const quitarComentario = async (id: number) => {
    try {
      await deleteComentarioCaja(id);
      refrescar();
    } catch (e) {
      errorToast(e, 'No se pudo eliminar el comentario');
    }
  };

  if (q.isLoading) return <LoadingSpinner />;
  if (!libro) return <p className="p-6 text-center text-sm text-muted-foreground">No se pudo cargar el libro de caja.</p>;

  const monto = parseDecimal(form.monto);

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Saldo anterior" value={formatCLP(libro.saldo_anterior)} icon={Landmark} description="Antes del período" />
        <StatCard title="Entradas" value={formatCLP(libro.total_entradas)} icon={ArrowDownCircle} accent="text-green-600" />
        <StatCard title="Salidas" value={formatCLP(libro.total_salidas)} icon={ArrowUpCircle} accent="text-destructive" />
        <StatCard
          title="Saldo final"
          value={formatCLP(libro.saldo_final)}
          icon={Wallet}
          accent={libro.saldo_final < 0 ? 'text-destructive' : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={receptor} onValueChange={(v) => setReceptor(v as 'todos' | 'empresa')}>
            <SelectTrigger className="w-[210px]" aria-label="Cobros"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Cobros: Todos</SelectItem>
              <SelectItem value="empresa">Cobros: Solo cuenta empresa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={origen} onValueChange={(v) => setOrigen(v as 'todos' | Origen)}>
            <SelectTrigger className="w-[160px]" aria-label="Origen"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los orígenes</SelectItem>
              <SelectItem value="pedido">Pedidos</SelectItem>
              <SelectItem value="factura">Facturas</SelectItem>
              <SelectItem value="manual">Manuales</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => abrir('entrada')}><Plus className="mr-1 h-4 w-4" /> Nueva entrada</Button>
          <Button variant="outline" onClick={() => abrir('salida')}><Plus className="mr-1 h-4 w-4" /> Nueva salida</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="hidden grid-cols-[6rem_1fr_7rem_7rem_8rem_4.5rem] gap-3 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Fecha</span><span>Descripción</span>
          <span className="text-right">Entrada</span><span className="text-right">Salida</span>
          <span className="text-right">Saldo</span><span />
        </div>
        {lineas.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Sin movimientos en este período.</p>}
        <div className="divide-y">
          {lineas.map((l) => (
            <div key={l.clave}>
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[6rem_1fr_7rem_7rem_8rem_4.5rem]">
              <span className="text-xs text-muted-foreground tabular-nums md:text-sm md:text-foreground">{formatFecha(l.fecha)}</span>
              <span className="row-span-2 text-right font-semibold tabular-nums md:hidden">
                <span className={l.entrada > 0 ? 'text-green-600' : 'text-destructive'}>
                  {l.entrada > 0 ? '+' : '−'}{formatCLP(l.entrada || l.salida)}
                </span>
                <span className="block text-[11px] font-normal text-muted-foreground">saldo {formatCLP(l.saldo)}</span>
              </span>
              <div className="min-w-0 md:col-start-2 md:row-start-1">
                <p className="truncate text-sm font-medium">{l.descripcion}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">{ETIQUETA_ORIGEN[l.origen]}</Badge>
                  {l.automatico && <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">por confirmar</Badge>}
                  {l.origen === 'manual' && <span className="text-xs text-muted-foreground">{nombreCategoria(l.categoria)}</span>}
                  {l.comentario && <span className="truncate text-xs text-muted-foreground">· {l.comentario}</span>}
                </div>
              </div>
              <span className={cn('hidden text-right tabular-nums md:block', l.entrada > 0 && 'font-medium text-green-600')}>
                {l.entrada > 0 ? formatCLP(l.entrada) : ''}
              </span>
              <span className={cn('hidden text-right tabular-nums md:block', l.salida > 0 && 'font-medium text-destructive')}>
                {l.salida > 0 ? formatCLP(l.salida) : ''}
              </span>
              <span className={cn('hidden text-right font-semibold tabular-nums md:block', l.saldo < 0 && 'text-destructive')}>
                {formatCLP(l.saldo)}
              </span>
              <div className="col-span-2 flex justify-end md:col-span-1">
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label="Comentarios"
                  aria-expanded={abierta === l.clave}
                  onClick={() => { setAbierta(abierta === l.clave ? null : l.clave); setNuevo(''); }}>
                  <MessageSquare className={cn('h-3.5 w-3.5', l.comentarios.length > 0 && 'text-primary')} />
                  {l.comentarios.length > 0 && l.comentarios.length}
                </Button>
                {l.editable && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar movimiento"
                      onClick={() => abrir(l.entrada > 0 ? 'entrada' : 'salida', l)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Eliminar movimiento"
                      onClick={() => confirm({
                        title: '¿Eliminar este movimiento?',
                        description: `${l.descripcion} · ${formatCLP(l.entrada || l.salida)}`,
                        confirmLabel: 'Eliminar',
                        destructive: true,
                        onConfirm: async () => {
                          await deleteMovimientoCaja(Number(l.ref.id));
                          queryClient.invalidateQueries({ queryKey: ['libro-caja'] });
                        },
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {abierta === l.clave && (
              <div className="space-y-2 bg-muted/40 px-4 py-3">
                {l.comentarios.length === 0 && <p className="text-xs text-muted-foreground">Sin comentarios.</p>}
                {l.comentarios.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap break-words">{c.texto}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.usuario && `${c.usuario} · `}{formatFecha(c.creado.slice(0, 10))}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Eliminar comentario"
                      onClick={() => quitarComentario(c.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); comentar(l.clave); }}>
                  <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Agregar comentario…" maxLength={2000} />
                  <Button type="submit" size="sm" disabled={!nuevo.trim()}>Agregar</Button>
                </form>
              </div>
            )}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {editando?.id ? 'Editar' : 'Nueva'} {editando?.tipo === 'entrada' ? 'entrada' : 'salida'} de caja
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Monto</Label>
                <DecimalInput value={form.monto} onValueChange={(t) => setForm({ ...form, monto: t })} placeholder="$" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej: aporte de capital" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={form.categoria} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Comentario</Label>
              <Textarea rows={2} value={form.comentario} onChange={(e) => setForm({ ...form, comentario: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button disabled={guardando || !form.descripcion.trim() || monto <= 0} onClick={guardar}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
