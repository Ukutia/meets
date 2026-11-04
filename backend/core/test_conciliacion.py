"""Casos controlados. Los CSV de octubre se reconstruyen desde los totales
proporcionados por el usuario; NO son exportaciones reales del SII."""
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .conciliacion import candidatos, pesos, resumen_mes
from .models import (CierreTributario, Cliente, ConfiguracionContable, DocumentoTributario,
                     Factura, Gasto, HistorialConciliacion, ImportacionSII, Pedido, Proveedor, Periodo)
from .sii import _monto, leer_rcv, validar_rut
from .test_cierre import COMPRAS_ENC, VENTAS_ENC, csv

D = Decimal
ZONA = ZoneInfo('America/Santiago')
EMPRESA = '78537642-0'
CLIENTE = '76123456-0'
PROVEEDOR = '77777777-7'


class ConciliacionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='contador')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.config, _ = ConfiguracionContable.objects.update_or_create(pk=1, defaults={
            'rut_empresa': EMPRESA, 'inicio_actividades': date(2026, 10, 19), 'regimen': '14 D N.º 3'})
        self.cliente = Cliente.objects.create(nombre='Roberto Luque', razon_social='Casa Asa SpA', rut=CLIENTE, direccion='Santiago')
        self.proveedor = Proveedor.objects.create(nombre='Frigorífico', rut=PROVEEDOR)

    def pedido(self, total=1190, fecha='2026-10-25', **kwargs):
        return Pedido.objects.create(cliente=self.cliente, total=total, estado='Preparado',
                                     fecha=datetime.fromisoformat(fecha).replace(hour=12, tzinfo=ZONA), **kwargs)

    def documento(self, **kwargs):
        datos = dict(tipo=33, folio=1, fecha_emision=date(2026, 10, 25), periodo_tributario='2026-10',
                     rut_emisor=EMPRESA, rut_receptor=CLIENTE, neto=1000, iva=190, total=1190, origen='sii', estado_sii='emitido')
        datos.update(kwargs)
        return DocumentoTributario.objects.create(**datos)

    def importar(self, filas, compras=False, **kwargs):
        return self.client.post(reverse('cierre_sii'), {'archivo': csv(COMPRAS_ENC if compras else VENTAS_ENC, *filas),
                                                       'mes': '2026-10', 'estado_registro': 'registrado', **kwargs})

    def venta_fila(self, folio=1, total=1190, neto=1000, iva=190):
        return [1, 33, 'Del Giro', CLIENTE, 'Casa Asa SpA', folio, '25/10/2026', '', 0, neto, iva, total]

    def compra_fila(self, folio=1, anticipo=True):
        return [1, 33, 'Del Giro', PROVEEDOR, 'Frigorífico', folio, '25/10/2026', 0, 100000, 19000, 0,
                124000 if anticipo else 119000, 18 if anticipo else '', 5000 if anticipo else 0, 5 if anticipo else '']

    def vincular(self, doc, pedido=None, **kwargs):
        return self.client.patch(reverse('conciliacion_documento', args=[doc.pk]), {
            'registro_tipo': 'pedido' if pedido else None, 'registro_id': pedido.pk if pedido else None,
            'justificacion': 'Validado contra documento original', **kwargs}, format='json')

    def test_importacion_repetida_no_duplica_documentos_ni_ventas(self):
        p = self.pedido()
        for _ in range(2):
            r = self.importar([self.venta_fila()])
            self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(DocumentoTributario.objects.count(), 1)
        self.assertEqual(Pedido.objects.count(), 1)
        self.assertIsNone(DocumentoTributario.objects.get().pedido_id)
        self.assertEqual(r.data['actualizados'], 1)
        self.assertEqual(candidatos(DocumentoTributario.objects.get())[0]['registro_id'], p.pk)

    def test_duplicados_identicos_se_omiten_y_conflictivos_revierten_archivo_completo(self):
        r = self.importar([self.venta_fila(), self.venta_fila()])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data['resultado']['duplicados_omitidos'], 1)
        r = self.importar([self.venta_fila(2), self.venta_fila(2, total=1200)])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(DocumentoTributario.objects.count(), 1)
        self.assertEqual(ImportacionSII.objects.count(), 1)

    def test_clave_permite_mismo_folio_distintos_emisores(self):
        a = self.compra_fila()
        b = self.compra_fila()
        b[3] = CLIENTE
        r = self.importar([a, b], compras=True)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(DocumentoTributario.objects.count(), 2)

    def test_mismo_tipo_y_folio_en_compra_y_venta_no_mezcla_debito(self):
        self.importar([self.venta_fila()])
        self.importar([self.compra_fila()], compras=True)
        r = resumen_mes('2026-10')
        self.assertEqual(r['ventas']['iva_debito'], 190)
        self.assertEqual(r['compras']['iva_credito'], 19000)
        venta = self.client.get(reverse('cierre_ventas'), {'mes': '2026-10'})
        self.assertEqual(D(venta.data['resumen']['iva_debito_documentos']), 0)  # Sin pedido asociado.

    def test_propuesta_f29_cuadra_con_la_del_sii(self):
        declarado = dict(mes_declaracion=date(2026, 10, 1), declarado=True)
        self.documento(folio=1, neto=5832016, iva=1108083, total=6940099,
                       pedido=self.pedido(total=6940099, tipo_recibo='Factura', **declarado))
        self.documento(tipo=39, folio=2, rut_receptor='66666666-6', neto=708811, iva=134674, total=843485,
                       pedido=self.pedido(total=843485, **declarado))
        # Ni el pedido diferido ni su boleta entran en los débitos del mes.
        self.documento(tipo=39, folio=5, neto=1000, iva=190, total=1190,
                       pedido=self.pedido(mes_declaracion=date(2026, 11, 1)))
        compra = dict(operacion='compras', rut_emisor=PROVEEDOR, rut_receptor=EMPRESA, estado_sii='registrado', credito_validado=True)
        self.documento(folio=3, neto=3482358, iva=661648, anticipo=174117, total=4318123, **compra)
        self.documento(tipo=34, folio=4, neto=0, iva=0, exento=19980, total=19980, **compra)
        CierreTributario.objects.create(mes='2026-10', tasa_ppm=D('.125'), base_ppm=6540800)
        f29 = resumen_mes('2026-10')['f29']
        self.assertEqual(f29['debitos']['total'], 1242757)
        self.assertEqual(f29['debitos']['pedidos_declarados'], 2)
        self.assertEqual(f29['debitos']['documentos_no_declarados'], {'cantidad': 1, 'iva': 190})
        self.assertEqual(f29['creditos']['facturas']['monto'], 661648)
        self.assertEqual(f29['creditos']['exentas'], 19980)
        self.assertEqual(f29['iva_determinado'], 581109)
        self.assertEqual(f29['ppm']['monto'], 8176)
        self.assertEqual(f29['anticipo']['imputado'], 174117)
        self.assertEqual(f29['anticipo']['sin_validar'], 174117)
        self.assertEqual(f29['total_a_pagar'], 415168)

    def test_propuesta_f29_usa_iva_teorico_de_declarado_sin_documento(self):
        p = self.pedido(total=1190, mes_declaracion=date(2026, 10, 1), declarado=True)
        self.pedido(total=2380)  # No declarado: no suma.
        f29 = resumen_mes('2026-10')['f29']
        self.assertEqual(f29['debitos']['boletas'], {'cantidad': 1, 'monto': 190})
        self.assertEqual(f29['debitos']['pedidos_sin_documento'], [p.pk])

    def test_iva_19_y_anticipo_5_separados_con_tope_imputacion(self):
        self.importar([self.compra_fila()], compras=True)
        self.documento(neto=100000, iva=19000, total=119000)
        CierreTributario.objects.create(mes='2026-10', tasa_ppm=D('.125'), remanente_anterior=0, remanente_anticipo_anterior=0)
        r = resumen_mes('2026-10')
        self.assertEqual(r['f29_estimado']['iva_credito'], 19000)
        self.assertEqual(r['f29_estimado']['anticipo_pendiente'], 5000)
        doc = DocumentoTributario.objects.get(operacion='compras')
        respuesta = self.vincular(doc, anticipo_validado=True)
        self.assertEqual(respuesta.status_code, 200, respuesta.content)
        r = resumen_mes('2026-10')['f29_estimado']
        self.assertEqual(r['anticipo_imputado'], 0)  # Nunca paga PPM con anticipo de IVA.
        self.assertEqual(r['remanente_anticipo_siguiente'], 5000)
        DocumentoTributario.objects.filter(operacion='ventas').update(neto=110000, iva=20900, total=130900)
        r = resumen_mes('2026-10')['f29_estimado']
        self.assertEqual(r['anticipo_imputado'], 1900)
        self.assertEqual(r['remanente_anticipo_siguiente'], 3100)
        self.assertEqual(r['iva_a_pagar'], 0)

    def test_compra_sin_anticipo_y_gasto_exento(self):
        self.importar([self.compra_fila(anticipo=False)], compras=True)
        r = resumen_mes('2026-10')
        self.assertEqual(r['compras']['anticipo_documental'], 0)
        fila = self.compra_fila(2, False)
        fila[1], fila[7], fila[8], fila[9], fila[11] = 34, 5000, 0, 0, 5000
        self.assertEqual(self.importar([fila], compras=True).status_code, 201)
        d = DocumentoTributario.objects.get(operacion='compras', folio=2)
        g = Gasto.objects.create(fecha='2026-10-25', descripcion='Servicio exento', neto=5000, iva=0, total=5000)
        r = self.vincular(d, registro_tipo='gasto', registro_id=g.pk)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(resumen_mes('2026-10')['compras']['exentas'], 1)

    def test_pendientes_reclamados_sin_credito_hasta_actualizar_estado(self):
        for estado in ('pendiente', 'reclamado'):
            r = self.importar([self.compra_fila()], compras=True, estado_registro=estado)
            self.assertEqual(r.status_code, 201, r.content)
            self.assertEqual(resumen_mes('2026-10')['f29_estimado']['iva_credito'], 0)
            doc = DocumentoTributario.objects.get()
            self.assertEqual(self.vincular(doc, credito_validado=True).status_code, 400)
        self.importar([self.compra_fila()], compras=True)
        self.assertEqual(DocumentoTributario.objects.count(), 1)
        self.assertEqual(resumen_mes('2026-10')['f29_estimado']['iva_credito'], 19000)

    def test_exacta_compra_exige_folio_rut_y_tipo_no_modifica_original(self):
        f = Factura.objects.create(numero_factura='1', proveedor=self.proveedor, fecha='2026-11-01', subtotal=100000, iva=19000, anticipo_iva=0, total=119000)
        self.importar([self.compra_fila()], compras=True)
        doc = DocumentoTributario.objects.get()
        self.assertEqual(doc.factura_id, f.pk)
        self.assertEqual(doc.estado_conciliacion, 'por_revisar')
        f.refresh_from_db()
        self.assertEqual(f.fecha, date(2026, 11, 1))
        self.assertEqual(f.anticipo_iva, 0)

    def test_pedido_entregado_sin_folio_bloquea_cumplimiento(self):
        p = self.pedido(fecha_entrega=date(2026, 10, 25))
        r = resumen_mes('2026-10')
        self.assertEqual(r['ventas_sin_documento'][0]['id'], p.pk)
        self.assertFalse(r['cumplimiento_completo'])

    def test_fecha_del_pedido_define_mes_aunque_entrega_sea_distinta(self):
        p = self.pedido(fecha='2026-10-25', fecha_entrega=date(2026, 11, 2))
        octubre = resumen_mes('2026-10')
        noviembre = resumen_mes('2026-11')
        self.assertIn(p.pk, [v['id'] for v in octubre['ventas_sin_documento']])
        self.assertNotIn(p.pk, [v['id'] for v in noviembre['ventas_sin_documento']])
        self.assertEqual(octubre['pedidos_fecha_entrega_pendiente'], [])

    def test_periodo_limita_pendientes_sin_alterar_totales_documentales_del_mes(self):
        anterior = self.pedido(fecha='2026-10-20')
        actual = self.pedido(fecha='2026-10-27')
        self.documento()
        periodo = Periodo.objects.create(nombre='Actual', fecha_inicio=date(2026, 10, 26))
        r = self.client.get(reverse('conciliacion_mes'), {'mes': '2026-10', 'periodo': periodo.pk})
        self.assertEqual(r.status_code, 200, r.content)
        ids = [v['id'] for v in r.data['ventas_sin_documento']]
        self.assertIn(actual.pk, ids)
        self.assertNotIn(anterior.pk, ids)
        self.assertEqual(r.data['ventas']['iva_debito'], 190)
        self.assertEqual(r.data['pedidos_fecha_entrega_pendiente'], [])

    def test_entrega_y_emision_distinto_mes_se_conservan_y_auditan(self):
        p = self.pedido(fecha='2026-11-01', fecha_entrega=date(2026, 11, 1))
        d = self.documento(fecha_emision=date(2026, 10, 30))
        r = self.vincular(d, p)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data['diferencias']['periodo'])
        self.assertEqual(r.data['diferencias']['dias'], -2)
        p.refresh_from_db()
        self.assertEqual(p.fecha.astimezone(ZONA).date(), date(2026, 11, 1))
        self.assertEqual(p.fecha_entrega, date(2026, 11, 1))
        self.assertEqual(resumen_mes('2026-10')['ventas']['iva_debito'], 190)
        self.assertEqual(resumen_mes('2026-11')['ventas']['iva_debito'], 0)
        self.assertEqual(HistorialConciliacion.objects.get().usuario, self.user)

    def test_documentar_tarde_no_regulariza_mes_de_entrega(self):
        p = self.pedido(fecha_entrega=date(2026, 10, 25))
        d = self.documento(fecha_emision=date(2026, 11, 2), periodo_tributario='2026-11')
        self.vincular(d, p)
        self.assertIn(p.pk, resumen_mes('2026-10')['entregas_documentadas_despues'])
        self.assertFalse(resumen_mes('2026-10')['cumplimiento_completo'])

    def test_nombre_comercial_distinto_usa_razon_social_solo_como_candidato(self):
        p = self.pedido()
        self.cliente.rut = ''
        self.cliente.save()
        d = self.documento(razon_social='Casa Asa SpA')
        self.assertIn('Nombre/razón social', candidatos(d)[0]['motivos'])
        self.assertIsNone(d.pedido_id)
        self.assertEqual(candidatos(d)[0]['registro_id'], p.pk)

    def test_solo_monto_no_confirma_y_candidatos_ambiguos_no_asocian(self):
        self.pedido()
        self.pedido()
        self.importar([self.venta_fila()])
        d = DocumentoTributario.objects.get()
        self.assertEqual(len(candidatos(d)), 2)
        self.assertIsNone(d.pedido_id)

    def test_manual_desvincular_y_reimportar_preserva_decision(self):
        p = self.pedido()
        self.importar([self.venta_fila()])
        doc = DocumentoTributario.objects.get()
        self.assertEqual(self.vincular(doc, p).status_code, 200)
        self.assertEqual(self.vincular(doc).status_code, 200)
        self.importar([self.venta_fila()])
        doc.refresh_from_db()
        self.assertIsNone(doc.pedido_id)
        self.assertEqual(HistorialConciliacion.objects.filter(accion='desvincular').count(), 1)

    def test_no_duplica_respaldo_y_exige_justificacion(self):
        p = self.pedido()
        a, b = self.documento(), self.documento(folio=2)
        self.assertEqual(self.vincular(a, p, justificacion='').status_code, 400)
        self.assertEqual(self.vincular(a, p).status_code, 200)
        self.assertEqual(self.vincular(b, p).status_code, 400)

    def test_historicos_anteriores_inicio_no_se_borran_ni_generan_impuesto(self):
        p = self.pedido(fecha='2026-10-01')
        self.documento(fecha_emision=date(2026, 10, 1))
        r = resumen_mes('2026-10')
        self.assertEqual(r['ventas']['iva_debito'], 0)
        self.assertEqual(r['pedidos_historicos'], [p.pk])
        self.assertEqual(Pedido.objects.count(), 1)
        self.assertEqual(DocumentoTributario.objects.count(), 1)

    def test_recalcular_mes_al_importar_y_declaracion_conserva_copia(self):
        self.importar([self.venta_fila()])
        self.assertEqual(resumen_mes('2026-10')['ventas']['iva_debito'], 190)
        r = self.client.put(reverse('conciliacion_mes'), {'mes': '2026-10', 'tasa_ppm': '.125',
                 'remanente_anterior': 0, 'remanente_anticipo_anterior': 0, 'fundamento': 'F29 y tasa verificados',
                 'declarado': {'folio_f29': '123', 'fecha': '2026-11-02', 'total_pagado': 191}}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.importar([self.venta_fila(2)])
        self.assertEqual(resumen_mes('2026-10')['ventas']['iva_debito'], 380)
        self.assertEqual(CierreTributario.objects.get().declarado['resumen_al_declarar']['ventas']['iva_debito'], '190.00')

    def test_exclusion_credito_y_anticipo_validados_se_conservan_al_reimportar(self):
        self.importar([self.compra_fila()], compras=True)
        doc = DocumentoTributario.objects.get()
        self.vincular(doc, credito_validado=False, anticipo_validado=True)
        self.importar([self.compra_fila()], compras=True)
        doc.refresh_from_db()
        self.assertFalse(doc.credito_validado)
        self.assertTrue(doc.anticipo_validado)

    def test_cambio_monto_interno_invalida_conciliacion_visible(self):
        p = self.pedido()
        doc = self.documento()
        self.vincular(doc, p)
        Pedido.objects.filter(pk=p.pk).update(total=1200)
        self.assertEqual(resumen_mes('2026-10')['documentos'][0]['estado_conciliacion'], 'por_revisar')

    def test_numeros_chilenos_folios_ruts_y_redondeo(self):
        self.assertEqual(_monto('$ 1.234.567,50'), D('1234567.50'))
        self.assertEqual(pesos(D('190.5')), 191)
        self.assertEqual(validar_rut('78.537.642-0'), EMPRESA)
        for rut in ('78537642-1', 'abc', '78.537.642-0extra'):
            with self.assertRaises(ValueError):
                validar_rut(rut)
        for valor in ('1.23', 'abc', 'NaN'):
            with self.assertRaises(ValueError):
                _monto(valor)
        fila = self.venta_fila()
        fila[5] = '123abc'
        self.assertEqual(self.importar([fila]).status_code, 400)

    def test_boletas_sin_rut_con_operacion_explicita(self):
        encabezado = ['Tipo Doc', 'Folio', 'Fecha Emision', 'Monto Exento', 'Monto Neto', 'Monto IVA', 'Monto Total']
        r = self.client.post(reverse('cierre_sii'), {'archivo': csv(encabezado, [39, 7, '25/10/2026', 0, 1000, 190, 1190]), 'mes': '2026-10', 'operacion': 'ventas'})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(DocumentoTributario.objects.get().rut_receptor, '')

    def test_fechas_emision_y_periodo_registro_compra_son_independientes(self):
        fila = self.compra_fila()
        fila[6] = '20/09/2026'
        self.importar([fila], compras=True)
        doc = DocumentoTributario.objects.get()
        self.assertEqual(doc.periodo_tributario, '2026-10')
        self.assertEqual(resumen_mes('2026-10')['f29_estimado']['iva_credito'], 0)  # Anterior a inicio: validar.

    def test_desglose_distinto_del_total_visible_y_documentos_sin_vinculo(self):
        self.documento(total=1240)
        r = resumen_mes('2026-10')
        self.assertIn('Total no cuadra', ' '.join(r['documentos'][0]['diferencias']['motivos']))
        self.assertEqual(r['indicadores']['sin_coincidencia'], 1)

    def test_mes_invalido_y_autenticacion(self):
        for mes in ('2026-13', 'abc', '2026-1'):
            self.assertEqual(self.client.get(reverse('conciliacion_mes'), {'mes': mes}).status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse('conciliacion_mes'), {'mes': '2026-10'}).status_code, 401)

    def test_octubre_totales_proporcionados_y_candidatos_casa_asa_boletas(self):
        facturas = [(6, 291, 964209), (7, 290, 1369357), (8, 307, 2446207), (9, 327, 2160326)]
        filas = []
        for folio, pid, total in facturas:
            neto = pesos(D(total) / D('1.19'))
            filas.append(self.venta_fila(folio, total, neto, total - neto))
            if folio == 9:
                filas[-1][6] = '30/10/2026'
            self.pedido(total=total, id=pid, fecha='2026-11-01' if pid == 327 else '2026-10-25')
        # Ajustar solo el fixture al neto agregado entregado (redondeo por documento).
        diferencia = D(5832016) - sum(f[9] for f in filas)
        filas[-1][9] += diferencia
        filas[-1][10] -= diferencia
        boletas = []
        otros = iter([50000] * 13 + [61908])
        for folio in range(1, 17):
            total = 109110 if folio == 7 else 22461 if folio == 13 else next(otros)
            neto = pesos(D(total) / D('1.19'))
            boletas.append([1, 39, '', '', '', folio, '25/10/2026', '', 0, neto, total - neto, total])
        diferencia = D(708805) - sum(f[9] for f in boletas)
        boletas[-1][9] += diferencia
        boletas[-1][10] -= diferencia
        self.pedido(id=295, total=109110)
        self.pedido(id=302, total=22461)
        r = self.importar(filas + boletas)
        self.assertEqual(r.status_code, 201, r.content)
        resumen = resumen_mes('2026-10')
        self.assertEqual(resumen['ventas']['facturas'], 4)
        self.assertEqual(resumen['ventas']['boletas'], 16)
        self.assertEqual(resumen['ventas']['neto'], 6540821)
        self.assertEqual(resumen['ventas']['iva_debito'], 1242757)
        self.assertEqual(resumen['ventas']['total'], 7783578)
        self.assertFalse(DocumentoTributario.objects.filter(pedido__isnull=False).exists())
        for folio, pid, _ in facturas:
            self.assertEqual(candidatos(DocumentoTributario.objects.get(tipo=33, folio=folio))[0]['registro_id'], pid)
        for folio, pid in [(7, 295), (13, 302)]:
            self.assertEqual(candidatos(DocumentoTributario.objects.get(tipo=39, folio=folio))[0]['registro_id'], pid)
        r = self.client.put(reverse('conciliacion_mes'), {'mes': '2026-10', 'tasa_ppm': '.125', 'base_ppm': 6540826,
               'ppm_informado_sii': 8176, 'remanente_anterior': 0, 'remanente_anticipo_anterior': 0,
               'fundamento': 'Comparación con códigos 563, 115 y 62 entregados por usuario'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['ppm']['estimado'], 8176)
        self.assertEqual(r.data['ppm']['diferencia'], 0)
        self.assertEqual(r.data['ppm']['base_utilizada'] - r.data['ppm']['base_estimada_documental'], 5)

    def test_cuatro_compras_octubre_diferencias_reales_sin_inventar_bases(self):
        for folio, interno, sii, fecha in [(651811, 1858625, 1936719, '2026-11-01'),
                (67636, 44254, 45435, '2026-10-29'), (39512756, 555594, 579573, '2026-10-29'),
                (650276, 1729175, 1801829, '2026-10-27')]:
            # Bases no proporcionadas: cero explícito en fixture, desglose requiere revisión.
            Factura.objects.create(numero_factura=str(folio), proveedor=self.proveedor, fecha=fecha,
                                   subtotal=0, iva=0, total=interno)
            fila = self.compra_fila(folio, False)
            fila[8], fila[9], fila[11] = 0, 0, sii
            self.assertEqual(self.importar([fila], compras=True).status_code, 201)
        docs = resumen_mes('2026-10')['documentos']
        difs = {d['folio']: d['diferencias']['monto'] for d in docs}
        self.assertEqual(difs, {651811: D(78094), 67636: D(1181), 39512756: D(23979), 650276: D(72654)})
        self.assertTrue(all(d['estado_conciliacion'] == 'por_revisar' for d in docs))

    def test_reimportar_no_oculta_cambio_interno_posterior_a_revision(self):
        p = self.pedido()
        self.importar([self.venta_fila()])
        doc = DocumentoTributario.objects.get()
        self.vincular(doc, p)
        Pedido.objects.filter(pk=p.pk).update(total=1300)
        self.importar([self.venta_fila()])
        self.assertEqual(resumen_mes('2026-10')['documentos'][0]['estado_conciliacion'], 'por_revisar')

    def test_columna_monetaria_desconocida_no_desaparece_del_detalle(self):
        r = self.client.post(reverse('cierre_sii'), {'archivo': csv(VENTAS_ENC + ['IVA Retenido Parcial'], self.venta_fila() + [50]), 'mes': '2026-10'})
        self.assertEqual(r.status_code, 201, r.content)
        r = resumen_mes('2026-10')
        self.assertEqual(r['documentos'][0]['columnas_pendientes'], ['IVA Retenido Parcial'])
        self.assertIn('sin interpretar', ' '.join(r['advertencias']))
        self.assertFalse(r['cumplimiento_completo'])

    def test_declaracion_invalida_no_sobrescribe_parametros_y_original_no_se_edita(self):
        CierreTributario.objects.create(mes='2026-10', tasa_ppm=D('.125'))
        r = self.client.put(reverse('conciliacion_mes'), {'mes': '2026-10', 'tasa_ppm': 5, 'fundamento': 'Prueba',
                  'declarado': {'folio_f29': '123', 'total_pagado': 'NaN', 'fecha': '2026-11-02'}}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(CierreTributario.objects.get().tasa_ppm, D('.125'))
        d = self.documento()
        r = self.vincular(d, folio=99)
        self.assertEqual(r.status_code, 400)
        d.refresh_from_db()
        self.assertEqual(d.folio, 1)

    def test_datos_empresa_archivo_y_periodo_invalidos_revierten_importacion(self):
        archivo = csv(VENTAS_ENC, self.venta_fila())
        archivo.name = 'RCV_VENTAS_76123456-0_202610.csv'
        r = self.client.post(reverse('cierre_sii'), {'archivo': archivo, 'mes': '2026-10'})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(DocumentoTributario.objects.exists())
        self.assertFalse(ImportacionSII.objects.exists())

    def test_sin_tasa_base_y_remanentes_total_f29_es_desconocido(self):
        self.documento()
        r = resumen_mes('2026-10')
        self.assertIsNone(r['ppm']['estimado'])
        self.assertIsNone(r['f29_estimado']['total_estimado'])

    def test_no_traslada_ventas_por_mes_seleccionado_y_rechaza_fecha_sin_anio(self):
        r = self.importar([self.venta_fila()], mes='2026-11')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(DocumentoTributario.objects.exists())
        fila = self.venta_fila()
        fila[6] = '25/10'
        self.assertEqual(self.importar([fila]).status_code, 400)

    def test_reutiliza_documento_local_con_rut_formateado_sin_duplicar(self):
        p = self.pedido()
        d = self.documento(rut_receptor='76.123.456-0', pedido=p, origen='manual')
        r = self.importar([self.venta_fila()])
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(DocumentoTributario.objects.count(), 1)
        d.refresh_from_db()
        self.assertEqual(d.pedido_id, p.pk)
        self.assertEqual(d.rut_receptor, CLIENTE)

    def test_tesoreria_incluye_mes_con_solo_compra_rcv_sin_factura_interna(self):
        from .contabilidad import resumen_mensual
        self.importar([self.compra_fila(anticipo=False)], compras=True)
        filas, _ = resumen_mensual()
        self.assertEqual(len(filas), 1)
        self.assertEqual(filas[0]['mes'], '2026-10')
        self.assertEqual(filas[0]['iva_credito_sii'], 19000)

    def test_pagadero_explicito_consistente_en_factura_y_tesoreria(self):
        from .serializers import FacturaSerializer
        from .models import NotaCredito
        f = Factura.objects.create(numero_factura='1', proveedor=self.proveedor, fecha='2026-10-25',
                                   subtotal=100000, iva=19000, total=124000, anticipo_iva=5000, total_pagadero=120000)
        NotaCredito.objects.create(factura=f, numero='NC1', fecha='2026-10-25', neto=1000, iva=190, total=1190)
        self.assertEqual(D(FacturaSerializer(f).data['total_a_pagar']), 118810)
        r = self.client.get(reverse('contabilidad'))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['estado']['por_pagar'], 118810)
