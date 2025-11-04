import { useMemo, useState } from 'react';
import { Plus, Search, Eye, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelarPedido, getPedidos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Pedido } from '@/types';
import { useToast } from '@/hooks/use-toast';

export default function Pedidos() {
  const [search, setSearch] = useState('');
  const [estadoFilter, setEstadoFilter] = useState<'todos' | Pedido['estado']>('todos');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pedidos'],
    queryFn: async () => {
      const response = await getPedidos();
      return response.data as Pedido[];
    },
  });

  const pedidos = data ?? [];

  const cancelarMutation = useMutation({
    mutationFn: (pedidoId: number) => cancelarPedido(pedidoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({
        title: 'Pedido cancelado',
        description: 'El pedido ha sido marcado como anulado.',
      });
    },
    onError: () => {
      toast({
        title: 'No se pudo cancelar el pedido',
        description: 'Intente nuevamente en unos minutos.',
        variant: 'destructive',
      });
    },
  });

  const filteredPedidos = useMemo(() => {
    return pedidos.filter((pedido) => {
      const matchesSearch =
        pedido.cliente.nombre.toLowerCase().includes(search.toLowerCase()) ||
        pedido.id.toString().includes(search);
      const matchesEstado = estadoFilter === 'todos' || pedido.estado === estadoFilter;
      return matchesSearch && matchesEstado;
    });
  }, [pedidos, search, estadoFilter]);

  const getEstadoBadge = (estado: Pedido['estado']) => {
    const variants: Record<Pedido['estado'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
      Reservado: 'secondary',
      Preparado: 'default',
      Pagado: 'outline',
      Anulado: 'destructive',
    };
    return <Badge variant={variants[estado] || 'default'}>{estado}</Badge>;
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="No se pudieron cargar los pedidos" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground">
            Gestión completa del flujo de pedidos
          </p>
        </div>
        <Button onClick={() => navigate('/pedidos/nuevo')}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Pedido
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente o número de pedido..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={estadoFilter} onValueChange={(value) => setEstadoFilter(value as any)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="Reservado">Reservado</SelectItem>
            <SelectItem value="Preparado">Preparado</SelectItem>
            <SelectItem value="Pagado">Pagado</SelectItem>
            <SelectItem value="Anulado">Anulado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N° Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPedidos.map((pedido) => (
              <TableRow key={pedido.id}>
                <TableCell className="font-medium">#{pedido.id}</TableCell>
                <TableCell>{pedido.cliente.nombre}</TableCell>
                <TableCell>{pedido.vendedor?.nombre ?? 'Sin vendedor'}</TableCell>
                <TableCell>{new Date(pedido.fecha).toLocaleDateString('es-AR')}</TableCell>
                <TableCell>{getEstadoBadge(pedido.estado)}</TableCell>
                <TableCell className="font-semibold">${pedido.total.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" title="Ver detalles">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {pedido.estado !== 'Anulado' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Cancelar pedido"
                        onClick={() => cancelarMutation.mutate(pedido.id)}
                        disabled={cancelarMutation.isPending}
                      >
                        <XCircle className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
