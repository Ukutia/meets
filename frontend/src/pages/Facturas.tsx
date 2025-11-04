import { useMemo, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { getFacturas } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Factura } from '@/types';

export default function Facturas() {
  const [search, setSearch] = useState('');
  const [pagoFilter, setPagoFilter] = useState<'todas' | 'pagadas' | 'pendientes'>('todas');

  const { data, isLoading, error } = useQuery({
    queryKey: ['facturas'],
    queryFn: async () => {
      const response = await getFacturas();
      return response.data as Factura[];
    },
  });

  const facturas = data ?? [];

  const facturasConPago = useMemo(() => {
    return facturas.map((factura) => ({
      ...factura,
      pagado: Boolean(factura.pago_factura),
    }));
  }, [facturas]);

  const filteredFacturas = useMemo(() => {
    return facturasConPago.filter((factura) => {
      const matchesSearch =
        factura.proveedor.toLowerCase().includes(search.toLowerCase()) ||
        factura.numero_factura.toLowerCase().includes(search.toLowerCase());
      const matchesPago =
        pagoFilter === 'todas' ||
        (pagoFilter === 'pagadas' && factura.pagado) ||
        (pagoFilter === 'pendientes' && !factura.pagado);
      return matchesSearch && matchesPago;
    });
  }, [facturasConPago, pagoFilter, search]);

  const totalPagado = filteredFacturas
    .filter((f) => f.pagado)
    .reduce((sum, f) => sum + Number(f.total || 0), 0);

  const totalPendiente = filteredFacturas
    .filter((f) => !f.pagado)
    .reduce((sum, f) => sum + Number(f.total || 0), 0);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="No se pudieron cargar las facturas" />;
  }

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
            placeholder="Buscar por proveedor o número de factura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={pagoFilter} onValueChange={(value) => setPagoFilter(value as any)}>
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
          <Card key={factura.numero_factura} className={factura.pagado ? '' : 'border-warning/30'}>
            <CardContent className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">Factura #{factura.numero_factura}</h3>
                    <Badge variant={factura.pagado ? 'outline' : 'secondary'}>
                      {factura.pagado ? 'Pagada' : 'Pendiente'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{factura.proveedor}</p>
                  <p className="text-xs text-muted-foreground">
                    Fecha: {new Date(factura.fecha).toLocaleDateString('es-AR')}
                  </p>
                  {factura.pagado && factura.pago_factura && (
                    <p className="text-xs text-success">
                      Pagado el {new Date(factura.pago_factura.fecha_de_pago).toLocaleDateString('es-AR')} por ${factura.pago_factura.monto_del_pago.toFixed(2)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <p className="text-2xl font-bold">${Number(factura.total).toFixed(2)}</p>
                  {!factura.pagado && (
                    <Button size="sm" variant="outline" disabled>
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
