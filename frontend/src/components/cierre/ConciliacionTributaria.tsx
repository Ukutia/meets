import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import { formatCLP } from '@/lib/utils';
import { getConciliacionMes, getConciliacionDocumento, guardarConciliacionMes, vincularDocumentoSII } from '@/services/api';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { PropuestaF29, type F29 } from './PropuestaF29';

type Num = string | number;
interface Documento {
  id: number; tipo: number; folio: number; operacion: string; razon_social: string; rut_emisor: string; rut_receptor: string;
  total: Num; neto: Num; iva: Num; anticipo: Num; otros_impuestos: Num; iva_no_recuperable: Num; iva_uso_comun: Num;
  registro_tipo: string | null; registro_id: number | string | null; monto_plataforma: Num | null;
  fecha_emision: string; fecha_comercial: string | null; fecha_entrega: string | null; periodo_tributario: string;
  estado_sii: string; estado_conciliacion: string; credito_validado: boolean; anticipo_validado: boolean;
  conciliado_por: string | null; conciliado_el: string | null; justificacion: string;
  diferencias: { monto: Num | null; dias: number | null; periodo: boolean; motivos: string[] };
  columnas_pendientes: string[]; datos_originales: Record<string, string>;
}
interface Mes {
  documentos: Documento[]; indicadores: Record<string, number>; advertencias: string[];
  documentalmente_conciliado: boolean; cumplimiento_completo: boolean;
  f29_estimado: Record<string, Num | null>; f29: F29; parametros: Record<string, Num | null>;
  declarado: { folio_f29?: string; total_pagado?: Num; fecha?: string };
  config: { rut_empresa: string; inicio_actividades: string; regimen: string };
  ventas: Record<string, Num>; compras: Record<string, Num>;
  ppm: { base_estimada_documental: Num; base_utilizada: Num; tasa: Num | null; estimado: Num | null; informado_sii: Num | null; diferencia: Num | null };
  pedidos_fecha_entrega_pendiente: number[]; pedidos_historicos: number[]; entregas_documentadas_despues: number[];
  ventas_sin_documento: { id: number; cliente: string; total: Num; fecha_entrega: string | null; fecha_comercial: string }[];
}
interface Detalle {
  documento: Documento;
  candidatos: { registro_tipo: string; registro_id: number | string; nombre: string; total: Num; fecha: string; motivos: string[] }[];
  historial: { accion: string; usuario: string; fecha: string; antes: unknown; despues: unknown }[];
}
const titulos: Record<string, string> = {
  iva_debito: 'IVA débito', iva_credito: 'IVA crédito procedente', remanente_anterior: 'Remanente anterior',
  remanente_siguiente: 'Remanente IVA siguiente', anticipo_periodo: 'Anticipo validado', anticipo_pendiente: 'Anticipo por validar',
  anticipo_imputado: 'Anticipo imputado (tope IVA)', remanente_anticipo_siguiente: 'Remanente anticipo siguiente',
  iva_a_pagar: 'IVA estimado a pagar', ppm: 'PPM estimado', otros_impuestos: 'Otros impuestos',
  retenciones: 'Retenciones aplicables', total_estimado: 'Total F29 estimado',
};
const parametros: Record<string, string> = {
  tasa_ppm: 'Tasa PPM (%)', base_ppm: 'Base PPM confirmada (vacío: neto documental)', ppm_informado_sii: 'PPM informado SII',
  remanente_anterior: 'Remanente IVA anterior confirmado', remanente_anticipo_anterior: 'Remanente anticipo anterior confirmado',
  otros_impuestos: 'Otros impuestos a pagar', retenciones: 'Retenciones imputables',
};
const texto = (s: string) => s.replace(/_/g, ' ');

