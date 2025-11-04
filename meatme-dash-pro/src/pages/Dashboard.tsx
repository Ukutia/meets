import { DollarSign, ShoppingCart, AlertCircle, TrendingUp, Plus, UserPlus } from 'lucide-react';
import { StatCard } from '@/components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { getStock } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { StockItem } from '@/types';

export default function Dashboard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { data: stockResponse, isLoading, error } = useQuery({
    queryKey: ['stock'],
    queryFn: getStock,
  });

  const stockData = stockResponse?.data as StockItem[] | undefined;

  // Mock data - replace with actual API calls
  const kpis = [
    {
      title: 'Ventas del Día',
      value: '$12,450',
      icon: DollarSign,
      trend: { value: 12, positive: true },
    },
    {
      title: 'Pedidos Pendientes',
      value: '8',
      icon: ShoppingCart,
      description: '3 Reservados, 5 Preparados',
    },
    {
      title: 'Stock Crítico',
      value: '3',
      icon: AlertCircle,
      description: 'Productos con bajo inventario',
    },
    {
      title: 'Ingresos del Mes',
      value: '$84,320',
      icon: TrendingUp,
      trend: { value: 8, positive: true },
    },
  ];

  const quickActions = [
    { label: 'Nuevo Pedido', action: () => navigate('/pedidos/nuevo'), variant: 'default' as const },
    { label: 'Ver Stock', action: () => navigate('/stock'), variant: 'outline' as const },
    { label: 'Facturas Pendientes', action: () => navigate('/facturas'), variant: 'outline' as const },
  ];

  // Vista móvil optimizada
  if (isMobile) {
    if (isLoading) return <LoadingSpinner />;
    if (error) return <ErrorMessage message="Error al cargar el stock" />;

    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <Button 
            size="lg" 
            className="flex-1 h-16 text-base"
            onClick={() => navigate('/pedidos/nuevo')}
          >
            <Plus className="mr-2 h-5 w-5" />
            Agregar Pedido
          </Button>
          <Button 
            size="lg" 
            variant="outline"
            className="flex-1 h-16 text-base"
            onClick={() => navigate('/clientes')}
          >
            <UserPlus className="mr-2 h-5 w-5" />
            Agregar Cliente
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stock Disponible</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stockData?.map((item) => (
                <div
                  key={item.producto}
                  className="flex items-center justify-between p-4 rounded-lg border border-border bg-card"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-base">{item.producto_nombre}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.categoria}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{item.stock_actual.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">kilos</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Vista desktop existente
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Resumen general de operaciones
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.title}
            title={kpi.title}
            value={kpi.value}
            icon={kpi.icon}
            trend={kpi.trend}
            description={kpi.description}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accesos Rápidos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              onClick={action.action}
            >
              {action.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pedidos Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">Pedido #{1000 + i}</p>
                    <p className="text-sm text-muted-foreground">
                      Cliente {i} - $1,{200 + i * 100}
                    </p>
                  </div>
                  <div className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                    Preparado
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Productos Destacados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {['Bife de Chorizo', 'Asado', 'Vacío'].map((product, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{product}</p>
                    <p className="text-sm text-muted-foreground">
                      Stock: {50 - i * 10} kg
                    </p>
                  </div>
                  <p className="font-semibold">${(8 + i).toFixed(2)}/kg</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
