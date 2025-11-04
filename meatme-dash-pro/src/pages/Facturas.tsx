import { useState } from 'react';
import { Search, DollarSign, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Factura {
  id: number;
  fecha: string;
  cliente_nombre: string;
  total: number;
  pagado: boolean;
  fecha_pago?: string;
  metodo_pago?: string;
}

export default function Facturas() {
  const [search, setSearch] = useState('');
  const [pagoFilter, setPagoFilter] = useState('todas');

  // Mock data
  const facturas: Factura[] = [
    {
      id: 5001,
      fecha: '2025-01-15',
      cliente_nombre: 'Restaurante El Gaucho',
      total: 1250.5,
      pagado: true,
      fecha_pago: '2025-01-15',
      metodo_pago: 'Transferencia',
    },
    {
      id: 5002,
      fecha: '2025-01-15',
      cliente_nombre: 'Parrilla Don José',
      total: 890.0,
      pagado: false,
    },
    {
      id: 5003,
      fecha: '2025-01-14',
      cliente_nombre: 'Supermercado La Esquina',
      total: 2150.75,
      pagado: true,
      fecha_pago: '2025-01-14',
      metodo_pago: 'Efectivo',
    },
    {
      id: 5004,
      fecha: '2025-01-14',
      cliente_nombre: 'Restaurante El Gaucho',
      total: 675.25,
      pagado: false,
    },
  ];

  const filteredFacturas = facturas.filter((f) => {
    const matchesSearch =
      f.cliente_nombre.toLowerCase().includes(search.toLowerCase()) ||
      f.id.toString().includes(search);
    const matchesPago =
      pagoFilter === 'todas' ||
      (pagoFilter === 'pagadas' && f.pagado) ||
      (pagoFilter === 'pendientes' && !f.pagado);
    return matchesSearch && matchesPago;
  });

  const totalPagado = filteredFacturas
    .filter((f) => f.pagado)
    .reduce((sum, f) => sum + f.total, 0);
  
  const totalPendiente = filteredFacturas
    .filter((f) => !f.pagado)
    .reduce((sum, f) => sum + f.total, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Facturas</h1>
        <p className="text-muted-foreground">
          Gestión de facturación y pagos
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-success/20 bg-success/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">${totalPagado.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-warning/20 bg-warning/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pendiente</CardTitle>
            <Clock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">${totalPendiente.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente o número de factura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={pagoFilter} onValueChange={setPagoFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar por pago" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="pagadas">Pagadas</SelectItem>
            <SelectItem value="pendientes">Pendientes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4">
        {filteredFacturas.map((factura) => (
          <Card key={factura.id} className={factura.pagado ? '' : 'border-warning/30'}>
            <CardContent className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">Factura #{factura.id}</h3>
                    <Badge variant={factura.pagado ? 'outline' : 'secondary'}>
                      {factura.pagado ? 'Pagada' : 'Pendiente'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{factura.cliente_nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    Fecha: {new Date(factura.fecha).toLocaleDateString('es-AR')}
                  </p>
                  {factura.pagado && factura.metodo_pago && (
                    <p className="text-xs text-success">
                      Pagado: {factura.metodo_pago} -{' '}
                      {factura.fecha_pago && new Date(factura.fecha_pago).toLocaleDateString('es-AR')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <p className="text-2xl font-bold">${factura.total.toFixed(2)}</p>
                  {!factura.pagado && (
                    <Button size="sm">
                      <DollarSign className="mr-2 h-4 w-4" />
                      Registrar Pago
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
