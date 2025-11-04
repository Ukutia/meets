import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Plus, Minus } from 'lucide-react';
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
  const [estado, setEstado] = useState('Reservado');
  const [observaciones, setObservaciones] = useState('');
  const [detalles, setDetalles] = useState<DetalleProducto[]>([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const navigate = useNavigate();

  // Mock data
  const clientes = [
    { id: 1, nombre: 'Restaurante El Gaucho', vendedor: 'Juan Pérez' },
    { id: 2, nombre: 'Parrilla Don José', vendedor: 'María García' },
    { id: 3, nombre: 'Supermercado La Esquina', vendedor: 'Juan Pérez' },
  ];

  const productos = [
    { id: 1, nombre: 'Bife de Chorizo', precio: 8.5, stock: 45 },
    { id: 2, nombre: 'Asado', precio: 6.2, stock: 32 },
    { id: 3, nombre: 'Vacío', precio: 7.8, stock: 8 },
    { id: 4, nombre: 'Matambre', precio: 5.9, stock: 15 },
  ];

  const clienteSeleccionado = clientes.find((c) => c.id.toString() === clienteId);

  const agregarProducto = () => {
    if (!productoSeleccionado) return;
    
    const producto = productos.find((p) => p.id.toString() === productoSeleccionado);
    if (!producto) return;

    const existe = detalles.find((d) => d.producto_id === producto.id);
    if (existe) return;

    setDetalles([
      ...detalles,
      {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        kilos: 1,
        unidades: 1,
        precio_unitario: producto.precio,
        stock_disponible: producto.stock,
        subtotal: producto.precio * 1,
      },
    ]);
    setProductoSeleccionado('');
  };

  const actualizarDetalle = (index: number, field: 'kilos' | 'unidades', value: number) => {
    const nuevosDetalles = [...detalles];
    nuevosDetalles[index][field] = Math.max(0, value);
    nuevosDetalles[index].subtotal =
      nuevosDetalles[index].kilos * nuevosDetalles[index].precio_unitario;
    setDetalles(nuevosDetalles);
  };

  const eliminarDetalle = (index: number) => {
    setDetalles(detalles.filter((_, i) => i !== index));
  };

  const total = detalles.reduce((sum, d) => sum + d.subtotal, 0);

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
                    {clienteSeleccionado.vendedor}
                  </p>
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
                      {productos
                        .filter((p) => !detalles.find((d) => d.producto_id === p.id))
                        .map((producto) => (
                          <SelectItem key={producto.id} value={producto.id.toString()}>
                            {producto.nombre} - ${producto.precio}/kg (Stock: {producto.stock} kg)
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
                        <TableRow key={index}>
                          <TableCell className="font-medium">{detalle.producto_nombre}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                detalle.stock_disponible < 10 ? 'destructive' : 'outline'
                              }
                            >
                              {detalle.stock_disponible} kg
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
                                value={detalle.kilos}
                                onChange={(e) =>
                                  actualizarDetalle(index, 'kilos', parseFloat(e.target.value))
                                }
                                className="h-7 w-16 text-center"
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
                            <Input
                              type="number"
                              value={detalle.unidades}
                              onChange={(e) =>
                                actualizarDetalle(index, 'unidades', parseInt(e.target.value))
                              }
                              className="h-7 w-16"
                            />
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
                              <Minus className="h-4 w-4 text-destructive" />
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
              <CardTitle>Paso 3: Resumen y Confirmación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted p-4">
                <h3 className="font-semibold mb-2">Información del Pedido</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Cliente:</span>{' '}
                    <span className="font-medium">{clienteSeleccionado?.nombre}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Vendedor:</span>{' '}
                    <span className="font-medium">{clienteSeleccionado?.vendedor}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Estado del Pedido</Label>
                <Select value={estado} onValueChange={setEstado}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Reservado">Reservado</SelectItem>
                    <SelectItem value="Preparado">Preparado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Observaciones (Opcional)</Label>
                <Textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas adicionales sobre el pedido..."
                />
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold mb-3">Productos</h3>
                <div className="space-y-2">
                  {detalles.map((detalle, index) => (
                    <div
                      key={index}
                      className="flex justify-between text-sm"
                    >
                      <span>
                        {detalle.producto_nombre} ({detalle.kilos} kg × ${detalle.precio_unitario})
                      </span>
                      <span className="font-medium">${detalle.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-between border-t border-border pt-4 text-lg font-bold">
                  <span>Total</span>
                  <span className="text-primary">${total.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  const canGoNext = () => {
    if (step === 1) return !!clienteId;
    if (step === 2) return detalles.length > 0;
    return true;
  };

  const handleConfirm = () => {
    // Here you would make the API call to create the order
    console.log('Creating order:', {
      cliente_id: clienteId,
      estado,
      observaciones,
      detalles,
      total,
    });
    navigate('/pedidos');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nuevo Pedido</h1>
          <p className="text-muted-foreground">
            Complete los siguientes pasos para crear un pedido
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/pedidos')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Cancelar
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                step >= s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s ? <Check className="h-5 w-5" /> : s}
            </div>
            {s < 3 && (
              <div
                className={`mx-2 h-1 w-16 ${
                  step > s ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {renderStep()}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Anterior
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canGoNext()}>
            Siguiente
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleConfirm}>
            <Check className="mr-2 h-4 w-4" />
            Confirmar Pedido
          </Button>
        )}
      </div>
    </div>
  );
}
