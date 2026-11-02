from datetime import date, timedelta
from django.db import transaction

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Periodo


def _serializar(p):
    return {
        'id': p.id,
        'nombre': p.nombre,
        'fecha_inicio': p.fecha_inicio.isoformat(),
        'fecha_fin': p.fecha_fin.isoformat() if p.fecha_fin else None,
    }


def _fecha(valor):
    try:
        return date.fromisoformat(str(valor))
    except ValueError:
        return None


def _cerrar_periodos(periodos):
    """Cada corte termina antes del siguiente; solo el último queda abierto."""
    for i, p in enumerate(periodos):
        fin = periodos[i + 1].fecha_inicio - timedelta(days=1) if i + 1 < len(periodos) else None
        if p.fecha_fin != fin:
            p.fecha_fin = fin
            p.save(update_fields=['fecha_fin'])


class PeriodoListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response([_serializar(p) for p in Periodo.objects.all()])

    @transaction.atomic
    def post(self, request):
        """Abre un período nuevo. Si hay uno vigente, lo cierra el día anterior."""
        valor_nombre = request.data.get('nombre')
        nombre = valor_nombre.strip() if isinstance(valor_nombre, str) else ''
        inicio = _fecha(request.data.get('fecha_inicio'))
        if not nombre or len(nombre) > 100 or not inicio:
            return Response({'error': 'Indica un nombre de hasta 100 caracteres y una fecha de inicio válida'},
                            status=status.HTTP_400_BAD_REQUEST)
        periodos = list(Periodo.objects.select_for_update().order_by('fecha_inicio', 'id'))
        vigente = periodos[-1] if periodos else None
        if vigente and inicio <= vigente.fecha_inicio:
            return Response({'error': f'La fecha debe ser posterior al inicio de "{vigente.nombre}"'},
                            status=status.HTTP_400_BAD_REQUEST)
        p = Periodo.objects.create(nombre=nombre, fecha_inicio=inicio)
        _cerrar_periodos([*periodos, p])
        return Response(_serializar(p), status=status.HTTP_201_CREATED)


class PeriodoDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk):
        periodos = list(Periodo.objects.select_for_update().order_by('fecha_inicio', 'id'))
        p = next((p for p in periodos if p.pk == pk), None)
        if p is None:
            return Response({'error': 'Período no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        if 'nombre' in request.data:
            valor_nombre = request.data.get('nombre')
            nombre = valor_nombre.strip() if isinstance(valor_nombre, str) else ''
            if not nombre or len(nombre) > 100:
                return Response({'error': 'Indica un nombre de entre 1 y 100 caracteres'}, status=status.HTTP_400_BAD_REQUEST)
            p.nombre = nombre
        if 'fecha_inicio' in request.data:
            inicio = _fecha(request.data.get('fecha_inicio'))
            if not inicio:
                return Response({'error': 'Fecha de inicio inválida'}, status=status.HTTP_400_BAD_REQUEST)
            p.fecha_inicio = inicio
        i = periodos.index(p)
        if ((i > 0 and p.fecha_inicio <= periodos[i - 1].fecha_inicio)
                or (i + 1 < len(periodos) and p.fecha_inicio >= periodos[i + 1].fecha_inicio)):
            return Response({'error': 'El inicio debe quedar entre los inicios de los períodos vecinos'},
                            status=status.HTTP_400_BAD_REQUEST)
        p.save()
        _cerrar_periodos(periodos)
        return Response(_serializar(p))

    @transaction.atomic
    def delete(self, request, pk):
        """Quita el período (no borra pedidos ni pagos). Si era el vigente, reabre el anterior."""
        periodos = list(Periodo.objects.select_for_update().order_by('fecha_inicio', 'id'))
        p = next((p for p in periodos if p.pk == pk), None)
        if p is None:
            return Response({'error': 'Período no encontrado'}, status=status.HTTP_404_NOT_FOUND)
        p.delete()
        _cerrar_periodos([otro for otro in periodos if otro is not p])
        return Response(status=status.HTTP_204_NO_CONTENT)
