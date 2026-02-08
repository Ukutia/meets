import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPedidoById, updatePedido, getClientes, getProductos } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Save, ArrowLeft } from 'lucide-react';

export default function FormularioPedido() {
  const { id } = useParams(); // Detecta el ID de la URL
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = Boolean(id);

  // 1. Obtener datos si es edición
  const { data: pedidoGuardado, isLoading: loadingPedido } = useQuery({
    queryKey: ['pedido', id],
    queryFn: () => getPedidoById(Number(id)),
    enabled: isEditing, // Solo se ejecuta si hay ID
  });

  // 2. Estado del formulario (simplificado para el ejemplo)
  const [detalles, setDetalles] = useState([]);

  // Al cargar el pedido para editar, rellenamos el estado
  useEffect(() => {
    if (pedidoGuardado) {
      setDetalles(pedidoGuardado.detalles);
      // Aquí setearías otros campos como cliente, vendedor, etc.
    }
  }, [pedidoGuardado]);

  // 3. Mutación para Guardar/Actualizar
  const mutation = useMutation({
    mutationFn: (data: any) => 
      isEditing ? updatePedido(Number(id), data) : createPedido(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      toast({ title: isEditing ? 'Pedido actualizado' : 'Pedido creado' });
      navigate('/pedidos');
    },
  });

  if (isEditing && loadingPedido) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/pedidos')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">
          {isEditing ? `Editando Pedido #${id}` : 'Nuevo Pedido'}
        </h1>
      </div>

      <form className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
        {/* Aquí va tu lógica de selección de cliente y productos */}
        {/* ... */}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={() => navigate('/pedidos')}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate({ /* data del form */ })}>
            <Save className="mr-2 h-4 w-4" />
            {isEditing ? 'Guardar Cambios' : 'Crear Pedido'}
          </Button>
        </div>
      </form>
    </div>
  );
}