import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { ArrowDown, ArrowUp, Download, FileDown, Loader2, RotateCcw, Save, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { useToast } from '@/hooks/use-toast';
import { getPerfil, getStock, updateProducto, updateTelefonoPerfil } from '@/services/api';
import type { StockItem } from '@/types';
import { FlyerCanvas, FLYER_HEIGHT, FLYER_WIDTH, type FlyerFila } from '@/components/flyer/FlyerCanvas';

// Ajustes de cada usuario para su flyer (quedan en su navegador). El "c/u" y el peso
// fijo, en cambio, se guardan en el producto y valen para todos.
interface AjusteFila {
  incluir?: boolean;
  nombre?: string;
  precio?: string; // precio manual; vacío = usa el de la plataforma
}

interface ConfigFlyer {
  titulo1: string;
  titulo2: string;
  subtitulo: string;
  categoria: string;
  orden: number[];
  filas: Record<number, AjusteFila>;
}

const STORAGE_KEY = 'flyer-config-v1';
const CONFIG_INICIAL: ConfigFlyer = {
  titulo1: 'Carnes',
  titulo2: 'al vacio',
  subtitulo: 'Precios por Kilo',
  categoria: 'al vacio',
  orden: [],
  filas: {},
};

const leerConfig = (): ConfigFlyer => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...CONFIG_INICIAL, ...JSON.parse(raw) } : CONFIG_INICIAL;
  } catch {
    return CONFIG_INICIAL;
  }
};

const formatoPesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

const formatoKilos = (kg: number) => {
  const r = Math.round(kg * 10) / 10;
  return `${r.toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`;
};

// Peso promedio por pieza según lo que hay en bodega (kilos / unidades disponibles).
// Los productos por unidad no lo muestran salvo que tengan un peso fijo.
const pesoCalculado = (item: StockItem) =>
  !item.venta_por_unidad && item.disponibles > 0 && Number(item.kilos_actuales) > 0
    ? formatoKilos(Number(item.kilos_actuales) / Number(item.disponibles))
    : '';

const pesoFlyer = (item: StockItem) => item.peso_flyer?.trim() || pesoCalculado(item);

const disponibleParaVenta = (item: StockItem) => item.estado === 'disponible' && Number(item.disponibles) > 0;

