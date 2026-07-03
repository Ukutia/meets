import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForm, Controller } from 'react-hook-form';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createCliente, updateCliente, getVendedores } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import type { Cliente, Vendedor } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ClienteForm {
  nombre: string;
  telefono: string;
  direccion: string;
  email?: string;
  vendedor: string;
}

export const formatSimplePhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  let formatted = '9';
  const rest = digits.startsWith('9') ? digits.substring(1) : digits;
  if (rest.length > 0) formatted += ' ' + rest.substring(0, 4);
  if (rest.length > 4) formatted += ' ' + rest.substring(4, 8);
  return formatted;
};

const emptyValues: ClienteForm = {
  nombre: '',
  telefono: '',
  direccion: '',
  email: '',
  vendedor: '',
};

interface ClienteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  cliente?: Cliente | null;
  onSuccess?: (cliente: Cliente) => void;
}

export function ClienteFormDialog({
  open,
  onOpenChange,
  mode,
  cliente,
  onSuccess,
}: ClienteFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ClienteForm>({
    defaultValues: emptyValues,
  });

  const { data: vendedoresData } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const response = await getVendedores();
      return response.data;
    },
  });

  const vendedores = Array.isArray(vendedoresData) ? vendedoresData : (vendedoresData as any)?.results ?? [];

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && cliente) {
      form.reset({
        nombre: cliente.nombre,
        telefono: formatSimplePhone(cliente.telefono || ''),
        direccion: cliente.direccion || '',
        email: cliente.email || '',
        vendedor: String(cliente.vendedor.id),
      });
    } else {
      form.reset(emptyValues);
    }
  }, [open, mode, cliente]);

  const mutation = useMutation({
    mutationFn: (values: ClienteForm) => {
      const payload = {
        nombre: values.nombre,
        direccion: values.direccion,
        email: values.email?.trim() ? values.email : null,
        telefono: values.telefono.replace(/\s/g, ''),
        vendedor_id: Number(values.vendedor),
      };

      return mode === 'edit' && cliente
        ? updateCliente(cliente.id, payload)
        : createCliente(payload);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast({
        title: mode === 'edit' ? 'Cliente actualizado' : 'Cliente creado',
        description: 'La operación se realizó correctamente.',
      });
      onOpenChange(false);
      onSuccess?.(response.data);
    },
    onError: (error: any) => {
      console.error('Error del backend:', error.response?.data);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Verifique los datos obligatorios',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: ClienteForm) => {
    if (!values.vendedor) {
      toast({ title: 'Error', description: 'Seleccione un vendedor', variant: 'destructive' });
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' ? 'Modifique los datos del cliente' : 'Agregue un nuevo cliente al sistema'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="nombre">Nombre / Razón Social *</Label>
            <Input
              id="nombre"
              {...form.register('nombre', { required: 'El nombre es obligatorio' })}
            />
            {form.formState.errors.nombre && (
              <span className="text-xs text-destructive">{form.formState.errors.nombre.message}</span>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="telefono">Teléfono (9 XXXX XXXX) *</Label>
            <Controller
              name="telefono"
              control={form.control}
              rules={{
                required: 'El teléfono es obligatorio',
                minLength: { value: 11, message: 'Teléfono incompleto' },
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

          <div className="grid gap-2">
            <Label htmlFor="direccion">Dirección *</Label>
            <Input
              id="direccion"
              {...form.register('direccion', { required: 'La dirección es obligatoria' })}
            />
            {form.formState.errors.direccion && (
              <span className="text-xs text-destructive">{form.formState.errors.direccion.message}</span>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="ejemplo@correo.com"
              {...form.register('email')}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="vendedor">Vendedor Asignado *</Label>
            <Select
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <><LoadingSpinner className="mr-2 h-4 w-4" /> Guardando...</>
              ) : (
                mode === 'edit' ? 'Actualizar' : 'Guardar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
