import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCliente, getClientes, getVendedores } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Vendedor } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ClienteForm {
  nombre: string;
  telefono?: string;
  direccion: string;
  email?: string;
  vendedor: string;
}

// Función para formatear: 9 XXXX XXXX
const formatSimplePhone = (value: string) => {
  // Solo números
  const digits = value.replace(/\D/g, '');
  
  if (!digits) return '';

  // Forzamos que el primer dígito sea siempre 9
  let formatted = '9';
  
  // Si el usuario escribió algo más después del 9
  const rest = digits.startsWith('9') ? digits.substring(1) : digits;

  if (rest.length > 0) {
    formatted += ' ' + rest.substring(0, 4);
  }
  if (rest.length > 4) {
    formatted += ' ' + rest.substring(4, 8);
  }

  return formatted;
};

export default function Clientes() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ClienteForm>({
    defaultValues: {
      nombre: '',
      telefono: '',
      direccion: '',
      email: '',
      vendedor: '',
    },
  });

  const { data: clientesData, isLoading, error } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const response = await getClientes();
      return response.data;
    },
  });

  const { data: vendedoresData } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const response = await getVendedores();
      return response.data;
    },
  });

  const clientes = clientesData ?? [];
  const vendedores = vendedoresData ?? [];

  const createMutation = useMutation({
    mutationFn: (values: ClienteForm) =>
      createCliente({
        nombre: values.nombre,
        direccion: values.direccion,
        // Limpiamos espacios antes de enviar al backend si es necesario
        telefono: values.telefono?.replace(/\s/g, ''), 
        email: values.email,
        vendedor: Number(values.vendedor),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast({
        title: 'Cliente creado',
        description: 'El cliente se registró correctamente.',
      });
      form.reset();
      setDialogOpen(false);
    },
    onError: () => {
      toast({
        title: 'Error al crear el cliente',
        description: 'Verifique la información ingresada.',
        variant: 'destructive',
      });
    },
  });

  const filteredClientes = useMemo(() => {
    return clientes.filter((c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase())
    );
  }, [clientes, search]);

  const handleSubmit = (values: ClienteForm) => {
    if (!values.vendedor) {
      toast({
        title: 'Seleccione un vendedor',
        description: 'Debe asignar un vendedor al cliente.',
        variant: 'destructive',
      });
      return;
    }
    createMutation.mutate(values);
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los clientes" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Gestión de base de clientes y vendedores asociados
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Nuevo Cliente</DialogTitle>
              <DialogDescription>Agregue un nuevo cliente al sistema</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nombre">Nombre / Razón Social</Label>
                <Input
                  id="nombre"
                  placeholder="Ej: Restaurante El Gaucho"
                  {...form.register('nombre', { required: true })}
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="telefono">Teléfono (9 XXXX XXXX)</Label>
                <Controller
                  name="telefono"
                  control={form.control}
                  render={({ field }) => (
                    <Input
                      id="telefono"
                      placeholder="9 1234 5678"
                      value={field.value}
                      onChange={(e) => {
                        const formatted = formatSimplePhone(e.target.value);
                        if (formatted.length <= 11) { // 9 + 2 espacios + 8 dígitos
                          field.onChange(formatted);
                        }
                      }}
                    />
                  )}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="direccion">Dirección</Label>
                <Input
                  id="direccion"
                  placeholder="Av. Corrientes 1234"
                  {...form.register('direccion', { required: true })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="cliente@ejemplo.com"
                  {...form.register('email')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendedor">Vendedor Asignado</Label>
                <Select
                  value={form.watch('vendedor')}
                  onValueChange={(value) => form.setValue('vendedor', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendedores.map((vendedor: Vendedor) => (
                      <SelectItem key={vendedor.id} value={String(vendedor.id)}>
                        {vendedor.nombre} ({vendedor.sigla})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={form.handleSubmit(handleSubmit)} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar clientes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Dirección</TableHead>
              <TableHead>Vendedor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.map((cliente) => (
              <TableRow key={cliente.id}>
                <TableCell className="font-medium">{cliente.nombre}</TableCell>
                <TableCell>{cliente.telefono ?? 'Sin teléfono'}</TableCell>
                <TableCell>{cliente.direccion ?? 'Sin dirección'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{cliente.vendedor.sigla}</Badge>
                    <span className="text-sm">{cliente.vendedor.nombre}</span>
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