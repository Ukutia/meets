import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CalendarCheck, Download, FileWarning, HandCoins, Receipt, Search, TrendingUp, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/components/shared/StatCard';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { DetallePedidoCierre, Etiqueta } from '@/components/cierre/DetallePedidoCierre';
import { DocumentosSII } from '@/components/cierre/DocumentosSII';
import { ComprasMes } from '@/components/cierre/ComprasMes';
import { ConciliacionTributaria } from '@/components/cierre/ConciliacionTributaria';
import { useConfirm } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { declararMes, getVendedores, getVentasMes } from '@/services/api';
import { usePeriodo } from '@/contexts/PeriodoContext';
import { cn, formatCLP, formatFecha } from '@/lib/utils';
import {
  ETIQUETA_COBRO, ETIQUETA_DECLARACION, ETIQUETA_TRIBUTARIO, MEDIOS_PAGO, mesActual, mesSiguiente, nombreMes,
  type PedidoCierre, type VentasMes,
} from '@/lib/cierre';

type Filtro = 'todos' | 'por_cobrar' | 'con_documento' | 'sin_documento' | 'alertas';
type CampoOrden = 'fecha' | 'pedido' | 'cliente' | 'vendedor' | 'total' | 'margen' | 'saldo' | 'tipo' | 'folio' | 'declaracion';

// Boleta o factura según lo emitido; si aún no hay documento, según lo pedido.
const tipoDocumento = (p: PedidoCierre): 'boleta' | 'factura' => {
  const ventas = p.documentos.filter((d) => d.ambiente === 'produccion' && [33, 34, 39, 41].includes(d.tipo));
  if (ventas.length) return ventas.some((d) => d.tipo === 33 || d.tipo === 34) ? 'factura' : 'boleta';
  return p.documento_requerido === 'Factura' ? 'factura' : 'boleta';
};

const CLAVES_ORDEN: Record<CampoOrden, (p: PedidoCierre) => string | number | null> = {
  fecha: (p) => p.fecha,
  pedido: (p) => p.id,
  cliente: (p) => p.cliente.nombre.toLowerCase(),
  vendedor: (p) => p.vendedor?.nombre.toLowerCase() ?? null,
  total: (p) => Number(p.total),
  margen: (p) => Number(p.margen),
  saldo: (p) => Number(p.saldo),
  tipo: (p) => tipoDocumento(p),
  folio: (p) => (p.documentos.length ? Math.min(...p.documentos.map((d) => d.folio)) : null),
  declaracion: (p) => p.declaracion.estado,
};

