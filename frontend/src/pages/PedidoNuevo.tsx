import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Plus, Minus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPedido, getClientes, getProductos, getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Cliente, Producto, StockItem } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface DetalleProducto {
  producto_id: number;
  producto_nombre: string;
  kilos: number;
  unidades: number;
  precio_unitario: number;
  stock_disponible: number;
  subtotal: number;
}

export default function PedidoNuevo() {
  const [step, setStep] = useState(1);
  const [clienteId, setClienteId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [detalles, setDetalles] = useState<DetalleProducto[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Función de ayuda para asegurar que tratamos con números
  const formatNumber = (val: any) => {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  };

  const { data: clientesData, isLoading: loadingClientes, error: errorClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const response = await getClientes();
      return response.data as Cliente[];
    },
  });

  const { data: productosData, isLoading: loadingProductos, error: errorProductos } = useQuery({
    queryKey: ['productos'],
    queryFn: async () => {
      const response = await getProductos();
      return response.data as Producto[];
    },
  });

  const { data: stockData, isLoading: loadingStock, error: errorStock } = useQuery({
    queryKey: ['stock'],
    queryFn: async () => {
      const response = await getStock();
      return response.data as StockItem[];
    },
  });

  const clientes = clientesData ?? [];
  const productos = productosData ?? [];
  const stock = stockData ?? [];

  const clienteSeleccionado = useMemo(
    () => clientes.find((cliente) => cliente.id.toString() === clienteId),
    [clientes, clienteId]
  );

  const productosDisponibles = useMemo(() => {
    return productos.filter((producto) =>
      !detalles.some((detalle) => detalle.producto_id === producto.id)
    );
  }, [productos, detalles]);

  const obtenerStockDisponible = (producto: Producto) => {
    const stockProducto = stock.find((item) => item.producto === producto.nombre);
    return stockProducto?.disponibles ?? 0;
  };


const validarPesosMinimos = () => {
    for (const d of detalles) {
      // @ts-ignore
      const min = d.peso_minimo || 0;
      if (d.unidades > 0 && d.kilos > 0) {
        const promedio = d.kilos / d.unidades;
        if (promedio < min) {
          toast({
            title: "Peso inconsistente",
            description: `El producto ${d.producto_nombre} promedia ${promedio.toFixed(3)}kg por unidad. El mínimo permitido es ${min}kg.`,
            variant: "destructive",
          });
          return false;
        }
      }
    }
    return true;
};

const agregarProducto = () => {
    if (!productoSeleccionado) return;
    const producto = productos.find((p) => p.id.toString() === productoSeleccionado);
    if (!producto) return;

    const stockDisponible = obtenerStockDisponible(producto);
    const precio = formatNumber(producto.precio_por_kilo);

    setDetalles((prev) => [
      ...prev,
      {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        kilos: 0, // Empezamos en 0 para obligar a pesar
        unidades: stockDisponible > 0 ? 1 : 0,
        precio_unitario: precio,
        stock_disponible: stockDisponible,
        subtotal: 0,
        // @ts-ignore - agregamos esto para la validación
        peso_minimo: Number(producto.peso_minimo) || 0 
      },
    ]);
    setProductoSeleccionado('');
};

  const actualizarDetalle = (
    index: number,
    field: 'kilos' | 'unidades',
    value: number
  ) => {
    setDetalles((prev) => {
      const nuevos = [...prev];
      const detalle = { ...nuevos[index] };
      const nuevoValor = Math.max(0, value);

      if (field === 'unidades') {
        detalle.unidades = Math.min(detalle.stock_disponible, nuevoValor);
        // Si no hay unidades, los kilos deberían ser 0 (opcional según lógica de negocio)
        if (detalle.unidades === 0) {
          detalle.kilos = 0;
        }
      } else {
        detalle.kilos = nuevoValor;
      }

      detalle.subtotal = detalle.kilos * detalle.precio_unitario;
      nuevos[index] = detalle;
      return nuevos;
    });
  };

  const eliminarDetalle = (index: number) => {
    setDetalles((prev) => prev.filter((_, i) => i !== index));
  };

  const total = detalles.reduce((sum, d) => sum + d.subtotal, 0);

  const pedidoMutation = useMutation({
    mutationFn: () => {
      if (!clienteSeleccionado) {
        throw new Error('Debe seleccionar un cliente');
      }
      if (detalles.length === 0) {
        throw new Error('Debe agregar al menos un producto');
      }
      if (!validarPesosMinimos()) {
         throw new Error('Hay productos con peso insuficiente');
      }
      return createPedido({
        cliente: clienteSeleccionado.id,
        vendedor: clienteSeleccionado.vendedor.id,
        detalles: detalles.map((detalle) => ({
          producto: detalle.producto_id,
          cantidad_kilos: detalle.kilos,
          cantidad_unidades: detalle.unidades,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({
        title: 'Pedido creado',
        description: 'El pedido se registró correctamente.',
      });
      navigate('/pedidos');
    },
    onError: (error: any) => {
      toast({
        title: 'No se pudo crear el pedido',
        description: error?.message || 'Verifique la información e intente nuevamente.',
        variant: 'destructive',
      });
    },
  });

  const tieneErroresDePeso = detalles.some(d => {
  // @ts-ignore
  const min = d.peso_minimo || 0;
  return d.unidades > 0 && d.kilos > 0 && (d.kilos / d.unidades) < min;
  });

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Paso 1: Seleccionar Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientes.map((cliente) => (
                      <SelectItem key={cliente.id} value={cliente.id.toString()}>
                        {cliente.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {clienteSeleccionado && (
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm font-medium">Vendedor Asignado</p>
                  <p className="text-lg font-semibold text-primary">
                    {clienteSeleccionado.vendedor.nombre} ({clienteSeleccionado.vendedor.sigla})
                  </p>
                  {clienteSeleccionado.direccion && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Dirección: {clienteSeleccionado.direccion}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );

case 2:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Paso 2: Agregar Productos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={productoSeleccionado} onValueChange={setProductoSeleccionado}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {productosDisponibles.map((producto) => (
                        <SelectItem key={producto.id} value={producto.id.toString()}>
                          {producto.nombre} - ${Number(producto.precio_por_kilo).toLocaleString('es-CL')}/kg
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={agregarProducto} disabled={!productoSeleccionado}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar
                </Button>
              </div>

              {detalles.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead className="text-center">Kilos</TableHead>
                        <TableHead className="text-center">Unidades</TableHead>
                        <TableHead>Precio</TableHead>
                        <TableHead>Subtotal</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalles.map((detalle, index) => {
                        // Lógica de validación visual
                        // @ts-ignore (por si el tipo DetalleProducto no tiene aún peso_minimo)
                        const minPeso = detalle.peso_minimo || 0;
                        const esPesoInvalido = detalle.unidades > 0 && 
                                             detalle.kilos > 0 && 
                                             (detalle.kilos / detalle.unidades) < minPeso;

                        return (
                          <TableRow 
                            key={detalle.producto_id}
                            className={esPesoInvalido ? "bg-red-50/50 transition-colors" : ""}
                          >
                            <TableCell className="font-medium">
                              {detalle.producto_nombre}
                              {esPesoInvalido && (
                                <p className="text-[10px] font-bold text-red-600 animate-pulse">
                                  PESO BAJO EL MÍNIMO ({minPeso}kg)
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={detalle.stock_disponible < 5 ? 'destructive' : 'secondary'}
                                className="font-mono"
                              >
                                {detalle.stock_disponible}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-2">
                                <Input
                                  type="number"
                                  step="any"
                                  // Si el peso es inválido, aplicamos bordes rojos
                                  className={`h-8 w-24 text-center ${
                                    esPesoInvalido 
                                      ? "border-destructive ring-destructive focus-visible:ring-destructive" 
                                      : ""
                                  }`}
                                  value={detalle.kilos === 0 ? '' : detalle.kilos}
                                  onChange={(e) => actualizarDetalle(index, 'kilos', Number(e.target.value))}
                                  onFocus={(e) => e.target.select()}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => actualizarDetalle(index, 'unidades', detalle.unidades - 1)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-8 text-center font-bold">{detalle.unidades}</span>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => actualizarDetalle(index, 'unidades', detalle.unidades + 1)}
                                  disabled={detalle.unidades >= detalle.stock_disponible}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell>${detalle.precio_unitario.toLocaleString('es-CL')}</TableCell>
                            <TableCell className="font-bold text-primary">
                              ${detalle.subtotal.toLocaleString('es-CL')}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => eliminarDetalle(index)}
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case 3:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Paso 3: Revisar y Confirmar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-xs uppercase text-muted-foreground font-bold">Cliente</p>
                  <p className="text-lg font-bold">{clienteSeleccionado?.nombre}</p>
                  <p className="text-sm">{clienteSeleccionado?.direccion}</p>
                </div>
                <div className="rounded-lg border p-4 bg-primary/5 border-primary/20">
                  <p className="text-xs uppercase text-primary font-bold">Total a Pagar</p>
                  <p className="text-3xl font-black text-primary">
                    ${total.toLocaleString('es-CL')}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="observaciones">Observaciones / Notas de Entrega</Label>
                <Textarea
                  id="observaciones"
                  placeholder="Ej: Entregar después de las 15:00, portón azul..."
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  const handleNext = () => {
    if (step === 1 && !clienteId) {
      toast({
        title: 'Seleccione un cliente',
        description: 'Debe elegir un cliente antes de continuar.',
        variant: 'destructive',
      });
      return;
    }
    if (step === 2 && detalles.length === 0) {
      toast({
        title: 'Agregue productos',
        description: 'Debe agregar al menos un producto al pedido.',
        variant: 'destructive',
      });
      return;
    }
    if (!validarPesosMinimos()) return;
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handlePrev = () => setStep((prev) => Math.max(prev - 1, 1));

  if (loadingClientes || loadingProductos || loadingStock) {
    return <LoadingSpinner />;
  }

  if (errorClientes || errorProductos || errorStock) {
    return <ErrorMessage message="No se pudo cargar la información necesaria" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nuevo Pedido</h1>
          <p className="text-muted-foreground">
            Complete los pasos para registrar un nuevo pedido
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={step === 1 ? 'default' : 'outline'}>1</Badge>
            <span>Cliente</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={step === 2 ? 'default' : 'outline'}>2</Badge>
            <span>Productos</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={step === 3 ? 'default' : 'outline'}>3</Badge>
            <span>Resumen</span>
          </div>
        </div>

        {renderStep()}

        <div className="flex justify-between">
          <Button variant="outline" onClick={handlePrev} disabled={step === 1}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Anterior
          </Button>
          {step < 3 ? (
<Button 
    onClick={handleNext} 
    disabled={step === 2 && (detalles.length === 0 || tieneErroresDePeso)}
    className={tieneErroresDePeso ? "opacity-50 cursor-not-allowed" : ""}
  >
    Siguiente
    <ArrowRight className="ml-2 h-4 w-4" />
  </Button>
          ) : (
            <Button
              onClick={() => pedidoMutation.mutate()}
              disabled={pedidoMutation.isPending}
            >
              {pedidoMutation.isPending ? 'Registrando...' : 'Confirmar Pedido'}
              <Check className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
