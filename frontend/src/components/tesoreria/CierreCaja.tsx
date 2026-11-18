import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, Lock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DecimalInput } from '@/components/shared/DecimalInput';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { createCierreCaja, deleteCierreCaja, getCierresCaja, getLibroCaja } from '@/services/api';
import { cn, formatCLP, formatFecha, hoyISO, parseDecimal } from '@/lib/utils';

export interface Cierre {
  id: number;
  fecha: string;
  receptor: 'todos' | 'empresa';
  saldo_sistema: number;
  saldo_real: number;
  diferencia: number;
  saldo_cerrado: number;
  ajustado: boolean;
  comentario: string;
  usuario: string;
  saldo_hoy?: number;
  alterado?: boolean;
}

function errorDe(e: unknown, defecto: string) {
  const err = e as { response?: { data?: { error?: string } } };
  return err.response?.data?.error || defecto;
}

function Diferencia({ valor }: { valor: number }) {
  if (valor === 0) return <span className="font-medium text-green-600">Cuadra</span>;
  return (
    <span className={cn('font-medium', valor > 0 ? 'text-green-600' : 'text-destructive')}>
      {valor > 0 ? 'Sobran ' : 'Faltan '}{formatCLP(Math.abs(valor))}
    </span>
  );
}

/** Último cierre, botón para cerrar caja e historial de cierres. */
export function CierreCajaPanel({ receptor, ultimo }: { receptor: 'todos' | 'empresa'; ultimo: Cierre | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [abierto, setAbierto] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [fecha, setFecha] = useState(hoyISO());
  const [saldoReal, setSaldoReal] = useState('');
  const [ajustar, setAjustar] = useState(true);
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cierres = useQuery({
    queryKey: ['libro-caja', 'cierres'],
    queryFn: async () => (await getCierresCaja()).data as Cierre[],
  });
  // Saldo según el sistema a la fecha elegida (independiente del rango de la vista).
  const sistema = useQuery({
    queryKey: ['libro-caja', 'saldo-a', fecha, receptor],
    queryFn: async () => (await getLibroCaja({ hasta: fecha, receptor })).data.saldo_final as number,
    enabled: abierto && !!fecha,
  });

  const ultimoConEstado = cierres.data?.[0] ?? null;
  const alterado = ultimoConEstado?.id === ultimo?.id && ultimoConEstado?.alterado;
  const fechaInvalida = !!ultimo && fecha <= ultimo.fecha;
  const real = parseDecimal(saldoReal);
  const diferencia = saldoReal.trim() && sistema.data !== undefined ? real - sistema.data : null;

  const abrir = () => {
    setFecha(hoyISO());
    setSaldoReal('');
    setAjustar(true);
    setComentario('');
    setAbierto(true);
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await createCierreCaja({ fecha, saldo_real: real, receptor, ajustar, comentario });
      queryClient.invalidateQueries({ queryKey: ['libro-caja'] });
      setAbierto(false);
      toast({ title: 'Caja cerrada', description: `Cierre al ${formatFecha(fecha)}` });
    } catch (e) {
      toast({ title: 'Error', description: errorDe(e, 'No se pudo cerrar la caja'), variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = (c: Cierre) => confirm({
    title: '¿Eliminar este cierre?',
    description: `Cierre al ${formatFecha(c.fecha)}. Los movimientos anteriores vuelven a ser editables`
      + (c.ajustado ? ' y se elimina su ajuste.' : '.'),
    confirmLabel: 'Eliminar',
    destructive: true,
    onConfirm: async () => {
      try {
        await deleteCierreCaja(c.id);
        queryClient.invalidateQueries({ queryKey: ['libro-caja'] });
      } catch (e) {
        toast({ title: 'Error', description: errorDe(e, 'No se pudo eliminar'), variant: 'destructive' });
      }
    },
  });

  return (
    <div className="rounded-xl border bg-card p-4">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {ultimo ? (
            <div className="min-w-0 text-sm">
              <p className="font-medium">Caja cerrada al {formatFecha(ultimo.fecha)}</p>
              <p className="text-muted-foreground">
                Saldo real {formatCLP(ultimo.saldo_real)} · sistema {formatCLP(ultimo.saldo_sistema)} ·{' '}
                <Diferencia valor={ultimo.diferencia} />
                {ultimo.ajustado && ' (ajustado)'}
              </p>
            </div>
          ) : (
            <div className="text-sm">
              <p className="font-medium">Sin cierres de caja</p>
              <p className="text-muted-foreground">Cierra la caja para cuadrar el saldo con el banco y bloquear lo anterior.</p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {(cierres.data?.length ?? 0) > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHistorial(!historial)} aria-expanded={historial}>
              <History className="mr-1 h-4 w-4" /> Historial
            </Button>
          )}
          <Button size="sm" onClick={abrir}><Lock className="mr-1 h-4 w-4" /> Cerrar caja</Button>
        </div>
      </div>

      {alterado && ultimoConEstado && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Cambiaron cobros o pagos de facturas anteriores al cierre: el saldo al {formatFecha(ultimoConEstado.fecha)} hoy
            es {formatCLP(ultimoConEstado.saldo_hoy ?? 0)} y se cerró en {formatCLP(ultimoConEstado.saldo_cerrado)}.
            Revisa esos movimientos o elimina el cierre y vuelve a hacerlo.
          </p>
        </div>
      )}

      {historial && (
        <div className="mt-3 divide-y rounded-lg border">
          {cierres.data?.map((c, i) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {formatFecha(c.fecha)}
                  {c.receptor === 'empresa' && <Badge variant="secondary" className="ml-2 text-[10px]">cuenta empresa</Badge>}
                  {c.alterado && <Badge variant="outline" className="ml-2 border-amber-500 text-[10px] text-amber-600">descuadrado</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Real {formatCLP(c.saldo_real)} · sistema {formatCLP(c.saldo_sistema)} · <Diferencia valor={c.diferencia} />
                  {c.usuario && ` · ${c.usuario}`}
                  {c.comentario && ` · ${c.comentario}`}
                </p>
              </div>
              {i === 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Eliminar cierre" onClick={() => eliminar(c)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
            <DialogDescription>
              Compara el saldo del libro con el real (cartola del banco o efectivo contado). Después del cierre,
              los movimientos manuales hasta esa fecha no se pueden modificar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cerrar al</Label>
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Saldo real</Label>
                <DecimalInput value={saldoReal} onValueChange={setSaldoReal} placeholder="$" />
              </div>
            </div>
            {fechaInvalida && (
              <p className="text-sm text-destructive">Debe ser posterior al último cierre ({formatFecha(ultimo!.fecha)}).</p>
            )}
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Saldo según el libro{receptor === 'empresa' && ' (cuenta empresa)'}</span>
                <span className="font-medium tabular-nums">{sistema.isFetching ? '…' : formatCLP(sistema.data ?? 0)}</span>
              </div>
              {diferencia !== null && (
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Diferencia</span>
                  <Diferencia valor={diferencia} />
                </div>
              )}
            </div>
            {diferencia !== null && diferencia !== 0 && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={ajustar} onCheckedChange={(v) => setAjustar(v === true)} className="mt-0.5" />
                <span>
                  Registrar la diferencia como ajuste
                  <span className="block text-xs text-muted-foreground">
                    Crea una {diferencia > 0 ? 'entrada' : 'salida'} de {formatCLP(Math.abs(diferencia))} para que el libro cuadre con el saldo real.
                  </span>
                </span>
              </label>
            )}
            <div className="space-y-1.5">
              <Label>Comentario</Label>
              <Textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Ej: cuadrado con cartola de octubre" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button disabled={guardando || !saldoReal.trim() || !fecha || fechaInvalida || sistema.isFetching} onClick={guardar}>
              Cerrar caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