export default function CierreMes() {
  const { seleccionado: periodo } = usePeriodo();
  const [mes, setMes] = useState(mesActual());
  const minMes = periodo?.fecha_inicio.slice(0, 7);
  const maxMes = periodo?.fecha_fin?.slice(0, 7) ?? mesActual();
  useEffect(() => {
    setMes(actual => minMes && actual < minMes ? minMes : actual > maxMes ? maxMes : actual);
  }, [minMes, maxMes]);
  const [vendedor, setVendedor] = useState('todos');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'asc' });
  const ordenarPor = (campo: CampoOrden) =>
    setOrden((o) => o.campo === campo ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: async () => (await getVendedores()).data });
  const { data, isLoading, error } = useQuery({
    queryKey: ['cierre-ventas', mes, vendedor, periodo?.id, periodo?.fecha_inicio, periodo?.fecha_fin],
    queryFn: async () => (await getVentasMes({ mes, vendedor: vendedor === 'todos' ? undefined : vendedor, periodo: periodo?.id })).data as VentasMes,
  });

  // La selección parte con lo ya declarado en el mes y se mantiene al filtrar.
  const declaradosKey = (data?.pedidos ?? []).filter((p) => p.declaracion.estado === 'declarado').map((p) => p.id).join(',');
  useEffect(() => {
    setSelectedIds(declaradosKey ? declaradosKey.split(',').map(Number) : []);
  }, [declaradosKey, mes, vendedor, periodo?.id, periodo?.fecha_inicio, periodo?.fecha_fin]);

  const declararMutation = useMutation({
    mutationFn: (ids: number[]) => declararMes({ mes, pedidos: ids, vendedor: vendedor === 'todos' ? undefined : vendedor, periodo: periodo?.id }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['cierre-ventas'] });
      queryClient.invalidateQueries({ queryKey: ['conciliacion'] });
      toast({ title: `${r.data.declarados} pedido(s) declarados en ${nombreMes(mes)}`,
        description: r.data.diferidos ? `${r.data.diferidos} pasan a ${nombreMes(r.data.mes_siguiente)}.` : undefined });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar', variant: 'destructive' }),
  });

  const pedidos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtrados = (data?.pedidos ?? []).filter((p) => {
      if (filtro === 'por_cobrar' && p.estado_cobro === 'pagado') return false;
      // Los documentos con diferencias de monto o tipo también cuentan como emitidos.
      if (filtro === 'con_documento' && p.estado_tributario === 'pendiente') return false;
      if (filtro === 'sin_documento' && p.estado_tributario === 'emitido') return false;
      if (filtro === 'alertas' && p.alertas.length === 0) return false;
      if (!q) return true;
      return p.cliente.nombre.toLowerCase().includes(q) || String(p.id) === q
        || p.documentos.some((d) => String(d.folio) === q);
    });
    const valor = CLAVES_ORDEN[orden.campo];
    const dir = orden.dir === 'asc' ? 1 : -1;
    return [...filtrados].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      // Lo que no tiene valor (ej. sin folio) va siempre al final.
      if (va === null || vb === null) return va === vb ? a.id - b.id : va === null ? 1 : -1;
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'es') : va - (vb as number);
      return c ? c * dir : a.id - b.id;
    });
  }, [data, filtro, busqueda, orden]);

  const pedidosSeleccionados = useMemo(
    () => (data?.pedidos ?? []).filter((p) => p.declaracion.editable && selectedIds.includes(p.id)),
    [data, selectedIds],
  );
  const ivaSeleccionado = pedidosSeleccionados.reduce((suma, p) => suma + Number(p.iva), 0);
  const porTipo = useMemo(() => {
    const g = { boleta: { cantidad: 0, iva: 0, total: 0 }, factura: { cantidad: 0, iva: 0, total: 0 } };
    for (const p of pedidosSeleccionados) {
      const x = g[tipoDocumento(p)];
      x.cantidad += 1; x.iva += Number(p.iva); x.total += Number(p.total);
    }
    return g;
  }, [pedidosSeleccionados]);
  const visiblesEditables = pedidos.filter((p) => p.declaracion.editable);
  const visiblesSeleccionados = visiblesEditables.filter((p) => selectedIds.includes(p.id)).length;
  const toggleSeleccion = (id: number) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
  };
  const toggleVisibles = (marcar: boolean) => {
    const visibles = visiblesEditables.map((p) => p.id);
    setSelectedIds((ids) => marcar ? [...new Set([...ids, ...visibles])] : ids.filter((i) => !visibles.includes(i)));
  };

  const declarar = () => {
    const editables = (data?.pedidos ?? []).filter((p) => p.declaracion.editable);
    const quedan = editables.length - pedidosSeleccionados.length;
    confirm({
      title: `Cerrar declaración de ${nombreMes(mes)}`,
      description: `Se declaran ${pedidosSeleccionados.length} pedido(s), IVA ${formatCLP(ivaSeleccionado)}. `
        + (quedan ? `Los otros ${quedan} pasan a ${nombreMes(mesSiguiente(mes))}.` : 'No queda ninguno para el mes siguiente.')
        + (vendedor !== 'todos' ? ' Solo afecta los pedidos del vendedor elegido.' : ''),
      confirmLabel: 'Cerrar declaración',
      onConfirm: () => declararMutation.mutate(pedidosSeleccionados.map((p) => p.id)),
    });
  };

  // Se busca por id en los datos frescos para que el panel se actualice al registrar algo.
  const pedidoAbierto = data?.pedidos.find((p) => p.id === seleccionado) ?? null;

  const exportar = () => {
    if (!data) return;
    const ventas = data.pedidos.flatMap((p) => p.lineas.map((l, i) => ({
      'Pedido': p.id, 'Fecha venta': formatFecha(p.fecha), 'Cliente': p.cliente.nombre, 'RUT cliente': p.cliente.rut,
      'Tipo cliente': p.cliente.tipo, 'Producto': l.producto, 'Kilos': Number(l.kilos), 'Unidades': Number(l.unidades ?? 0),
      'Precio/kg con IVA': Number(l.precio_venta), 'Total línea con IVA': Number(l.total), 'Costo línea neto': Number(l.costo),
      // Los totales del pedido solo en su primera línea, para que sumar la columna no los duplique.
      'Total pedido con IVA': i === 0 ? Number(p.total) : null, 'Neto pedido': i === 0 ? Number(p.neto) : null,
      'IVA pedido': i === 0 ? Number(p.iva) : null, 'Margen pedido': i === 0 ? Number(p.margen) : null,
      'Vendedor': p.vendedor?.nombre ?? '', 'Cobrado': i === 0 ? Number(p.cobrado) : null,
      'Estado cobro': ETIQUETA_COBRO[p.estado_cobro].texto, 'Documento requerido': p.documento_requerido,
      'Documento emitido': p.documentos.map((d) => `${d.tipo_nombre} ${d.folio} (${formatFecha(d.fecha_emision)})`).join(', '),
      'Estado tributario': ETIQUETA_TRIBUTARIO[p.estado_tributario].texto,
      'Declaración': p.declaracion.estado === 'diferido' ? `Pasa a ${nombreMes(p.declaracion.mes)}` : ETIQUETA_DECLARACION[p.declaracion.estado].texto,
      'Alertas': p.alertas.join('; '),
    })));
    const cobros = data.pedidos.flatMap((p) => p.cobros.map((c) => ({
      'Pedido': p.id, 'Cliente': p.cliente.nombre, 'Fecha cobro': formatFecha(c.fecha), 'Monto': Number(c.monto),
      'Medio': MEDIOS_PAGO.find((m) => m.value === c.medio)?.label ?? c.medio,
      'Recibió': c.receptor === 'empresa' ? 'Cuenta de la empresa' : c.vendedor_nombre ?? '',
      'Desde cartola': c.desde_banco ? 'Sí' : 'No', 'Por confirmar': c.automatico ? 'Sí' : 'No', 'Comentario': c.comentario,
    })));
    const r = data.resumen;
    const resumen = [
      ['Período', periodo?.nombre ?? 'Todo el historial'],
      ['Desde', data.rango?.desde ?? 'Sin intersección con el mes'], ['Hasta', data.rango?.hasta ?? ''],
      ['Mes', nombreMes(data.mes)], ['Ventas con IVA', Number(r.ventas_total)], ['Ventas netas', Number(r.ventas_netas)],
      ['IVA débito según ventas', Number(r.iva_debito_teorico)], ['IVA débito según documentos emitidos', Number(r.iva_debito_documentos)],
      ['Cobrado de las ventas del mes', Number(r.cobrado)], ['Por cobrar', Number(r.saldo_pendiente)],
      ['Costo de lo vendido', Number(r.costo)], ['Margen bruto', Number(r.margen)], ['Cantidad de ventas', r.cantidad],
      ['Con documento', r.con_documento], ['Sin documento', r.sin_documento], ['Por revisar', r.por_revisar],
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(ventas), 'Ventas');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(cobros), 'Cobros');
    XLSX.writeFile(libro, `cierre-${data.mes}.xlsx`);
  };

  return (
    <div className={cn('space-y-6 pb-20 md:pb-0', pedidosSeleccionados.length > 0 && 'pb-44 md:pb-24')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Cierre de mes</h1>
          <p className="text-muted-foreground">Ventas, compras y documentos de {nombreMes(mes)}.</p>
          {periodo && <p className="text-sm text-muted-foreground">
            Período: {periodo.nombre} · desde {formatFecha(periodo.fecha_inicio)}
            {periodo.fecha_fin && ` hasta ${formatFecha(periodo.fecha_fin)}`}.
          </p>}
          {!periodo && <p className="text-sm text-muted-foreground">Todo el historial · mostrando el mes seleccionado.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input type="month" value={mes} min={minMes} max={maxMes} aria-label="Mes del cierre" onChange={(e) => e.target.value && setMes(e.target.value)} className="w-[160px]" />
          <Button variant="outline" onClick={exportar} disabled={!data}><Download className="h-4 w-4 mr-2" />Exportar ventas</Button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : error || !data ? <ErrorMessage message="No se pudo cargar el cierre" /> : (
        <>
          {!data.rango && <p className="text-sm text-muted-foreground">El mes elegido queda fuera del período seleccionado. Elige otro mes o período.</p>}
          {data.rango && <p className="rounded-lg border bg-muted/30 px-4 py-2 text-sm">Fechas incluidas: {formatFecha(data.rango.desde)} al {formatFecha(data.rango.hasta)}. Ventas por fecha del pedido; compras por fecha de la factura.</p>}
          <Tabs defaultValue="ventas" className="space-y-4">
            <TabsList className="h-auto flex flex-wrap justify-start gap-1">
              <TabsTrigger value="ventas">Ventas</TabsTrigger>
              <TabsTrigger value="compras">Compras</TabsTrigger>
              <TabsTrigger value="tributario">Revisión tributaria</TabsTrigger>
              <TabsTrigger value="documentos">Importar / revisar SII</TabsTrigger>
              <TabsTrigger value="vendedores">Por vendedor</TabsTrigger>
            </TabsList>

            <TabsContent value="ventas" className="space-y-3">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard title={`Ventas${vendedor !== 'todos' ? ' del vendedor' : ' del mes'}`} value={formatCLP(data.resumen.ventas_total)} icon={TrendingUp}
              description={`${data.resumen.cantidad} ventas · neto ${formatCLP(data.resumen.ventas_netas)}`} />
            <StatCard title="Por cobrar" value={formatCLP(data.resumen.saldo_pendiente)} icon={HandCoins}
              accent={Number(data.resumen.saldo_pendiente) > 0 ? 'text-orange-600' : 'text-green-600'}
              description={`Cobrado ${formatCLP(data.resumen.cobrado)}`} onClick={() => setFiltro('por_cobrar')} />
            <StatCard title="Sin documento" value={data.resumen.sin_documento + data.resumen.por_revisar} icon={FileWarning}
              accent={data.resumen.sin_documento + data.resumen.por_revisar > 0 ? 'text-destructive' : 'text-green-600'}
              description={`${data.resumen.con_documento} con boleta o factura · ${data.resumen.por_revisar} por revisar`}
              onClick={() => setFiltro('sin_documento')} />
            <StatCard title="Margen bruto" value={formatCLP(data.resumen.margen)} icon={Wallet}
              description={`${data.resumen.margen_pct ?? 0}% sobre el neto · costo ${formatCLP(data.resumen.costo)}`} />
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" />IVA de ventas</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
              <div><p className="text-muted-foreground">Según las ventas</p><p className="text-lg font-bold tabular-nums">{formatCLP(data.resumen.iva_debito_teorico)}</p></div>
              <div>
                <p className="text-muted-foreground">Según documentos emitidos</p>
                <p className="text-lg font-bold tabular-nums">{formatCLP(data.resumen.iva_debito_documentos)}</p>
                <p className="text-xs text-muted-foreground">Suma del IVA de los pedidos con boleta o factura emitida, aunque se haya solicitado otro tipo de documento. Cada pedido cuenta una vez.</p>
              </div>
              <div>
                <p className="text-muted-foreground">Diferencia</p>
                <p className={cn('text-lg font-bold tabular-nums',
                  Math.abs(Number(data.resumen.iva_debito_teorico) - Number(data.resumen.iva_debito_documentos)) > 2 && 'text-amber-600')}>
                  {formatCLP(Number(data.resumen.iva_debito_teorico) - Number(data.resumen.iva_debito_documentos))}
                </p>
                <p className="text-xs text-muted-foreground">IVA de los pedidos que aún no tienen boleta o factura emitida.</p>
              </div>
            </CardContent>
          </Card>

          {data.resumen.cobros_por_confirmar > 0 && (
            <button onClick={() => setFiltro('alertas')}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {data.resumen.cobros_por_confirmar} cobro(s) se registraron al marcar el pedido Pagado. Confirma su fecha y medio de pago.
            </button>
          )}

          {data.resumen.pagado_sin_cobro > 0 && (
            <button onClick={() => setFiltro('alertas')}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {data.resumen.pagado_sin_cobro} pedido(s) están marcados Pagado pero no tienen el cobro registrado (monto, fecha y quién lo recibió).
            </button>
          )}

              <p className="text-sm text-muted-foreground">Ventas por fecha del pedido, dentro del mes y del período seleccionado.</p>
              <div className="flex flex-wrap items-center gap-2">
          <Select value={vendedor} onValueChange={setVendedor}>
            <SelectTrigger className="w-[170px]" aria-label="Vendedor de las ventas"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los vendedores</SelectItem>
              {vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
            </SelectContent>
          </Select>

                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Cliente, N° de pedido o folio" className="pl-8" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                </div>
                {([['todos', 'Todas'], ['por_cobrar', 'Por cobrar'], ['con_documento', 'Con documento'], ['sin_documento', 'Sin documento'], ['alertas', 'Con alertas']] as [Filtro, string][]).map(([v, t]) => (
                  <Button key={v} size="sm" variant={filtro === v ? 'default' : 'outline'} onClick={() => setFiltro(v)}>{t}</Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-2 text-sm">
                <p>
                  <span className="font-medium">Declaración:</span> {data.resumen.declarados} declarado(s)
                  · IVA {formatCLP(data.resumen.iva_declarado)}
                  {data.resumen.arrastrados > 0 && ` · ${data.resumen.arrastrados} vienen de meses anteriores`}
                  {data.resumen.diferidos > 0 && ` · ${data.resumen.diferidos} pasaron a ${nombreMes(mesSiguiente(mes))} o después`}
                </p>
                <Button size="sm" onClick={declarar} disabled={declararMutation.isPending || !data.pedidos.some((p) => p.declaracion.editable)}>
                  <CalendarCheck className="h-4 w-4 mr-2" />Cerrar declaración
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Marca los pedidos que declaraste en {nombreMes(mes)} y cierra la declaración: los no marcados pasan a {nombreMes(mesSiguiente(mes))}.
              </p>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          aria-label="Seleccionar todos los pedidos visibles"
                          checked={visiblesEditables.length > 0 && visiblesSeleccionados === visiblesEditables.length ? true
                            : visiblesSeleccionados > 0 ? 'indeterminate' : false}
                          disabled={visiblesEditables.length === 0}
                          onCheckedChange={(checked) => toggleVisibles(checked === true)}
                        />
                      </TableHead>
                      <CabeceraOrden campo="fecha" orden={orden} onOrdenar={ordenarPor}>Pedido</CabeceraOrden>
                      <CabeceraOrden campo="cliente" orden={orden} onOrdenar={ordenarPor}>Cliente</CabeceraOrden>
                      <CabeceraOrden campo="vendedor" orden={orden} onOrdenar={ordenarPor} className="hidden md:table-cell">Vendedor</CabeceraOrden>
                      <CabeceraOrden campo="total" orden={orden} onOrdenar={ordenarPor} className="text-right justify-end">Total</CabeceraOrden>
                      <CabeceraOrden campo="margen" orden={orden} onOrdenar={ordenarPor} className="text-right justify-end hidden lg:table-cell">Margen</CabeceraOrden>
                      <CabeceraOrden campo="saldo" orden={orden} onOrdenar={ordenarPor}>Cobro</CabeceraOrden>
                      <CabeceraOrden campo="folio" orden={orden} onOrdenar={ordenarPor}>Documento / folio</CabeceraOrden>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pedidos.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="h-20 text-center text-muted-foreground">No hay ventas con este filtro</TableCell></TableRow>
                    ) : pedidos.map((p) => <FilaPedido key={p.id} p={p} seleccionado={selectedIds.includes(p.id)}
                      onSeleccionar={() => toggleSeleccion(p.id)} onClick={() => setSeleccionado(p.id)} />)}
                  </TableBody>
                </Table>
              </div>
              {pedidosSeleccionados.length > 0 && (
                <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4 z-30 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-2xl">
                  <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
                    <p className="text-xs text-slate-300">
                      {pedidosSeleccionados.length} pedido{pedidosSeleccionados.length === 1 ? '' : 's'} seleccionado{pedidosSeleccionados.length === 1 ? '' : 's'}
                      {' · '}IVA total <span className="font-semibold text-white tabular-nums">{formatCLP(ivaSeleccionado)}</span>
                    </p>
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      {([['Boletas', porTipo.boleta], ['Facturas', porTipo.factura]] as const).map(([titulo, g]) => (
                        <div key={titulo}>
                          <p className="text-xs text-slate-300">{titulo} ({g.cantidad})</p>
                          <p className="text-lg font-bold tabular-nums text-blue-300">{formatCLP(g.iva)}</p>
                          <p className="text-xs text-slate-400 tabular-nums">total {formatCLP(g.total)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-slate-800" onClick={() => setSelectedIds([])}>
                    Limpiar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={declarar} disabled={declararMutation.isPending}>
                    Declarar
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="compras"><ComprasMes mes={mes} /></TabsContent>
            <TabsContent value="tributario"><ConciliacionTributaria mes={mes} /></TabsContent>
            <TabsContent value="documentos">
              <DocumentosSII mes={data.mes} pedidos={data.pedidos} sinPedido={data.documentos_sin_pedido} />
            </TabsContent>

            <TabsContent value="vendedores" className="space-y-4">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Vendedor</TableHead><TableHead className="text-right">Ventas</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead><TableHead className="text-right">Por cobrar</TableHead><TableHead className="text-right">Margen</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.por_vendedor.map((v) => (
                      <TableRow key={v.vendedor ?? 'sin'}>
                        <TableCell className="font-medium">{v.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.cantidad}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCLP(v.ventas_total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">{formatCLP(v.cobrado)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', Number(v.saldo_pendiente) > 0 && 'text-orange-600')}>{formatCLP(v.saldo_pendiente)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCLP(v.margen)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Plata recibida en el mes</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {data.recibido_por.length === 0 ? <p className="text-muted-foreground">Sin cobros registrados con fecha de este mes.</p> :
                    data.recibido_por.map((r) => (
                      <div key={r.nombre} className="flex justify-between"><span>{r.nombre}</span><span className="tabular-nums font-medium">{formatCLP(r.monto)}</span></div>
                    ))}
                  <p className="pt-2 text-xs text-muted-foreground">Incluye cobros de ventas de meses anteriores. Mientras no exista cuenta de la empresa, esta plata la tiene cada vendedor.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <DetallePedidoCierre pedido={pedidoAbierto} receptorPorDefecto={data.config.receptor_cobro} emision={data.config.emision}
            onClose={() => setSeleccionado(null)} />
          {dialog}
        </>
      )}
    </div>
  );
}

function CabeceraOrden({ campo, orden, onOrdenar, className, children }: {
  campo: CampoOrden; orden: { campo: CampoOrden; dir: 'asc' | 'desc' }; onOrdenar: (c: CampoOrden) => void;
  className?: string; children: React.ReactNode;
}) {
  const activo = orden.campo === campo;
  const Icono = !activo ? ArrowUpDown : orden.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onOrdenar(campo)}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', activo && 'text-foreground', className?.includes('justify-end') && 'justify-end')}>
        {children}<Icono className={cn('h-3 w-3', !activo && 'opacity-40')} />
      </button>
    </TableHead>
  );
}

function FilaPedido({ p, seleccionado, onSeleccionar, onClick }: {
  p: PedidoCierre; seleccionado: boolean; onSeleccionar: () => void; onClick: () => void;
}) {
  return (
    <TableRow className={cn('cursor-pointer', !p.declaracion.editable && 'opacity-60')}
      data-state={seleccionado && p.declaracion.editable ? 'selected' : undefined} onClick={onClick}>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox aria-label={`Declarar pedido #${p.id}`} checked={seleccionado && p.declaracion.editable}
          disabled={!p.declaracion.editable} onCheckedChange={onSeleccionar} />
      </TableCell>
      <TableCell>
        <p className="font-medium">#{p.id}</p>
        <p className="text-xs text-muted-foreground">{formatFecha(p.fecha)}</p>
        <Etiqueta {...ETIQUETA_DECLARACION[p.declaracion.estado]}
          texto={p.declaracion.estado === 'diferido' ? `Pasa a ${nombreMes(p.declaracion.mes)}`
            : p.declaracion.arrastrado ? `${ETIQUETA_DECLARACION[p.declaracion.estado].texto} · de ${nombreMes(p.fecha.slice(0, 7))}`
            : ETIQUETA_DECLARACION[p.declaracion.estado].texto} />
      </TableCell>
      <TableCell>
        <p className="font-medium flex items-center gap-1">
          {p.cliente.nombre}
          {p.alertas.length > 0 && <span title={p.alertas.join('\n')}><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span>}
        </p>
        <p className="text-xs text-muted-foreground capitalize">{p.cliente.tipo}</p>
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm">{p.vendedor?.nombre ?? '—'}</TableCell>
      <TableCell className="text-right tabular-nums font-medium">{formatCLP(p.total)}</TableCell>
      <TableCell className="text-right tabular-nums hidden lg:table-cell">
        {formatCLP(p.margen)}<span className="block text-xs text-muted-foreground">{p.margen_pct ?? 0}%</span>
      </TableCell>
      <TableCell>
        <Etiqueta {...ETIQUETA_COBRO[p.estado_cobro]} />
        {p.estado_cobro !== 'pagado' && <p className="text-xs text-muted-foreground tabular-nums mt-0.5">debe {formatCLP(p.saldo)}</p>}
      </TableCell>
      <TableCell>
        <Etiqueta {...ETIQUETA_TRIBUTARIO[p.estado_tributario]} />
        <p className="text-xs text-muted-foreground mt-0.5">
          {p.documentos.length ? p.documentos.map((d) => `${d.tipo === 33 ? 'F' : d.tipo === 39 ? 'B' : d.tipo} ${d.folio}`).join(', ') : `pidió ${p.documento_requerido.toLowerCase()}`}
        </p>
      </TableCell>
    </TableRow>
  );
}
