import { useMemo, useState } from 'react';
import { Plus, Search, Edit2, Package } from 'lucide-react';
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
import { createProducto, updateProducto, getProductos } from '@/services/api';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorMessage } from '@/components/shared/ErrorMessage';
import type { Producto } from '@/types';
import { useToast } from '@/hooks/use-toast';

interface ProductoForm {
  nombre: string;
  descripcion?: string;
  categoria?: string;
  precio_por_kilo: string;
  peso_minimo: string;
  estado: 'disponible' | 'agotado' | 'desactivado';
}

export default function Productos() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProducto, setEditingProducto] = useState<Producto | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ProductoForm>({
    defaultValues: {
      nombre: '',
      descripcion: '',
      categoria: '',
      precio_por_kilo: '',
      peso_minimo: '0',
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

  // Mutación CORREGIDA: Maneja explícitamente el ID para el PUT
  const mutation = useMutation({
    mutationFn: async (values: ProductoForm) => {
      const payload = {
        nombre: values.nombre,
        descripcion: values.descripcion || "",
        categoria: values.categoria,
        precio_por_kilo: Number(values.precio_por_kilo),
        peso_minimo: Number(values.peso_minimo),
        estado: values.estado,
      };
      
      if (editingProducto?.id) {
        // IMPORTANTE: Se envía el ID y el cuerpo por separado
        return await updateProducto(editingProducto.id, payload);
      } else {
        return await createProducto(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] }); // Actualiza inventario si cambió algo
      toast({
        title: editingProducto ? 'Producto actualizado' : 'Producto creado',
        description: 'La operación se realizó con éxito.',
      });
      closeDialog();
    },
    onError: (err: any) => {
      console.error("Error API:", err.response?.data || err.message);
      toast({
        title: 'Error al guardar',
        description: err.response?.data?.detail || 'Verifica la conexión con el servidor.',
        variant: 'destructive',
      });
    },
  });

  const handleEditClick = (producto: Producto) => {
    setEditingProducto(producto);
    form.reset({
      nombre: producto.nombre,
      descripcion: producto.descripcion || '',
      categoria: producto.categoria || '',
      precio_por_kilo: String(producto.precio_por_kilo),
      peso_minimo: String(producto.peso_minimo || 0),
      estado: producto.estado as any,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setTimeout(() => {
      setEditingProducto(null);
      form.reset({
        nombre: '',
        descripcion: '',
        categoria: '',
        precio_por_kilo: '',
        peso_minimo: '0',
        estado: 'disponible',
      });
    }, 100);
  };

  const filteredProducts = useMemo(() => {
    const productos = Array.isArray(data) ? data : [];
    return productos.filter((p: Producto) =>
      p.nombre.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Error al cargar productos" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Catálogo de Productos</h1>
          <p className="text-muted-foreground">Configuración de precios y parámetros base.</p>
        </div>
        <Button onClick={() => { setEditingProducto(null); form.reset(); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo Producto
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingProducto ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
            <DialogDescription>
              {editingProducto ? `Modificando: ${editingProducto.nombre}` : 'Complete los datos del nuevo ítem.'}
            </DialogDescription>
          </DialogHeader>
          
          {/* Envoltura de Form para asegurar el submit */}
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="nombre">Nombre del Producto</Label>
                <Input id="nombre" {...form.register('nombre', { required: true })} placeholder="Ej: Lomo Liso" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="estado">Estado</Label>
                <Select 
                  value={form.watch('estado')} 
                  onValueChange={(v: any) => form.setValue('estado', v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponible">Disponible</SelectItem>
                    <SelectItem value="agotado">Agotado</SelectItem>
                    <SelectItem value="desactivado">Desactivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="precio">Precio por Kilo ($)</Label>
                <Input id="precio" type="number" step="any" {...form.register('precio_por_kilo', { required: true })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="peso_minimo">Peso Mínimo (Kg)</Label>
                <Input id="peso_minimo" type="number" step="0.001" {...form.register('peso_minimo')} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="categoria">Categoría</Label>
              <Select 
                value={form.watch('categoria')} 
                onValueChange={(v) => form.setValue('categoria', v)}
              >
                <SelectTrigger><SelectValue placeholder="Seleccione categoría" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="al vacio">Al Vacío</SelectItem>
                  <SelectItem value="congelado">Congelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
                <Label htmlFor="descripcion">Descripción</Label>
                <Input id="descripcion" {...form.register('descripcion')} placeholder="Detalles adicionales..." />
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : editingProducto ? 'Actualizar Producto' : 'Crear Producto'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input 
          placeholder="Buscar por nombre de producto..." 
          value={search} 
          onChange={(e) => setSearch(e.target.value)} 
          className="pl-9" 
        />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Producto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">Precio/Kg</TableHead>
              <TableHead className="text-right">Peso Mín.</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="w-[80px] text-center">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length > 0 ? (
              filteredProducts.map((producto: Producto) => (
                <TableRow key={producto.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        {producto.nombre}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{producto.categoria ?? 'N/A'}</TableCell>
                  <TableCell className="text-right font-mono">
                    ${Number(producto.precio_por_kilo).toLocaleString('es-CL')}
                  </TableCell>
                  <TableCell className="text-right">
                    {producto.peso_minimo ?? 0} <span className="text-xs text-muted-foreground">kg</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge 
                      variant={
                        producto.estado === 'disponible' ? 'default' : 
                        producto.estado === 'agotado' ? 'secondary' : 'destructive'
                      }
                      className="capitalize"
                    >
                      {producto.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" onClick={() => handleEditClick(producto)}>
                      <Edit2 className="h-4 w-4 text-blue-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No se encontraron productos.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}