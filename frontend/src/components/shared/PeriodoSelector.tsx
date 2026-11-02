import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { crearPeriodo, actualizarPeriodo, eliminarPeriodo, type Periodo } from '@/services/api';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { formatFecha, hoyISO } from '@/lib/utils';

const NUEVO = 'nuevo';
const TODOS = 'todos';
const EDITAR = 'editar';

// Elige qué período se ve en pedidos, pagos y facturas. Un período nuevo cierra el vigente
// el día anterior. Los saldos pendientes se arrastran al siguiente período.
export function PeriodoSelector({ className }: { className?: string }) {
  const { periodos, seleccionado, seleccionar } = usePeriodo();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<Periodo | null>(null);
  const { confirm, dialog } = useConfirm();
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState(hoyISO());

  const crear = useMutation({
    mutationFn: () => editando
      ? actualizarPeriodo(editando.id, { nombre: nombre.trim(), fecha_inicio: inicio })
      : crearPeriodo({ nombre: nombre.trim(), fecha_inicio: inicio }),
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: ['periodos'] });
      seleccionar(data.id);
      setAbierto(false);
      setNombre('');
      toast({ title: editando ? 'Período actualizado' : 'Período creado', description: `Inicio: ${formatFecha(data.fecha_inicio)}. Los saldos anteriores se conservan.` });
    },
    onError: (e: any) =>
      toast({ title: 'No se pudo guardar', description: e?.response?.data?.error ?? 'Revisa los datos', variant: 'destructive' }),
  });

  const borrar = useMutation({
    mutationFn: eliminarPeriodo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['periodos'] });
      seleccionar(null);
      setAbierto(false);
      toast({ title: 'Período eliminado', description: 'Los pedidos, facturas y pagos se conservan.' });
    },
    onError: (e: any) => toast({ title: 'No se pudo eliminar', description: e?.response?.data?.error ?? 'Intenta nuevamente', variant: 'destructive' }),
  });
  const pendiente = crear.isPending || borrar.isPending;

  return (
    <>
      {dialog}
      <Select
        value={seleccionado ? String(seleccionado.id) : TODOS}
        onValueChange={(v) => {
          if (v === NUEVO || v === EDITAR) {
            const p = v === EDITAR ? seleccionado : null;
            setEditando(p);
            setNombre(p?.nombre ?? '');
            setInicio(p?.fecha_inicio ?? hoyISO());
            setAbierto(true);
            return;
          }
          seleccionar(v === TODOS ? null : Number(v));
        }}
      >
        <SelectTrigger className={`w-[210px] bg-background ${className ?? ''}`} aria-label="Período">
          <CalendarRange className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodos.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.nombre}{!p.fecha_fin && ' (vigente)'}
            </SelectItem>
          ))}
          <SelectItem value={TODOS}>Todo el historial</SelectItem>
          <SelectSeparator />
          {seleccionado && <SelectItem value={EDITAR}>Editar o eliminar período…</SelectItem>}
          <SelectItem value={NUEVO}>Nuevo período…</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={abierto} onOpenChange={(open) => { if (!pendiente) setAbierto(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar período' : 'Nuevo período'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'Cambiar el inicio ajusta el cierre anterior y redistribuye los movimientos por fecha. El inicio debe quedar entre los períodos vecinos.'
                : 'Cierra el período vigente el día anterior. Los movimientos se filtran por fecha y los saldos pendientes se arrastran como saldo anterior.'}
              {' '}Los pedidos, facturas y pagos se conservan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="periodo-nombre">Nombre</Label>
              <Input id="periodo-nombre" maxLength={100} disabled={pendiente} placeholder="Ej. Formalizado 2026" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="periodo-inicio">Empieza el</Label>
              <Input id="periodo-inicio" type="date" disabled={pendiente} value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            {editando && <Button variant="destructive" disabled={pendiente} onClick={() => confirm({
              title: `¿Eliminar "${editando.nombre}"?`,
              description: 'Se elimina el corte, conservando los movimientos. El período anterior se extiende hasta el siguiente. Si eliminas el primero, sus movimientos quedan disponibles en Todo el historial y en el saldo anterior.',
              confirmLabel: 'Eliminar período',
              destructive: true,
              onConfirm: () => borrar.mutate(editando.id),
            })}>Eliminar</Button>}
            <Button variant="outline" disabled={pendiente} onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button disabled={!nombre.trim() || !inicio || pendiente} onClick={() => crear.mutate()}>{editando ? 'Guardar cambios' : 'Crear período'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
