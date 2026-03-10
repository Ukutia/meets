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
import { createCliente, updateCliente, getClientes, getVendedores } from '@/services/api'; // Añadido updateCliente
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Cliente, Vendedor } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ClienteForm {
  nombre: string;
  telefono: string; // Ahora es obligatorio
  direccion: string;
  email?: string;
  vendedor: string;
}

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

const formatSimplePhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  let formatted = '9';
  const rest = digits.startsWith('9') ? digits.substring(1) : digits;
  if (rest.length > 0) formatted += ' ' + rest.substring(0, 4);
  if (rest.length > 4) formatted += ' ' + rest.substring(4, 8);
  return formatted;
};

export default function Clientes() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null); // Estado para edición
  
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

  
  // Busca estas líneas y cámbialas por esto:
  const clientes = Array.isArray(clientesData) ? clientesData : (clientesData as any)?.results ?? [];
  const vendedores = Array.isArray(vendedoresData) ? vendedoresData : (vendedoresData as any)?.results ?? [];

// Mutación para Crear/Editar corregida
// Busca tu useMutation y cámbialo por este:
const mutation = useMutation({
  mutationFn: (values: ClienteForm) => {
    const payload = {
      nombre: values.nombre,
      direccion: values.direccion,
      // 1. Si el email está vacío, enviamos null (evita errores de formato de cadena vacía)
      email: values.email?.trim() ? values.email : null,
      // 2. Limpiamos espacios
      telefono: values.telefono.replace(/\s/g, ''),
      // 3. Enviamos el ID como NÚMERO. 
      // Prueba con 'vendedor_id'. Si falla, cámbialo a 'vendedor' a secas.
      vendedor_id: Number(values.vendedor), 
    };
    
    return editingCliente 
      ? updateCliente(editingCliente.id, payload) 
      : createCliente(payload);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['clientes'] });
    toast({
      title: editingCliente ? 'Cliente actualizado' : 'Cliente creado',
      description: 'La operación se realizó correctamente.',
    });
    handleCloseDialog();
  },
  onError: (error: any) => {
    // IMPORTANTE: Esto te dirá en la consola qué campo exacto falta
    console.error("Error del backend:", error.response?.data);
    toast({
      title: 'Error',
      description: error.response?.data?.error || 'Verifique los datos obligatorios',
      variant: 'destructive',
    });
  },
});

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCliente(null);
    form.reset({
      nombre: '',
      telefono: '',
      direccion: '',
      email: '',
      vendedor: '',
    });
  };

  const handleEditClick = (cliente: Cliente) => {
    setEditingCliente(cliente);
    form.reset({
      nombre: cliente.nombre,
      telefono: formatSimplePhone(cliente.telefono || ''),
      direccion: cliente.direccion,
      email: cliente.email || '',
      vendedor: String(cliente.vendedor.id),
    });
    setDialogOpen(true);
  };

  // --- FUNCIÓN PARA ABRIR NUEVO CLIENTE ---
  const handleNewClick = () => {
    setEditingCliente(null);
    form.reset({
      nombre: '',
      telefono: '',
      direccion: '',
      email: '',
      vendedor: '',
    });
    setDialogOpen(true);
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter((c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase())
    );
  }, [clientes, search]);

  const onSubmit = (values: ClienteForm) => {
    if (!values.vendedor) {
      toast({ title: 'Error', description: 'Seleccione un vendedor', variant: 'destructive' });
      return;
    }
    mutation.mutate(values);
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="No se pudieron cargar los clientes" />;

  return (
    <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground">Gestión de base de clientes y vendedores</p>
      </div>
      
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* Botón manual para asegurar que el estado se limpie antes de abrir */}
        <Button onClick={handleNewClick}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
        </Button>

        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingCliente ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
            <DialogDescription>
              {editingCliente ? 'Modifique los datos del cliente' : 'Agregue un nuevo cliente al sistema'}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            {/* Nombre */}
            <div className="grid gap-2">
              <Label htmlFor="nombre">Nombre / Razón Social *</Label>
              <Input
                id="nombre"
                {...form.register('nombre', { required: "El nombre es obligatorio" })}
              />
              {form.formState.errors.nombre && (
                <span className="text-xs text-destructive">{form.formState.errors.nombre.message}</span>
              )}
            </div>
            
            {/* Teléfono con Controller para el formato */}
            <div className="grid gap-2">
              <Label htmlFor="telefono">Teléfono (9 XXXX XXXX) *</Label>
              <Controller
                name="telefono"
                control={form.control}
                rules={{ 
                  required: "El teléfono es obligatorio", 
                  minLength: { value: 11, message: "Teléfono incompleto" } 
                }}
                render={({ field }) => (
                  <Input
                    id="telefono"
                    placeholder="9 1234 5678"
                    value={field.value}
                    onChange={(e) => {
                      const formatted = formatSimplePhone(e.target.value);
                      if (formatted.length <= 11) field.onChange(formatted);
                    }}
                  />
                )}
              />
              {form.formState.errors.telefono && (
                <span className="text-xs text-destructive">{form.formState.errors.telefono.message}</span>
              )}
            </div>

            {/* Dirección */}
            <div className="grid gap-2">
              <Label htmlFor="direccion">Dirección *</Label>
              <Input
                id="direccion"
                {...form.register('direccion', { required: "La dirección es obligatoria" })}
              />
              {form.formState.errors.direccion && (
                <span className="text-xs text-destructive">{form.formState.errors.direccion.message}</span>
              )}
            </div>

            {/* Email */}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="ejemplo@correo.com"
                {...form.register('email')} 
              />
            </div>

            {/* Vendedor Asignado */}
            <div className="grid gap-2">
              <Label htmlFor="vendedor">Vendedor Asignado *</Label>
              <Select
                // Usamos el watch para que el Select refleje el estado actual del form
                value={form.watch('vendedor')} 
                onValueChange={(val) => {
                  form.setValue('vendedor', val, { shouldValidate: true });
                }}
              >
                <SelectTrigger id="vendedor">
                  <SelectValue placeholder="Seleccione vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {vendedores.map((v: Vendedor) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.nombre} ({v.sigla})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.vendedor && (
                <span className="text-xs text-destructive">El vendedor es requerido</span>
              )}
            </div>

            <DialogFooter className="mt-4 gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <><LoadingSpinner className="mr-2 h-4 w-4" /> Guardando...</>
                ) : (
                  editingCliente ? 'Actualizar' : 'Guardar'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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