export default function Flyer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pesosEditando, setPesosEditando] = useState<Record<number, string>>({});
  const flyerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ConfigFlyer>(leerConfig);
  const [telefono, setTelefono] = useState('');
  const [guardandoTel, setGuardandoTel] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [escala, setEscala] = useState(0.6);

  const { data: stock, isLoading, error } = useQuery({
    // Clave propia: el Dashboard guarda bajo ['stock'] la respuesta completa de axios, no la lista.
    // Sigue bajo el prefijo 'stock', así que los invalidateQueries(['stock']) también la refrescan.
    queryKey: ['stock', 'flyer'],
    queryFn: async () => {
      const response = await getStock();
      return Array.isArray(response.data) ? response.data : [];
    },
  });

  const { data: perfil } = useQuery({
    queryKey: ['perfil'],
    queryFn: async () => (await getPerfil()).data,
  });

  useEffect(() => {
    if (perfil) setTelefono(perfil.telefono || '');
  }, [perfil]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* sin almacenamiento: la config solo dura la sesión */
    }
  }, [config]);

  // Ajusta la vista previa al ancho disponible.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setEscala(Math.min(1, entry.contentRect.width / FLYER_WIDTH)));
    obs.observe(el);
    return () => obs.disconnect();
  }, [isLoading]);

  const productos = useMemo(() => {
    const lista = (stock ?? []).filter(
      (p) => config.categoria === 'todas' || (p.categoria ?? '') === config.categoria
    );
    const pos = (id: number) => {
      const i = config.orden.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...lista].sort((a, b) => pos(a.id) - pos(b.id) || b.precio_por_kilo - a.precio_por_kilo);
  }, [stock, config.categoria, config.orden]);

  const incluido = (item: StockItem) => config.filas[item.id]?.incluir ?? disponibleParaVenta(item);

  const filas: FlyerFila[] = productos.filter(incluido).map((item) => {
    const a = config.filas[item.id] ?? {};
    const base = a.precio?.trim() ? a.precio.trim() : formatoPesos(Number(item.precio_por_kilo));
    return {
      id: item.id,
      nombre: a.nombre?.trim() || item.producto,
      precio: item.venta_por_unidad ? `${base} c/u` : base,
      peso: pesosEditando[item.id] ?? pesoFlyer(item),
    };
  });

  const ajustar = (id: number, cambios: AjusteFila) =>
    setConfig((c) => ({ ...c, filas: { ...c.filas, [id]: { ...c.filas[id], ...cambios } } }));

  // Guarda en el producto (para todos los usuarios) y actualiza la lista sin recargar.
  const guardarEnProducto = async (item: StockItem, cambios: { venta_por_unidad?: boolean; peso_flyer?: string }) => {
    const actualizar = (valores: Partial<StockItem>) =>
      queryClient.setQueryData<StockItem[]>(['stock', 'flyer'], (lista) =>
        lista?.map((p) => (p.id === item.id ? { ...p, ...valores } : p))
      );
    actualizar(cambios);
    try {
      await updateProducto(item.id, cambios);
    } catch {
      actualizar({ venta_por_unidad: item.venta_por_unidad, peso_flyer: item.peso_flyer });
      toast({ title: 'Error', description: `No se pudo guardar ${item.producto}`, variant: 'destructive' });
    }
  };

  const guardarPeso = (item: StockItem) => {
    const texto = pesosEditando[item.id];
    if (texto === undefined) return;
    setPesosEditando(({ [item.id]: _, ...resto }) => resto);
    // Si el texto coincide con el calculado no se fija: así sigue actualizándose con el stock.
    const nuevo = texto.trim() === pesoCalculado(item) ? '' : texto.trim();
    if (nuevo !== (item.peso_flyer ?? '')) guardarEnProducto(item, { peso_flyer: nuevo });
  };

  const mover = (id: number, dir: -1 | 1) => {
    const ids = productos.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setConfig((c) => ({ ...c, orden: [...ids, ...c.orden.filter((x) => !ids.includes(x))] }));
  };

  const guardarTelefono = async () => {
    setGuardandoTel(true);
    try {
      await updateTelefonoPerfil(telefono);
      toast({ title: 'Teléfono guardado', description: 'Se usará por defecto en tus próximos flyers' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'No se pudo guardar el teléfono', variant: 'destructive' });
    } finally {
      setGuardandoTel(false);
    }
  };

  const generarPng = async () => {
    if (!flyerRef.current) throw new Error('Flyer no disponible');
    await document.fonts.ready;
    return toPng(flyerRef.current, { pixelRatio: 3, cacheBust: true });
  };

  const nombreArchivo = `flyer-${new Date().toISOString().slice(0, 10)}`;

  const exportar = async (tipo: 'png' | 'pdf' | 'compartir') => {
    setExportando(true);
    try {
      const dataUrl = await generarPng();
      if (tipo === 'png') {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${nombreArchivo}.png`;
        a.click();
      } else if (tipo === 'pdf') {
        const pdf = new jsPDF({ unit: 'px', format: [FLYER_WIDTH, FLYER_HEIGHT], hotfixes: ['px_scaling'] });
        pdf.addImage(dataUrl, 'PNG', 0, 0, FLYER_WIDTH, FLYER_HEIGHT);
        pdf.save(`${nombreArchivo}.pdf`);
      } else {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], `${nombreArchivo}.png`, { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
        } else {
          toast({ title: 'No disponible', description: 'Tu navegador no permite compartir archivos; descarga el PNG.' });
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        toast({ title: 'Error', description: 'No se pudo generar el flyer', variant: 'destructive' });
      }
    } finally {
      setExportando(false);
    }
  };

  const sinFilas = exportando || filas.length === 0;

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los productos" />;

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flyer de precios</h1>
          <p className="text-muted-foreground">Se arma con los productos y precios actuales de la plataforma.</p>
        </div>
        <div className="hidden flex-wrap gap-2 sm:flex">
          <Button onClick={() => exportar('png')} disabled={sinFilas}>
            {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Descargar PNG
          </Button>
          <Button variant="outline" onClick={() => exportar('pdf')} disabled={sinFilas}>
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" onClick={() => exportar('compartir')} disabled={sinFilas}>
            <Share2 className="mr-2 h-4 w-4" /> Compartir
          </Button>
        </div>
      </div>

      {/* En teléfono: compartir (WhatsApp, etc.) es la acción principal */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <Button className="flex-1" onClick={() => exportar('compartir')} disabled={sinFilas}>
          {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
          Compartir
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => exportar('png')} disabled={sinFilas}>
          <Download className="mr-2 h-4 w-4" /> Descargar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Datos del flyer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t1">Título (línea 1)</Label>
                <Input id="t1" value={config.titulo1} onChange={(e) => setConfig({ ...config, titulo1: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t2">Título (línea 2)</Label>
                <Input id="t2" value={config.titulo2} onChange={(e) => setConfig({ ...config, titulo2: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub">Subtítulo</Label>
                <Input id="sub" value={config.subtitulo} onChange={(e) => setConfig({ ...config, subtitulo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={config.categoria} onValueChange={(v) => setConfig({ ...config, categoria: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="al vacio">Al vacío</SelectItem>
                    <SelectItem value="congelado">Congelado</SelectItem>
                    <SelectItem value="todas">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tel">Teléfono</Label>
                <div className="flex gap-2">
                  <Input id="tel" placeholder="+56 9 1234 5678" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                  {perfil?.tiene_vendedor && (
                    <Button variant="outline" onClick={guardarTelefono} disabled={guardandoTel || telefono === (perfil.telefono || '')}>
                      {guardandoTel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span className="ml-2 hidden sm:inline">Guardar como mío</span>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">
                Cortes <span className="text-sm font-normal text-muted-foreground">({filas.length} en el flyer)</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfig((c) => ({ ...c, filas: {}, orden: [] }))}
                title="Volver a los valores de la plataforma"
              >
                <RotateCcw className="mr-1 h-4 w-4" /> Restablecer
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {productos.length === 0 && <p className="text-sm text-muted-foreground">No hay productos en esta categoría.</p>}
              {productos.map((item, i) => {
                const a = config.filas[item.id] ?? {};
                const activo = incluido(item);
                return (
                  <div key={item.id} className={`rounded-lg border p-3 ${activo ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`inc-${item.id}`}
                        checked={activo}
                        onCheckedChange={(v) => ajustar(item.id, { incluir: v === true })}
                      />
                      <label htmlFor={`inc-${item.id}`} className="min-w-0 flex-1 cursor-pointer font-medium">
                        {item.producto}
                        <span className="block text-sm font-normal text-muted-foreground sm:ml-2 sm:inline">
                          {formatoPesos(Number(item.precio_por_kilo))}/kg · {item.disponibles} u.
                        </span>
                      </label>
                      {!disponibleParaVenta(item) && <Badge variant="secondary">Sin stock</Badge>}
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 sm:h-7 sm:w-7" disabled={i === 0} onClick={() => mover(item.id, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 sm:h-7 sm:w-7"
                        disabled={i === productos.length - 1}
                        onClick={() => mover(item.id, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    {activo && (
                      <div className="mt-3 grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <Input
                          placeholder={item.producto}
                          value={a.nombre ?? ''}
                          onChange={(e) => ajustar(item.id, { nombre: e.target.value })}
                          aria-label="Nombre en el flyer"
                        />
                        <Input
                          placeholder={formatoPesos(Number(item.precio_por_kilo))}
                          value={a.precio ?? ''}
                          onChange={(e) => ajustar(item.id, { precio: e.target.value })}
                          aria-label="Precio en el flyer"
                        />
                        <Input
                          placeholder={pesoCalculado(item) || 'Peso por pieza'}
                          value={pesosEditando[item.id] ?? item.peso_flyer ?? ''}
                          onChange={(e) => setPesosEditando((p) => ({ ...p, [item.id]: e.target.value }))}
                          onBlur={() => guardarPeso(item)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          aria-label="Peso aproximado por pieza"
                          title="Se guarda en el producto. Vacío = se calcula desde el stock"
                        />
                        <label className="flex items-center gap-2 text-sm whitespace-nowrap" title="Se guarda en el producto">
                          <Switch
                            checked={!!item.venta_por_unidad}
                            onCheckedChange={(v) => guardarEnProducto(item, { venta_por_unidad: v })}
                          />
                          c/u
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="order-first lg:order-none lg:sticky lg:top-4 lg:self-start">
          <div ref={previewRef} className="w-full">
            <div
              className="overflow-hidden rounded-lg shadow-lg"
              style={{ width: FLYER_WIDTH * escala, height: FLYER_HEIGHT * escala }}
            >
              <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
                <FlyerCanvas
                  ref={flyerRef}
                  titulo1={config.titulo1}
                  titulo2={config.titulo2}
                  subtitulo={config.subtitulo}
                  telefono={telefono}
                  filas={filas}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
