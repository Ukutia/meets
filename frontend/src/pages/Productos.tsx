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
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProducto, getProductos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Producto } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ProductoForm {
  nombre: string;
  descripcion?: string;
  categoria?: string;
  precio_por_kilo: string;
  estado: 'disponible' | 'agotado';
}

export default function Productos() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ProductoForm>({
    defaultValues: {
      nombre: '',
      descripcion: '',
      categoria: '',
      precio_por_kilo: '',
      estado: 'disponible',
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['productos'],
    queryFn: async () => {
      const response = await getProductos();
      return response.data;
    },
  });

  const productos = data ?? [];

  const createMutation = useMutation({
    mutationFn: (values: ProductoForm) =>
      createProducto({
        nombre: values.nombre,
        descripcion: values.descripcion,
        categoria: values.categoria,
        precio_por_kilo: Number(values.precio_por_kilo),
        estado: values.estado,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] });
      toast({
        title: 'Producto creado',
        description: 'El producto se ha registrado correctamente.',
      });
      form.reset();
      setDialogOpen(false);
    },
    onError: () => {
      toast({
        title: 'Error al crear el producto',
        description: 'Por favor, verifique los datos ingresados.',
        variant: 'destructive',
      });
    },
  });

  const filteredProducts = useMemo(() => {
    return productos.filter((p) =>
      p.nombre.toLowerCase().includes(search.toLowerCase())
    );
  }, [productos, search]);

  const handleSubmit = (values: ProductoForm) => {
    if (!values.precio_por_kilo) {
      toast({
        title: 'Precio requerido',
        description: 'Ingrese el precio por kilo del producto.',
        variant: 'destructive',
      });
      return;
    }
    createMutation.mutate(values);
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="No se pudieron cargar los productos" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Productos</h1>
          <p className="text-muted-foreground">
            Gestión de inventario de productos cárnicos
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Producto
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Nuevo Producto</DialogTitle>
              <DialogDescription>
                Agregue un nuevo producto al inventario
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input
                  id="nombre"
                  placeholder="Ej: Bife de Chorizo"
                  {...form.register('nombre', { required: true })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="categoria">Categoría</Label>
                <Select
                  value={form.watch('categoria')}
                  onValueChange={(value) => form.setValue('categoria', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="al vacio">Al Vacío</SelectItem>
                    <SelectItem value="congelado">Congelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="precio">Precio por Kilo ($)</Label>
                <Input
                  id="precio"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...form.register('precio_por_kilo')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descripcion">Descripción (Opcional)</Label>
                <Input
                  id="descripcion"
                  placeholder="Descripción del producto"
                  {...form.register('descripcion')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="estado">Estado</Label>
                <Select
                  value={form.watch('estado')}
                  onValueChange={(value: 'disponible' | 'agotado') =>
                    form.setValue('estado', value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponible">Disponible</SelectItem>
                    <SelectItem value="agotado">Agotado</SelectItem>
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
            placeholder="Buscar productos..."
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
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Precio/Kg</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((producto) => (
              <TableRow key={producto.id}>
                <TableCell className="font-medium">{producto.nombre}</TableCell>
                <TableCell>{producto.categoria ?? 'Sin categoría'}</TableCell>
                <TableCell>${producto.precio_por_kilo}</TableCell>
                <TableCell>
                  <Badge variant={producto.estado === 'disponible' ? 'default' : 'secondary'}>
                    {producto.estado === 'disponible' ? 'Disponible' : 'Agotado'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
