import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatCLP } from '@/lib/utils';
import { accionFacturaF29, type AccionFacturaF29 } from '@/services/api';

type Num = string | number;
interface Linea { cantidad: number; monto: Num }
interface FacturaCompra {
  id: string; numero: string; proveedor: string; fecha: string; iva: Num; anticipo: Num; total: Num;
  estado: 'considerada' | 'postergada' | 'excluida'; mes_f29: string; de_otro_mes: boolean; en_rcv: boolean;
}
export interface F29 {
  debitos: {
    facturas: Linea; boletas: Linea; notas_debito: Linea; notas_credito: Linea; total: Num;
    pedidos_declarados: number; pedidos_sin_documento: number[]; documentos_no_declarados: { cantidad: number; iva: Num };
  };
  creditos: { con_derecho: Num; exentas: Num; remanente_anterior: Num; facturas: Linea; notas_debito: Linea; notas_credito: Linea; total: Num };
  facturas_compra: FacturaCompra[];
  iva_determinado: Num; remanente_siguiente: Num;
  ppm: { base: Num; tasa: Num; tasa_confirmada: boolean; monto: Num };
  anticipo: { periodo: Num; sin_validar: Num; remanente_anterior: Num; total: Num; imputado: Num; remanente_siguiente: Num };
  otros_impuestos: Num; retenciones: Num; total_determinado: Num; total_a_pagar: Num;
}

const n = (v: Num) => Number(v) || 0;

function Seccion({ children }: { children: React.ReactNode }) {
  return <tr><th colSpan={4} className="bg-sky-100 dark:bg-sky-950 border px-3 py-1.5 text-center font-semibold">{children}</th></tr>;
}
function Sub({ children }: { children: React.ReactNode }) {
  return <tr><th colSpan={4} className="bg-sky-50 dark:bg-sky-950/50 border px-3 py-1 text-left font-semibold">{children}</th></tr>;
}
function Fila({ texto, codigo, monto, signo, total, nota }: { texto: string; codigo: string; monto: Num; signo?: string; total?: boolean; nota?: string }) {
  return <tr className={total ? 'bg-sky-50 dark:bg-sky-950/50 font-bold' : ''}>
    <td className="border px-3 py-1">{texto}{nota && <span className="block text-xs font-normal text-amber-700">{nota}</span>}</td>
    <td className="border px-3 py-1 text-center tabular-nums w-16">{codigo}</td>
    <td className="border px-3 py-1 text-right tabular-nums w-36">{formatCLP(monto)}</td>
    <td className="border px-2 py-1 text-center w-8">{signo}</td>
  </tr>;
}

