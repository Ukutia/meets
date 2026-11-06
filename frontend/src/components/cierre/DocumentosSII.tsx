import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cloud, FileUp, Info, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { actualizarDocumento, getConexionSII, getImportacionesSII, importarArchivoSII, probarConexionSII, sincronizarRCV } from '@/services/api';
import { formatCLP, formatFecha } from '@/lib/utils';
import { TIPOS_DOCUMENTO, type DocumentoCierre, type PedidoCierre } from '@/lib/cierre';

interface Importacion {
  id: number; nombre_archivo: string; tipo: 'ventas' | 'compras' | 'resumen'; mes: string; filas: number;
  nuevos: number; actualizados: number; resultado: any; usuario: string | null; subida: string;
}

const nombreTipo = (t: number) => TIPOS_DOCUMENTO.find((x) => x.value === t)?.label ?? `Tipo ${t}`;

export function DocumentosSII({ mes, pedidos, sinPedido }: { mes: string; pedidos: PedidoCierre[]; sinPedido: DocumentoCierre[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [ultima, setUltima] = useState<Importacion | null>(null);
  const [operacion, setOperacion] = useState('ventas');
  const [estado, setEstado] = useState('registrado');
  const [actualizado, setActualizado] = useState('');

  const { data: importaciones = [] } = useQuery({
    queryKey: ['importaciones-sii'],
    queryFn: async () => (await getImportacionesSII()).data as Importacion[],
  });

  const subir = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('archivo', file);
      fd.append('mes', mes);
      fd.append('operacion', operacion);
      fd.append('estado_registro', estado);
      if (actualizado) fd.append('datos_actualizados_al', actualizado);
      return importarArchivoSII(fd);
    },
    onSuccess: (r) => {
      setUltima(r.data);
      queryClient.invalidateQueries({ queryKey: ['importaciones-sii'] });
      queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] });
      queryClient.invalidateQueries({ queryKey: ['proveedores'] });
      queryClient.invalidateQueries({ queryKey: ['conciliacion'] });
      queryClient.invalidateQueries({ queryKey: ['contabilidad'] });
      toast({ title: 'Archivo procesado' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo leer el archivo', variant: 'destructive' }),
    onSettled: () => { if (archivo.current) archivo.current.value = ''; },
  });

  const asociar = (doc: DocumentoCierre, pedido: string) =>
    actualizarDocumento(doc.id, { pedido: Number(pedido) })
      .then(() => queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] }))
      .catch((e) => toast({ title: 'Error', description: e?.response?.data?.error, variant: 'destructive' }));

  const disponibles = pedidos.filter((p) => p.estado_tributario === 'pendiente');

  return (
    <div className="space-y-4">
      <SincronizarSII mes={mes} onImportado={setUltima} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subir registro del SII (manual)</CardTitle>
          <CardDescription>
            En sii.cl: Servicios online › Factura electrónica › Registro de compras y ventas. Elige el mes y descarga
            el <b>detalle de ventas</b>, el <b>detalle de compras</b> o el <b>resumen</b> (CSV). Puedes subir el mismo archivo varias veces: no se duplica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Archivo
              <Select value={operacion} onValueChange={setOperacion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="ventas">Ventas / boletas</SelectItem><SelectItem value="compras">Compras</SelectItem>
              </SelectContent></Select>
            </label>
            {operacion === 'compras' && <label className="text-sm">Sección descargada del SII
              <Select value={estado} onValueChange={setEstado}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="registrado">Registradas</SelectItem><SelectItem value="pendiente">Pendientes</SelectItem>
                <SelectItem value="reclamado">Reclamadas</SelectItem><SelectItem value="no_incluir">No incluir</SelectItem>
              </SelectContent></Select>
            </label>}
            <label className="text-sm">Datos del SII actualizados al (opcional)
              <Input type="date" value={actualizado} onChange={e => setActualizado(e.target.value)} />
            </label>
          </div>
          <input ref={archivo} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => e.target.files?.[0] && subir.mutate(e.target.files[0])} />
          <Button onClick={() => archivo.current?.click()} disabled={subir.isPending}>
            <FileUp className="h-4 w-4 mr-2" />{subir.isPending ? 'Procesando...' : 'Elegir archivo CSV'}
          </Button>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            El detalle de boletas permite conciliar cada folio. Un resumen solo comprueba cobertura y no crea documentos individuales.
            El período tributario seleccionado se conserva separado de la emisión y de la entrega.
          </p>
          {ultima && <ResultadoImportacion imp={ultima} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos del mes sin pedido ({sinPedido.length})</CardTitle>
          <CardDescription>Vinieron del SII o se ingresaron sin pedido. Asócialos para que la venta quede documentada.</CardDescription>
        </CardHeader>
        <CardContent>
          {sinPedido.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-600" />Todos los documentos del mes tienen pedido.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Documento</TableHead><TableHead>Receptor</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Pedido</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sinPedido.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><p className="font-medium">{d.tipo_nombre} N° {d.folio}</p><p className="text-xs text-muted-foreground">{formatFecha(d.fecha_emision)}</p></TableCell>
                    <TableCell className="text-sm">{d.razon_social || '—'}<p className="text-xs text-muted-foreground">{d.rut_receptor}</p></TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(d.total)}</TableCell>
                    <TableCell className="min-w-[200px]">
                      <Select onValueChange={(v) => asociar(d, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Asociar a pedido" /></SelectTrigger>
                        <SelectContent>
                          {disponibles.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>#{p.id} · {p.cliente.nombre} · {formatCLP(p.total)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {importaciones.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Archivos subidos</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Archivo</TableHead><TableHead>Tipo</TableHead><TableHead>Mes</TableHead><TableHead className="text-right">Filas</TableHead><TableHead>Subido</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {importaciones.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => setUltima(i)}>
                    <TableCell className="text-sm font-medium">{i.nombre_archivo}</TableCell>
                    <TableCell className="text-sm capitalize">{i.tipo}</TableCell>
                    <TableCell className="text-sm">{i.mes}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.filas}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatFecha(i.subida)}{i.usuario && ` · ${i.usuario}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface Conexion { configurado: boolean; titular?: string; rut?: string; vence?: string; vencido?: boolean; error?: string }
interface Seccion { operacion: 'ventas' | 'compras'; estado_registro: string; resultado?: 'importado' | 'sin_cambios' | 'sin_documentos'; error?: string; importacion?: Importacion }

const NOMBRE_SECCION: Record<string, string> = {
  '': 'Ventas', registrado: 'Compras registradas', pendiente: 'Compras pendientes',
  reclamado: 'Compras reclamadas', no_incluir: 'Compras no incluidas',
};
const NOMBRE_RESULTADO = { importado: 'Importado', sin_cambios: 'Sin cambios', sin_documentos: 'Sin documentos' };

function SincronizarSII({ mes, onImportado }: { mes: string; onImportado: (i: Importacion) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [secciones, setSecciones] = useState<Seccion[] | null>(null);
  const { data: conexion } = useQuery({
    queryKey: ['conexion-sii'],
    queryFn: async () => (await getConexionSII()).data as Conexion,
  });
  const error = (e: unknown, def: string) => toast({
    title: 'Error', variant: 'destructive',
    description: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || def,
  });

  const probar = useMutation({
    mutationFn: probarConexionSII,
    onSuccess: () => toast({ title: 'Conexión con el SII correcta' }),
    onError: (e) => error(e, 'No se pudo conectar con el SII'),
  });
  const sincronizar = useMutation({
    mutationFn: () => sincronizarRCV(mes),
    onSuccess: (r) => {
      const s: Seccion[] = r.data.secciones;
      setSecciones(s);
      const ultima = [...s].reverse().find((x) => x.importacion)?.importacion;
      if (ultima) onImportado(ultima);
      ['importaciones-sii', 'cierre-ventas', 'conciliacion', 'contabilidad'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      toast({ title: s.some((x) => x.error) ? 'Sincronización con advertencias' : 'Registro del SII actualizado' });
    },
    onError: (e) => error(e, 'No se pudo descargar el registro'),
  });

  if (!conexion) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Cloud className="h-4 w-4" />Traer del SII</CardTitle>
        <CardDescription>
          Descarga directo del Registro de Compras y Ventas el detalle de ventas y las cuatro secciones de compras de {mes}.
          Puedes repetirlo cuando quieras: lo que no cambió no se vuelve a importar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!conexion.configurado ? (
          <p className="flex gap-2 text-sm text-muted-foreground"><Info className="h-4 w-4 shrink-0" />
            Falta configurar el certificado digital en el servidor (SII_CERT_PFX_B64 y SII_CERT_PASSWORD). Mientras tanto, sube el CSV a mano.</p>
        ) : conexion.error ? (
          <p className="flex gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{conexion.error}</p>
        ) : (
          <>
            <p className={`text-sm ${conexion.vencido ? 'text-destructive' : 'text-muted-foreground'}`}>
              Certificado de {conexion.titular}{conexion.rut && ` (${conexion.rut})`} · {conexion.vencido ? 'venció' : 'vence'} el {formatFecha(conexion.vence!)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending || conexion.vencido}>
                <RefreshCw className={`h-4 w-4 mr-2 ${sincronizar.isPending ? 'animate-spin' : ''}`} />
                {sincronizar.isPending ? 'Descargando del SII...' : `Sincronizar ${mes}`}
              </Button>
              <Button variant="outline" onClick={() => probar.mutate()} disabled={probar.isPending}>
                {probar.isPending ? 'Probando...' : 'Probar conexión'}
              </Button>
            </div>
          </>
        )}
        {secciones && (
          <ul className="space-y-1 text-sm">
            {secciones.map((s) => (
              <li key={s.estado_registro || s.operacion} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{NOMBRE_SECCION[s.estado_registro]}:</span>
                {s.error ? <span className="text-destructive">{s.error}</span>
                  : <span className="text-muted-foreground">{NOMBRE_RESULTADO[s.resultado!]}
                    {s.importacion && ` · ${s.importacion.nuevos} nuevos, ${s.importacion.actualizados} actualizados`}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ResultadoImportacion({ imp }: { imp: Importacion }) {
  const r = imp.resultado ?? {};
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
      <p className="font-semibold">{imp.nombre_archivo} <span className="font-normal text-muted-foreground">· {imp.tipo} · {imp.mes}</span></p>

      {imp.tipo === 'ventas' && (
        <>
          <p>{r.nuevos} documento(s) nuevo(s), {r.actualizados} actualizados. Los candidatos comerciales se confirman en Conciliación tributaria.</p>
          {r.fechas_corregidas?.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {r.fechas_corregidas.length} documento(s) tenían otra fecha ingresada a mano; quedó la fecha del SII.
            </p>
          )}
        </>
      )}

      {imp.tipo === 'resumen' && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tipo</TableHead><TableHead className="text-right">En SII</TableHead><TableHead className="text-right">Registrados aquí</TableHead>
            <TableHead className="text-right">Total SII</TableHead><TableHead className="text-right">Total aquí</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {r.tipos?.map((t: any) => {
              const distinto = t.cantidad_sii !== t.cantidad_registrada || Math.abs(Number(t.total_sii) - Number(t.total_registrado)) > 2;
              return (
                <TableRow key={t.tipo} className={distinto ? 'bg-amber-500/10' : undefined}>
                  <TableCell>{nombreTipo(t.tipo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.cantidad_sii}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.cantidad_registrada}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(t.total_sii)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(t.total_registrado)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {imp.tipo === 'compras' && (
        <div className="space-y-3">
          <p>{r.nuevos} documentos nuevos, {r.actualizados} actualizados; {r.asociados} vínculos por folio y RUT. Revisa diferencias y anticipos en Conciliación tributaria.</p>
          {r.ruts_completados?.length > 0 && (
            <p className="text-muted-foreground">Se completó el RUT de: {r.ruts_completados.map((x: any) => x.proveedor).join(', ')}.</p>
          )}
          <ListaCompras titulo="Con diferencias" filas={r.diferencias} detalle={(d) => `${d.motivo}: SII ${formatCLP(d.total_sii)} / aquí ${formatCLP(d.total_sistema)}${d.anticipo_sii != null ? ` · anticipo SII ${formatCLP(d.anticipo_sii)} / aquí ${formatCLP(d.anticipo_sistema)}` : ''}`} />
          <ListaCompras titulo="En el SII pero no ingresadas aquí" filas={r.faltan_en_sistema} detalle={(d) => `${d.razon_social} · ${formatCLP(d.total_sii)}`} />
          <ListaCompras titulo="Ingresadas aquí pero no están en el SII" filas={r.faltan_en_sii} detalle={(d) => `${d.proveedor} · ${formatCLP(d.total_sistema)}`} />
        </div>
      )}
    </div>
  );
}

function ListaCompras({ titulo, filas, detalle }: { titulo: string; filas?: any[]; detalle: (f: any) => string }) {
  if (!filas?.length) return null;
  return (
    <div>
      <p className="font-medium text-amber-700 dark:text-amber-400">{titulo} ({filas.length})</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {filas.map((f, i) => <li key={i}>Folio {f.folio} · {formatFecha(f.fecha)} · {detalle(f)}</li>)}
      </ul>
    </div>
  );
}
