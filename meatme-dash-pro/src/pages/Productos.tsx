import { useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
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

interface Producto {
  id: number;
  nombre: string;
  categoria: string;
  precio_por_kilo: number;
  estado: 'activo' | 'inactivo';
}

export default function Productos() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // Mock data
  const productos: Producto[] = [
    { id: 1, nombre: 'Bife de Chorizo', categoria: 'Cortes Premium', precio_por_kilo: 8.5, estado: 'activo' },
    { id: 2, nombre: 'Asado', categoria: 'Cortes Tradicionales', precio_por_kilo: 6.2, estado: 'activo' },
    { id: 3, nombre: 'Vacío', categoria: 'Cortes Tradicionales', precio_por_kilo: 7.8, estado: 'activo' },
    { id: 4, nombre: 'Matambre', categoria: 'Cortes Especiales', precio_por_kilo: 5.9, estado: 'activo' },
  ];

  const filteredProducts = productos.filter((p) =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  );

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
                <Input id="nombre" placeholder="Ej: Bife de Chorizo" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="categoria">Categoría</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="premium">Cortes Premium</SelectItem>
                    <SelectItem value="tradicional">Cortes Tradicionales</SelectItem>
                    <SelectItem value="especial">Cortes Especiales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="precio">Precio por Kilo ($)</Label>
                <Input id="precio" type="number" step="0.01" placeholder="0.00" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descripcion">Descripción (Opcional)</Label>
                <Input id="descripcion" placeholder="Descripción del producto" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Guardar</Button>
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
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((producto) => (
              <TableRow key={producto.id}>
                <TableCell className="font-medium">{producto.nombre}</TableCell>
                <TableCell>{producto.categoria}</TableCell>
                <TableCell>${producto.precio_por_kilo.toFixed(2)}</TableCell>
                <TableCell>
                  <Badge
                    variant={producto.estado === 'activo' ? 'default' : 'secondary'}
                  >
                    {producto.estado}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
