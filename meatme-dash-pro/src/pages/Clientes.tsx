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

interface Cliente {
  id: number;
  nombre: string;
  telefono: string;
  direccion: string;
  vendedor_nombre: string;
  vendedor_sigla: string;
}

export default function Clientes() {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // Mock data
  const clientes: Cliente[] = [
    {
      id: 1,
      nombre: 'Restaurante El Gaucho',
      telefono: '+54 11 1234-5678',
      direccion: 'Av. Corrientes 1234, CABA',
      vendedor_nombre: 'Juan Pérez',
      vendedor_sigla: 'JP',
    },
    {
      id: 2,
      nombre: 'Parrilla Don José',
      telefono: '+54 11 8765-4321',
      direccion: 'Av. Santa Fe 5678, CABA',
      vendedor_nombre: 'María García',
      vendedor_sigla: 'MG',
    },
    {
      id: 3,
      nombre: 'Supermercado La Esquina',
      telefono: '+54 11 2468-1357',
      direccion: 'Calle Principal 910, CABA',
      vendedor_nombre: 'Juan Pérez',
      vendedor_sigla: 'JP',
    },
  ];

  const filteredClientes = clientes.filter((c) =>
    c.nombre.toLowerCase().includes(search.toLowerCase())
  );

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
              <DialogDescription>
                Agregue un nuevo cliente al sistema
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nombre">Nombre / Razón Social</Label>
                <Input id="nombre" placeholder="Ej: Restaurante El Gaucho" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input id="telefono" placeholder="+54 11 1234-5678" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="direccion">Dirección</Label>
                <Input id="direccion" placeholder="Av. Corrientes 1234" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendedor">Vendedor Asignado</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Juan Pérez (JP)</SelectItem>
                    <SelectItem value="2">María García (MG)</SelectItem>
                    <SelectItem value="3">Carlos López (CL)</SelectItem>
                  </SelectContent>
                </Select>
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
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClientes.map((cliente) => (
              <TableRow key={cliente.id}>
                <TableCell className="font-medium">{cliente.nombre}</TableCell>
                <TableCell>{cliente.telefono}</TableCell>
                <TableCell>{cliente.direccion}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{cliente.vendedor_sigla}</Badge>
                    <span className="text-sm">{cliente.vendedor_nombre}</span>
                  </div>
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
