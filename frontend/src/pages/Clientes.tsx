import { useMemo, useState } from 'react';
import { Plus, Search, Pencil } from 'lucide-react'; // Añadido Pencil
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { getClientes } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import { ClienteFormDialog, formatSimplePhone } from '@/components/shared/ClienteFormDialog';
import type { Cliente } from '@/types';

const getVendedorColor = (sigla: string) => {
  const colors: Record<string, string> = {
    // Puedes mapear siglas específicas a colores fijos
    'JS': 'bg-blue-100 text-blue-700 border-blue-200',
    'MA': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'CP': 'bg-amber-100 text-amber-700 border-amber-200',
    'LG': 'bg-purple-100 text-purple-700 border-purple-200',
    'RA': 'bg-rose-100 text-rose-700 border-rose-200',
  };

  // Si la sigla no está en la lista, asigna un color por defecto o genera uno basado en el texto
  return colors[sigla.toUpperCase()] || 'bg-slate-100 text-slate-700 border-slate-200';
};

export default function Clientes() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null); // Estado para edición

  const { data: clientesData, isLoading, error } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const response = await getClientes();
      return response.data;
    },
  });

  // Busca estas líneas y cámbialas por esto:
  const clientes = Array.isArray(clientesData) ? clientesData : (clientesData as any)?.results ?? [];

  const handleEditClick = (cliente: Cliente) => {
    setEditingCliente(cliente);
    setDialogOpen(true);
  };

  // --- FUNCIÓN PARA ABRIR NUEVO CLIENTE ---
  const handleNewClick = () => {
    setEditingCliente(null);
    setDialogOpen(true);
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter((c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase())
    );
  }, [clientes, search]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los clientes" />;

  return (
    <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground">Gestión de base de clientes y vendedores</p>
      </div>

      <Button onClick={handleNewClick}>
        <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
      </Button>

      <ClienteFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editingCliente ? 'edit' : 'create'}
        cliente={editingCliente}
      />
    </div>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar clientes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead className="w-[100px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.map((cliente) => (
              <TableRow key={cliente.id}>
                <TableCell className="font-medium">{cliente.nombre}</TableCell>
                <TableCell>{cliente.telefono ? formatSimplePhone(cliente.telefono) : '---'}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`font-bold ${getVendedorColor(cliente.vendedor.sigla)}`}
                  >
                    {cliente.vendedor.sigla}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => handleEditClick(cliente)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
