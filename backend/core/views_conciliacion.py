from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import conciliacion as c
from .models import CierreTributario, DocumentoTributario, Pedido, Periodo
from .sii import json_seguro, validar_mes
from .views_tesoreria import _error


class ConciliacionMesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            periodo_id = request.query_params.get('periodo')
            periodo = Periodo.objects.get(pk=int(periodo_id)) if periodo_id else None
            resultado = c.resumen_mes(request.query_params.get('mes'), periodo=periodo)
        except (ValueError, TypeError, Periodo.DoesNotExist):
            return _error('Período inválido, usa AAAA-MM')
        for campo in ('tipo', 'estado_conciliacion', 'operacion'):
            if request.query_params.get(campo):
                resultado['documentos'] = [d for d in resultado['documentos'] if str(d[campo]) == request.query_params[campo]]
        return Response(resultado)

    @transaction.atomic
    def put(self, request):
        try:
            mes = validar_mes(request.data.get('mes'))
            declarado = request.data.get('declarado')
            if declarado is not None:
                if not isinstance(declarado, dict) or not str(declarado.get('folio_f29') or '').strip():
                    raise ValueError('Indica el folio F29 para registrar la declaración')
                monto = Decimal(str(declarado.get('total_pagado')))
                if not monto.is_finite() or monto < 0 or monto >= Decimal('100000000000'):
                    raise ValueError('Total declarado inválido')
                fecha = date.fromisoformat(declarado.get('fecha', ''))
            cierre, _ = CierreTributario.objects.get_or_create(mes=mes)
            cierre = CierreTributario.objects.select_for_update().get(pk=cierre.pk)
            if declarado is not None and cierre.declarado:
                raise ValueError('Ya existe declaración registrada; su copia se conserva sin sobrescribir')
            fundamento = str(request.data.get('fundamento') or '').strip()
            if not fundamento:
                raise ValueError('Indica el fundamento de los parámetros del mes')
            campos = ('tasa_ppm', 'base_ppm', 'ppm_informado_sii', 'remanente_anterior',
                      'remanente_anticipo_anterior', 'otros_impuestos', 'retenciones')
            valores = {}
            for campo in campos:
                if campo not in request.data:
                    continue
                valor = request.data[campo]
                if valor is None and campo not in ('otros_impuestos', 'retenciones'):
                    valores[campo] = None
                    continue
                valor = Decimal(str(valor))
                if not valor.is_finite() or valor < 0 or valor >= Decimal('100000000000') or (campo == 'tasa_ppm' and valor > 100):
                    raise ValueError(f'{campo} fuera de rango')
                precision = Decimal('.0001') if campo == 'tasa_ppm' else Decimal('.01')
                if valor != valor.quantize(precision):
                    raise ValueError(f'Demasiados decimales en {campo}')
                valores[campo] = valor
        except (ValueError, TypeError, InvalidOperation) as e:
            return _error(str(e))
        antes = {campo: getattr(cierre, campo) for campo in campos}
        for campo, valor in valores.items():
            setattr(cierre, campo, valor)
        cierre.fundamento = fundamento
        evento = {'usuario': request.user.username, 'fecha': timezone.now(), 'antes': antes,
                  'despues': valores, 'fundamento': fundamento}
        cierre.historial = [*cierre.historial, json_seguro(evento)]
        cierre.save()
        # Declarado es un registro explícito del usuario, nunca inferido de una estimación.
        if 'declarado' in request.data:
            declarado = request.data['declarado']
            cierre.declarado = json_seguro({'folio_f29': str(declarado['folio_f29'])[:60], 'total_pagado': monto,
                                           'fecha': fecha, 'usuario': request.user.username,
                                           'registrado_el': timezone.now(), 'resumen_al_declarar': c.resumen_mes(mes)})
            cierre.save(update_fields=['declarado'])
        return Response(c.resumen_mes(mes))


class ConciliacionDocumentoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        doc = DocumentoTributario.objects.filter(pk=pk).first()
        if not doc:
            return _error('Documento no encontrado', 404)
        return Response({'documento': c.fila_documento(doc), 'candidatos': c.candidatos(doc),
                         'historial': [{'accion': h.accion, 'antes': h.antes, 'despues': h.despues,
                                        'usuario': h.usuario.username if h.usuario else None, 'fecha': h.fecha}
                                       for h in doc.historial_conciliacion.select_related('usuario')]})

    def patch(self, request, pk):
        try:
            if not set(request.data) <= {'registro_tipo', 'registro_id', 'justificacion', 'credito_validado', 'anticipo_validado'}:
                return _error('La conciliación no modifica folios, fechas ni montos del documento')
            doc = c.vincular(pk, request.data, request.user)
        except DocumentoTributario.DoesNotExist:
            return _error('Documento no encontrado', 404)
        except (ValueError, TypeError) as e:
            return _error(str(e))
        return Response(c.fila_documento(doc))


class FechaEntregaView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk):
        pedido = Pedido.objects.select_for_update().filter(pk=pk).first()
        if not pedido:
            return _error('Pedido no encontrado', 404)
        try:
            valor = request.data.get('fecha_entrega')
            fecha = date.fromisoformat(valor) if valor else None
        except (ValueError, TypeError):
            return _error('Fecha de entrega inválida')
        pedido.fecha_entrega = fecha
        antes = {d.pk: c.instantanea(d) for d in pedido.documentos.all()}
        pedido.save(update_fields=['fecha_entrega'])
        for doc in pedido.documentos.all():
            doc.pedido = pedido
            c.auditar(doc, 'fecha_entrega', antes[doc.pk], request.user)
        return Response({'id': pedido.pk, 'fecha_entrega': fecha})