export function ConciliacionTributaria({ mes }: { mes: string }) {
  const { seleccionado: periodo } = usePeriodo();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [estado, setEstado] = useState('');
  const [tipo, setTipo] = useState('');
  const [operacion, setOperacion] = useState('');
  const [abierto, setAbierto] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['conciliacion', mes, periodo?.id, periodo?.fecha_inicio, periodo?.fecha_fin], queryFn: async () => (await getConciliacionMes(mes, periodo?.id)).data as Mes });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['conciliacion'] });
    qc.invalidateQueries({ queryKey: ['cierre-ventas'] });
    qc.invalidateQueries({ queryKey: ['contabilidad'] });
  };
  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <ErrorMessage message="No se pudo cargar la conciliación tributaria" />;
  const filas = data.documentos.filter(d => (!estado || d.estado_conciliacion === estado) && (!tipo || String(d.tipo) === tipo) && (!operacion || d.operacion === operacion));
  return <Card>
    <CardHeader>
      <CardTitle>Conciliación tributaria · {mes}</CardTitle>
      <CardDescription>{data.config.rut_empresa} · {data.config.regimen}. Los montos tributarios corresponden al mes completo de la empresa. Las ventas pendientes respetan el período seleccionado. Las facturas ingresadas están en Compras.</CardDescription>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className={data.documentalmente_conciliado ? 'text-green-700 border-green-300' : 'text-amber-800 border-amber-300'}>Documentos: {data.documentalmente_conciliado ? 'conciliados' : 'por revisar'}</Badge>
        <Badge variant="outline" className={data.cumplimiento_completo ? 'text-green-700 border-green-300' : 'text-amber-800 border-amber-300'}>Cumplimiento: {data.cumplimiento_completo ? 'completo' : 'pendiente'}</Badge>
        {data.declarado.folio_f29 && <Badge>Declarado · F29 {data.declarado.folio_f29} · {formatCLP(data.declarado.total_pagado ?? 0)}</Badge>}
      </div>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Object.entries(data.indicadores).map(([k, v]) => <div key={k} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground capitalize">{texto(k)}</p><p className="text-xl font-semibold">{v}</p></div>)}
      </div>
      {data.advertencias.length > 0 && <div className="rounded-lg bg-amber-500/10 p-3 text-sm" role="status">
        <p className="font-medium">Estimación pendiente de validación</p>
        <ul className="list-disc pl-5">{data.advertencias.map(a => <li key={a}>{a}</li>)}</ul>
      </div>}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <h3 className="font-semibold">Documentos del SII</h3>
          <p className="text-sm">Facturas: {data.ventas.facturas} · Boletas: {data.ventas.boletas} · Notas de crédito: {data.ventas.notas_credito}</p>
          <p className="text-sm">Ventas conciliadas: {data.ventas.conciliadas} · Compras sin vínculo interno: {data.compras.sin_vinculo}</p>
          <p className="text-sm">Documentos de compra en SII: {data.compras.registradas} · Pendientes: {data.compras.pendientes} · Reclamadas: {data.compras.reclamadas} · Exentas: {data.compras.exentas}</p>
          <p className="text-sm">Venta neta documental: {formatCLP(data.ventas.neto)} · Total: {formatCLP(data.ventas.total)}</p>
          <p className="text-sm">PPM: base documental {formatCLP(data.ppm.base_estimada_documental)} · Base utilizada {formatCLP(data.ppm.base_utilizada)} · Tasa {data.ppm.tasa ?? 'sin confirmar'}%</p>
          <p className="text-sm">PPM SII: {data.ppm.informado_sii == null ? 'no informado' : formatCLP(data.ppm.informado_sii)} · Diferencia {data.ppm.diferencia == null ? '—' : formatCLP(data.ppm.diferencia)}</p>
          <p className="text-xs text-muted-foreground">Las salidas de stock y las compras internas siguen disponibles en los reportes comerciales.</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <h3 className="font-semibold">Preparación F29 · estimado validado</h3>
          <p className="text-xs text-muted-foreground">Solo con créditos y anticipos validados en la plataforma.</p>
          {Object.entries(data.f29_estimado).map(([k, v]) => <div key={k} className={`flex justify-between gap-3 text-sm ${k === 'total_estimado' ? 'font-bold border-t pt-2' : ''}`}>
            <span>{titulos[k] ?? texto(k)}</span><span className="tabular-nums">{v == null ? 'por confirmar' : formatCLP(v)}</span>
          </div>)}
        </div>
      </div>
      <PropuestaF29 f29={data.f29} />
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Parámetros del período y declaración manual</summary>
        <ParametrosMes key={mes + JSON.stringify(data.parametros)} mes={mes} data={data} onSaved={refrescar} />
      </details>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Operación<select aria-label="Filtrar operación" className="block rounded border bg-background p-2" value={operacion} onChange={e => setOperacion(e.target.value)}><option value="">Todas</option><option value="ventas">Ventas</option><option value="compras">Compras</option></select></label>
        <label className="text-sm">Tipo DTE<select aria-label="Filtrar tipo DTE" className="block rounded border bg-background p-2" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Todos</option>{[33, 34, 39, 41, 46, 56, 61].map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="text-sm">Estado<select aria-label="Filtrar estado" className="block rounded border bg-background p-2" value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos</option>{['conciliado', 'por_revisar', 'sin_coincidencia'].map(s => <option key={s} value={s}>{texto(s)}</option>)}</select></label>
      </div>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>
        {['Documento SII', 'Registro interno', 'Cliente/proveedor', 'Monto SII', 'Monto plataforma', 'Diferencia', 'Estado', 'Detalle'].map(t => <TableHead key={t}>{t}</TableHead>)}
      </TableRow></TableHeader><TableBody>
        {filas.map(d => <TableRow key={d.id}>
          <TableCell><p>{d.tipo} · Folio {d.folio}</p><p className="text-xs">{d.operacion} · Emisión {d.fecha_emision}</p><p className="text-xs">Período {d.periodo_tributario || mes}</p></TableCell>
          <TableCell>{d.registro_id ? `${d.registro_tipo} #${d.registro_id}` : 'Sin vínculo'}{d.diferencias.periodo && <p className="text-xs text-amber-700">Período comercial distinto</p>}</TableCell>
          <TableCell>{d.razon_social || 'Consumidor final'}<p className="text-xs text-muted-foreground">{d.operacion === 'compras' ? d.rut_emisor : d.rut_receptor}</p></TableCell>
          <TableCell>{formatCLP(d.total)}</TableCell><TableCell>{d.monto_plataforma == null ? '—' : formatCLP(d.monto_plataforma)}</TableCell>
          <TableCell>{d.diferencias.monto == null ? '—' : formatCLP(d.diferencias.monto)}</TableCell>
          <TableCell><Badge variant="outline" className={d.estado_conciliacion === 'conciliado' ? 'text-green-700' : 'text-amber-800'}>{texto(d.estado_conciliacion)}</Badge><p className="text-xs">SII: {d.estado_sii || 'sin verificar'}</p></TableCell>
          <TableCell><Button size="sm" variant="outline" onClick={() => setAbierto(d.id)}>Revisar</Button></TableCell>
        </TableRow>)}
        {!filas.length && <TableRow><TableCell colSpan={8}>Sin documentos para estos filtros. Importa el RCV en la pestaña Documentos SII del cierre.</TableCell></TableRow>}
      </TableBody></Table></div>
      <details><summary className="cursor-pointer font-medium">Ventas sin documento del período ({data.ventas_sin_documento.length})</summary>
        <Table><TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Fecha</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>
          {data.ventas_sin_documento.map(p => <TableRow key={p.id}><TableCell>#{p.id} · {p.cliente}</TableCell><TableCell>{p.fecha_comercial}</TableCell><TableCell>{formatCLP(p.total)}</TableCell></TableRow>)}
          {!data.ventas_sin_documento.length && <TableRow><TableCell colSpan={3}>Sin ventas pendientes de documentación.</TableCell></TableRow>}
        </TableBody></Table>
      </details>
      {!!data.entregas_documentadas_despues.length && <p className="text-sm">Ventas con documento emitido posteriormente: {data.entregas_documentadas_despues.map(id => `#${id}`).join(', ')}.</p>}
      {!!data.pedidos_historicos.length && <p className="text-xs text-muted-foreground">Operaciones anteriores al inicio conservadas: {data.pedidos_historicos.map(id => `#${id}`).join(', ')}.</p>}
      <p className="text-xs text-muted-foreground">La declaración se realiza manualmente en el SII. <Link className="underline" to="/tesoreria">Ver estimaciones comerciales en Tesorería</Link>.</p>
      <Dialog open={abierto !== null} onOpenChange={v => !v && setAbierto(null)}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Revisar documento</DialogTitle></DialogHeader>
        {abierto !== null && <DetalleDocumento key={abierto} id={abierto} onSaved={refrescar} />}
      </DialogContent></Dialog>
    </CardContent>
  </Card>;
}

function ParametrosMes({ mes, data, onSaved }: { mes: string; data: Mes; onSaved: () => void }) {
  const { toast } = useToast();
  const [valores, setValores] = useState(Object.fromEntries(Object.keys(parametros).map(k => [k, String(data.parametros[k] ?? '')])));
  const [fundamento, setFundamento] = useState(String(data.parametros.fundamento ?? ''));
  const [folio, setFolio] = useState('');
  const [pagado, setPagado] = useState('');
  const [fecha, setFecha] = useState('');
  const guardar = useMutation({
    mutationFn: (declarar: boolean) => guardarConciliacionMes({ mes, fundamento,
      ...Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, v === '' ? null : v.replace(',', '.')])),
      ...(declarar ? { declarado: { folio_f29: folio, total_pagado: pagado, fecha } } : {}),
    }),
    onSuccess: () => { onSaved(); toast({ title: 'Parámetros guardados' }); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast({ title: 'No se pudo guardar', description: e.response?.data?.error, variant: 'destructive' }),
  });
  return <div className="space-y-3 mt-4">
    <p className="text-sm">Confirma tasa y base de PPM según tu régimen y período, remanentes del F29 anterior y ajustes aplicables. La base documental es una referencia; no sustituye la validación de ingresos del régimen.</p>
    <div className="grid sm:grid-cols-2 gap-3">{Object.entries(parametros).map(([k, label]) => <label key={k} className="text-xs">{label}<Input inputMode="decimal" value={valores[k]} onChange={e => setValores({ ...valores, [k]: e.target.value })} /></label>)}</div>
    <label className="block text-xs">Fuente / fundamento de validación<Textarea value={fundamento} onChange={e => setFundamento(e.target.value)} /></label>
    <Button disabled={guardar.isPending || !fundamento.trim()} onClick={() => guardar.mutate(false)}>Guardar parámetros</Button>
    {!data.declarado.folio_f29 && <details className="border-t pt-3"><summary className="cursor-pointer text-sm">Registrar F29 ya declarado en el SII</summary>
      <div className="grid sm:grid-cols-3 gap-3 my-3"><label className="text-xs">Folio F29<Input value={folio} onChange={e => setFolio(e.target.value)} /></label><label className="text-xs">Total pagado<Input inputMode="decimal" value={pagado} onChange={e => setPagado(e.target.value)} /></label><label className="text-xs">Fecha declaración<Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></label></div>
      <Button disabled={guardar.isPending || !folio || !fecha || !pagado || !fundamento.trim()} onClick={() => guardar.mutate(true)}>Registrar declaración y conservar copia</Button>
    </details>}
  </div>;
}

function DetalleDocumento({ id, onSaved }: { id: number; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [registro, setRegistro] = useState('');
  const [registroTipo, setRegistroTipo] = useState('');
  const [motivo, setMotivo] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['conciliacion-detalle', id], queryFn: async () => (await getConciliacionDocumento(id)).data as Detalle });
  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => vincularDocumentoSII(id, { ...cambios, justificacion: motivo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conciliacion-detalle', id] }); onSaved(); toast({ title: 'Revisión registrada' }); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast({ title: 'No se pudo vincular', description: e.response?.data?.error, variant: 'destructive' }),
  });
  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <ErrorMessage message="No se pudo cargar el documento" />;
  const d = data.documento;
  return <div className="space-y-4 text-sm">
    <p>DTE {d.tipo} · Folio {d.folio} · {d.razon_social} · {formatCLP(d.total)}</p>
    <p>Fecha del documento: {d.fecha_emision}</p>
    <p>Neto {formatCLP(d.neto)} · IVA {formatCLP(d.iva)} · Anticipo {formatCLP(d.anticipo)} · Otros {formatCLP(d.otros_impuestos)} · IVA no recuperable {formatCLP(d.iva_no_recuperable)} · Uso común {formatCLP(d.iva_uso_comun)}</p>
    <p>Diferencias: {d.diferencias.motivos.join('; ') || 'sin diferencias detectadas'}. Días: {d.diferencias.dias ?? '—'}</p>
    {!!d.columnas_pendientes.length && <p className="text-amber-700">Columnas por validar: {d.columnas_pendientes.join(', ')}</p>}
    <details><summary className="cursor-pointer">Datos originales de la fila SII</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(d.datos_originales, null, 2)}</pre></details>
    <p>Vínculo: {d.registro_tipo ?? 'ninguno'} {d.registro_id ?? ''} · Revisado por {d.conciliado_por ?? '—'} · {d.conciliado_el ?? ''}</p>
    {d.justificacion && <p>Justificación anterior: {d.justificacion}</p>}
    <label className="block">Justificación de esta revisión<Textarea value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
    <p className="font-medium">Candidatos para revisión manual</p>
    <div className="max-h-48 overflow-auto space-y-2">{data.candidatos.map(p => <div className="flex justify-between items-center gap-3 rounded border p-2" key={`${p.registro_tipo}-${p.registro_id}`}>
      <span>{p.registro_tipo} #{p.registro_id} · {p.nombre} · {p.fecha} · {formatCLP(p.total)}<small className="block text-muted-foreground">{p.motivos.join(', ')}</small></span>
      <Button size="sm" disabled={!motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({ registro_tipo: p.registro_tipo, registro_id: p.registro_id })}>Vincular</Button>
    </div>)}</div>
    <div className="flex flex-wrap items-end gap-2">
      <label>Tipo<select className="block border rounded p-2 bg-background" value={registroTipo} onChange={e => setRegistroTipo(e.target.value)}><option value="">Elegir</option>{(d.operacion === 'ventas' ? ['pedido'] : ['factura', 'gasto', 'nota_compra']).map(t => <option key={t}>{t}</option>)}</select></label>
      <label>ID / folio interno<Input value={registro} onChange={e => setRegistro(e.target.value)} /></label>
      <Button variant="outline" disabled={!registro || !registroTipo || !motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({ registro_tipo: registroTipo, registro_id: registro })}>Vincular por ID</Button>
      <Button variant="outline" disabled={!d.registro_id || !motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({ registro_tipo: null })}>Desvincular</Button>
      <Button disabled={!d.registro_id || !motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({})}>Confirmar revisión</Button>
    </div>
    {d.operacion === 'compras' && <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({ credito_validado: !d.credito_validado })}>{d.credito_validado ? 'Excluir crédito fiscal' : 'Validar crédito fiscal'}</Button>
      <Button variant="outline" disabled={!motivo.trim() || guardar.isPending} onClick={() => guardar.mutate({ anticipo_validado: !d.anticipo_validado })}>{d.anticipo_validado ? 'Retirar validación de anticipo' : 'Validar procedencia del anticipo'}</Button>
    </div>}
    <details><summary className="cursor-pointer">Historial de revisiones e importaciones ({data.historial.length})</summary>{data.historial.map((h, i) => <div className="border-t py-2" key={i}><p>{h.accion} · {h.usuario} · {h.fecha}</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ antes: h.antes, despues: h.despues }, null, 2)}</pre></div>)}</details>
  </div>;
}
