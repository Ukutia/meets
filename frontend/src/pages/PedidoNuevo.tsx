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

  const agregarProducto = () => {
    if (!productoSeleccionado) return;
    const producto = productos.find((p) => p.id.toString() === productoSeleccionado);
    if (!producto) return;

    const stockDisponible = obtenerStockDisponible(producto);

    setDetalles((prev) => [
      ...prev,
      {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        kilos: 1,
        unidades: stockDisponible > 0 ? 1 : 0,
        precio_unitario: producto.precio_por_kilo,
        stock_disponible: stockDisponible,
        subtotal: producto.precio_por_kilo * 1,
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
                          {producto.nombre} - ${producto.precio_por_kilo.toFixed(2)}/kg
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
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Kilos</TableHead>
                        <TableHead>Unidades</TableHead>
                        <TableHead>Precio</TableHead>
                        <TableHead>Subtotal</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalles.map((detalle, index) => (
                        <TableRow key={detalle.producto_id}>
                          <TableCell className="font-medium">{detalle.producto_nombre}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                detalle.stock_disponible < 10 ? 'destructive' : 'outline'
                              }
                            >
                              {detalle.stock_disponible} unidades
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  actualizarDetalle(index, 'kilos', detalle.kilos - 1)
                                }
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                className="h-7 w-20 text-center"
                                value={detalle.kilos}
                                min={0}
                                onChange={(e) =>
                                  actualizarDetalle(index, 'kilos', Number(e.target.value))
                                }
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  actualizarDetalle(index, 'kilos', detalle.kilos + 1)
                                }
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  actualizarDetalle(index, 'unidades', detalle.unidades - 1)
                                }
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                className="h-7 w-20 text-center"
                                value={detalle.unidades}
                                min={0}
                                max={detalle.stock_disponible}
                                onChange={(e) =>
                                  actualizarDetalle(index, 'unidades', Number(e.target.value))
                                }
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() =>
                                  actualizarDetalle(index, 'unidades', detalle.unidades + 1)
                                }
                                disabled={detalle.unidades >= detalle.stock_disponible}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>${detalle.precio_unitario.toFixed(2)}</TableCell>
                          <TableCell className="font-semibold">
                            ${detalle.subtotal.toFixed(2)}
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
                      ))}
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
              <div className="rounded-lg border border-border bg-muted p-4 space-y-2">
                <p className="text-sm font-medium">Resumen del Pedido</p>
                {clienteSeleccionado && (
                  <div className="text-sm">
                    <p className="font-semibold">Cliente: {clienteSeleccionado.nombre}</p>
                    <p className="text-muted-foreground">
                      Vendedor: {clienteSeleccionado.vendedor.nombre}
                    </p>
                  </div>
                )}
                <p className="font-semibold">Total: ${total.toFixed(2)}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="observaciones">Observaciones</Label>
                <Textarea
                  id="observaciones"
                  placeholder="Notas adicionales para el pedido"
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
            <Button onClick={handleNext}>
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
