import { useState } from 'react';
import { Plus, Search, Eye, XCircle, Check } from 'lucide-react';
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

interface Pedido {
  id: number;
  cliente_nombre: string;
  vendedor_nombre: string;
  fecha: string;
  estado: 'Reservado' | 'Preparado' | 'Entregado' | 'Cancelado';
  total: number;
}

export default function Pedidos() {
  const [search, setSearch] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('todos');
  const navigate = useNavigate();

  // Mock data
  const pedidos: Pedido[] = [
    {
      id: 1001,
      cliente_nombre: 'Restaurante El Gaucho',
      vendedor_nombre: 'Juan Pérez',
      fecha: '2025-01-15',
      estado: 'Preparado',
      total: 1250.5,
    },
    {
      id: 1002,
      cliente_nombre: 'Parrilla Don José',
      vendedor_nombre: 'María García',
      fecha: '2025-01-15',
      estado: 'Reservado',
      total: 890.0,
    },
    {
      id: 1003,
      cliente_nombre: 'Supermercado La Esquina',
      vendedor_nombre: 'Juan Pérez',
      fecha: '2025-01-14',
      estado: 'Entregado',
      total: 2150.75,
    },
  ];

  const filteredPedidos = pedidos.filter((p) => {
    const matchesSearch = p.cliente_nombre.toLowerCase().includes(search.toLowerCase()) ||
                         p.id.toString().includes(search);
    const matchesEstado = estadoFilter === 'todos' || p.estado === estadoFilter;
    return matchesSearch && matchesEstado;
  });

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      Reservado: 'secondary',
      Preparado: 'default',
      Entregado: 'outline',
      Cancelado: 'destructive',
    };
    return <Badge variant={variants[estado] || 'default'}>{estado}</Badge>;
  };

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
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="Reservado">Reservado</SelectItem>
            <SelectItem value="Preparado">Preparado</SelectItem>
            <SelectItem value="Entregado">Entregado</SelectItem>
            <SelectItem value="Cancelado">Cancelado</SelectItem>
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
                <TableCell>{pedido.cliente_nombre}</TableCell>
                <TableCell>{pedido.vendedor_nombre}</TableCell>
                <TableCell>{new Date(pedido.fecha).toLocaleDateString('es-AR')}</TableCell>
                <TableCell>{getEstadoBadge(pedido.estado)}</TableCell>
                <TableCell className="font-semibold">${pedido.total.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" title="Ver detalles">
                      <Eye className="h-4 w-4" />
                    </Button>
                    {pedido.estado === 'Reservado' && (
                      <Button variant="ghost" size="icon" title="Marcar como preparado">
                        <Check className="h-4 w-4 text-success" />
                      </Button>
                    )}
                    {pedido.estado !== 'Cancelado' && pedido.estado !== 'Entregado' && (
                      <Button variant="ghost" size="icon" title="Cancelar pedido">
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