/** Propuesta F29 con los mismos códigos que muestra el SII, para comparar línea a línea. */
export function PropuestaF29({ f29, mes }: { f29: F29; mes: string }) {
  const { debitos: d, creditos: c, anticipo: a } = f29;
  const qc = useQueryClient();
  const { toast } = useToast();
  const cambiar = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: AccionFacturaF29 }) => accionFacturaF29(id, accion, mes),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conciliacion'] }); qc.invalidateQueries({ queryKey: ['contabilidad'] }); },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast({ title: 'No se pudo actualizar la factura', description: e.response?.data?.error, variant: 'destructive' }),
  });
  const postergadas = f29.facturas_compra.filter((f) => f.estado === 'postergada').length;
  const excluidas = f29.facturas_compra.filter((f) => f.estado === 'excluida').length;
  const fuera = postergadas + excluidas;
  return <div className="rounded-lg border p-4 space-y-2">
    <h3 className="font-semibold">Propuesta F29 · para comparar con el SII</h3>
    <p className="text-xs text-muted-foreground">
      Débitos de los {d.pedidos_declarados} pedido(s) marcados como declarados en el cierre de ventas del mes.
      Créditos y anticipo con las compras registradas en el RCV del período.
    </p>
    {(d.pedidos_sin_documento.length > 0 || d.documentos_no_declarados.cantidad > 0) && <ul className="rounded bg-amber-500/10 p-2 pl-6 text-xs list-disc">
      {d.pedidos_sin_documento.length > 0 && <li>Declarados sin boleta ni factura (se usa su IVA teórico): {d.pedidos_sin_documento.map((id) => `#${id}`).join(', ')}</li>}
      {d.documentos_no_declarados.cantidad > 0 && <li>{d.documentos_no_declarados.cantidad} documento(s) de venta del SII del período no son de un pedido declarado este mes (IVA {formatCLP(d.documentos_no_declarados.iva)}): no se suman aquí, pero el SII sí los considera.</li>}
    </ul>}
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[520px]">
        <tbody>
          <Seccion>Débitos y ventas</Seccion>
          <Fila texto={`Facturas emitidas (${d.facturas.cantidad})`} codigo="502" monto={d.facturas.monto} signo="+" />
          {n(d.notas_debito.monto) !== 0 && <Fila texto={`Notas de débito emitidas (${d.notas_debito.cantidad})`} codigo="513" monto={d.notas_debito.monto} signo="+" />}
          {n(d.notas_credito.monto) !== 0 && <Fila texto={`Notas de crédito emitidas (${d.notas_credito.cantidad})`} codigo="510" monto={d.notas_credito.monto} signo="-" />}
          <Fila texto={`Boletas (${d.boletas.cantidad})`} codigo="111" monto={d.boletas.monto} signo="+" />
          <Fila texto="Total débitos" codigo="538" monto={d.total} signo="=" total />

          <Seccion>Créditos y compras</Seccion>
          <Fila texto="IVA documentos electrónicos recibidos con derecho a crédito" codigo="511" monto={c.con_derecho} />
          <Fila texto="Compras internas exentas o no gravadas (neto)" codigo="562" monto={c.exentas} />
          {n(c.remanente_anterior) !== 0 && <Fila texto="Remanente crédito fiscal mes anterior" codigo="504" monto={c.remanente_anterior} signo="+" />}
          <Fila texto={`Facturas recibidas del giro y de compra emitidas (${c.facturas.cantidad})`} codigo="520" monto={c.facturas.monto} signo="+" />
          {n(c.notas_debito.monto) !== 0 && <Fila texto={`Notas de débito recibidas (${c.notas_debito.cantidad})`} codigo="532" monto={c.notas_debito.monto} signo="+" />}
          {n(c.notas_credito.monto) !== 0 && <Fila texto={`Notas de crédito recibidas (${c.notas_credito.cantidad})`} codigo="528" monto={c.notas_credito.monto} signo="-" />}
          <Fila texto="Total créditos" codigo="537" monto={c.total} signo="=" total />
          {n(f29.remanente_siguiente) !== 0 && <Fila texto="Remanente de crédito fiscal para el período siguiente" codigo="77" monto={f29.remanente_siguiente} />}
          <Fila texto="IVA determinado" codigo="89" monto={f29.iva_determinado} signo="+" total />

          <Seccion>Impuestos a la renta D.L. 824/74</Seccion>
          <Fila texto={`PPM neto determinado · ${f29.ppm.tasa}% sobre ${formatCLP(f29.ppm.base)}`} codigo="62" monto={f29.ppm.monto} signo="+"
            nota={f29.ppm.tasa_confirmada ? undefined : 'Tasa de la configuración general: confírmala en los parámetros del período'} />

          <Seccion>Cambio de sujeto D.L. 825</Seccion>
          <Sub>Anticipo cambio de sujeto (contribuyentes retenidos)</Sub>
          <Fila texto="IVA anticipado del período" codigo="556" monto={a.periodo} signo="+"
            nota={n(a.sin_validar) ? `${formatCLP(a.sin_validar)} aún sin validar en la plataforma` : undefined} />
          {n(a.remanente_anterior) !== 0 && <Fila texto="Remanente anticipo mes anterior" codigo="—" monto={a.remanente_anterior} signo="+" />}
          <Fila texto="Total de anticipo" codigo="543" monto={a.total} signo="=" total />
          <Fila texto="Anticipo a imputar (tope IVA determinado)" codigo="598" monto={a.imputado} signo="-" total />
          {n(a.remanente_siguiente) !== 0 && <Fila texto="Remanente anticipo para el período siguiente" codigo="—" monto={a.remanente_siguiente} />}
          {n(f29.otros_impuestos) !== 0 && <Fila texto="Otros impuestos" codigo="—" monto={f29.otros_impuestos} signo="+" />}
          {n(f29.retenciones) !== 0 && <Fila texto="Retenciones" codigo="—" monto={f29.retenciones} signo="-" />}
          <Fila texto="Total determinado" codigo="547" monto={f29.total_determinado} signo="=" total />
        </tbody>
      </table>
    </div>
    <details className="rounded border p-3 text-sm" open={fuera > 0}>
      <summary className="cursor-pointer font-medium">
        Facturas de compra del mes ({f29.facturas_compra.length - fuera} consideradas
        {postergadas ? ` · ${postergadas} al mes siguiente` : ''}{excluidas ? ` · ${excluidas} no son de la empresa` : ''})
      </summary>
      <p className="text-xs text-muted-foreground my-2">
        Pasa al mes siguiente las que declararás después, y marca las que no son tuyas para que no se consideren.
        La factura no se borra ni cambia: solo se mueve su crédito y su anticipo en el F29.
      </p>
      <div className="space-y-1">
        {f29.facturas_compra.map((f) => <div key={f.id} className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 ${f.estado !== 'considerada' ? 'opacity-70' : ''}`}>
          <span>
            <span className={f.estado === 'excluida' ? 'line-through' : ''}>N° {f.numero} · {f.proveedor} · {f.fecha}</span>
            <span className="block text-xs text-muted-foreground">
              IVA {formatCLP(f.iva)}{n(f.anticipo) ? ` · Anticipo ${formatCLP(f.anticipo)}` : ''}{f.en_rcv ? ' · en RCV' : ''}
              {f.de_otro_mes && f.estado === 'considerada' && ' · viene de un mes anterior'}
            </span>
            {f.estado === 'postergada' && <span className="block text-xs text-amber-700">Se declara en {f.mes_f29}</span>}
            {f.estado === 'excluida' && <span className="block text-xs text-amber-700">No es de la empresa: no se considera</span>}
          </span>
          <span className="flex gap-1">
            {f.estado === 'considerada' ? <>
              <Button size="sm" variant="outline" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: f.id, accion: 'postergar' })}>Pasar al mes siguiente</Button>
              <Button size="sm" variant="outline" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: f.id, accion: 'excluir' })}>No es mía</Button>
            </> : <Button size="sm" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ id: f.id, accion: 'considerar' })}>Considerar este mes</Button>}
          </span>
        </div>)}
        {!f29.facturas_compra.length && <p className="text-xs text-muted-foreground">No hay facturas de compra en este mes.</p>}
      </div>
    </details>
    <div className="flex justify-between items-center rounded border-2 border-sky-300 bg-sky-50 dark:bg-sky-950/50 px-3 py-2 font-bold">
      <span>Total a pagar en plazo legal <span className="text-muted-foreground font-normal ml-2">91</span></span>
      <span className="tabular-nums text-lg">{formatCLP(f29.total_a_pagar)}</span>
    </div>
  </div>;
}
