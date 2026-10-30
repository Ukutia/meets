import base64
import os
import tempfile
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse

from . import openfactura
from .models import DocumentoTributario, Pedido
from .test_cierre import CierreBase

ORG = {'rut': '76795561-8', 'razonSocial': 'MEAT YOUR MATCH SPA', 'direccion': 'Calle 1', 'comuna': 'Santiago',
       'cdgSIISucur': '123', 'actividades': [{'giro': 'VENTA DE CARNES', 'actividadPrincipal': True}]}
PDF = base64.b64encode(b'%PDF-1.4 prueba').decode()


class FalsoOpenFactura:
    """Reemplaza openfactura._pedir: guarda lo enviado y responde como el sandbox."""

    def __init__(self):
        self.emitidos = {}
        self.enviados = []

    def __call__(self, metodo, ruta, cuerpo=None, encabezados=None):
        if ruta == '/v2/dte/organization':
            return ORG
        if ruta == '/v2/dte/document':
            self.enviados.append(cuerpo)
            clave = encabezados['Idempotency-Key']
            if clave in self.emitidos:
                raise openfactura.OpenFacturaError('Este DTE ya fue emitido (Idempotency-Key)', 'OF-06',
                                                   [{'field': 'token', 'issue': self.emitidos[clave]}], 400)
            self.emitidos[clave] = f'tok{len(self.emitidos) + 1}'
            return {'TOKEN': self.emitidos[clave], 'FOLIO': 700 + len(self.emitidos), 'PDF': PDF,
                    'WARNING': [{'RznSocEmisor': 'no corresponde'}]}
        if ruta.endswith('/status'):
            return {'estado': 'Aceptado'}
        if ruta.endswith('/json'):
            token = ruta.split('/')[-2]
            folio = 700 + list(self.emitidos.values()).index(token) + 1
            return {'json': {'Encabezado': {'IdDoc': {'Folio': str(folio)}}}}
        raise AssertionError(ruta)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class EmitirBoletaTests(CierreBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.falso = FalsoOpenFactura()
        self.patches = [mock.patch.object(openfactura, '_pedir', self.falso),
                        mock.patch.dict(os.environ, {'OPENFACTURA_API_KEY': 'k', 'OPENFACTURA_URL': openfactura.URL_PRUEBAS})]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def emitir(self):
        return self.client.post(reverse('emitir_boleta', args=[self.pedido.id]))

    def test_emite_boleta_con_montos_del_pedido(self):
        r = self.emitir()
        self.assertEqual(r.status_code, 201, r.content)
        dte = self.falso.enviados[0]['dte']
        self.assertEqual(dte['Encabezado']['IdDoc']['TipoDTE'], 39)
        self.assertEqual(dte['Encabezado']['Totales'], {'MntNeto': 20168, 'IVA': 3832, 'MntTotal': 24000})
        self.assertEqual(dte['Encabezado']['Receptor'], {'RUTRecep': '66666666-6'})
        self.assertEqual(dte['Encabezado']['Emisor']['RznSocEmisor'], 'MEAT YOUR MATCH SPA')
        self.assertEqual(dte['Detalle'][0]['NmbItem'], 'Lomo (2 kg)')
        doc = DocumentoTributario.objects.get()
        self.assertEqual((doc.folio, doc.origen, doc.ambiente, doc.estado_sii), (701, 'openfactura', 'pruebas', 'Aceptado'))
        self.assertTrue(doc.pdf.read().startswith(b'%PDF'))
        self.assertIn('no corresponde', doc.comentario)

    def test_boleta_de_prueba_no_marca_el_pedido_como_emitido(self):
        self.emitir()
        datos = self.ventas()
        self.assertEqual(datos['pedidos'][0]['estado_tributario'], 'pendiente')
        self.assertEqual(float(datos['resumen']['iva_debito_documentos']), 0)
        self.assertEqual(datos['config']['emision'], {'habilitada': True, 'ambiente': 'pruebas'})

    def test_en_produccion_cuenta_y_no_se_puede_borrar(self):
        with mock.patch.dict(os.environ, {'OPENFACTURA_URL': openfactura.URL_PRODUCCION}):
            self.emitir()
            doc = DocumentoTributario.objects.get()
            self.assertEqual(doc.ambiente, 'produccion')
            self.assertEqual(self.ventas()['pedidos'][0]['estado_tributario'], 'emitido')
            self.assertEqual(self.client.delete(reverse('cierre_documento', args=[doc.id])).status_code, 400)

    def test_no_emite_dos_veces(self):
        self.assertEqual(self.emitir().status_code, 201)
        r = self.emitir()
        self.assertEqual(r.status_code, 400)
        self.assertIn('ya tiene', r.json()['error'])

    def test_reintento_recupera_la_misma_boleta(self):
        # La boleta se emitió pero no alcanzó a guardarse aquí (p. ej. se cortó la conexión).
        self.emitir()
        DocumentoTributario.objects.all().delete()
        r = self.emitir()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['folio'], 701)
        self.assertEqual(len(self.falso.emitidos), 1)

    def test_pedido_sin_pesar_no_se_emite(self):
        Pedido.objects.filter(pk=self.pedido.pk).update(estado='Reservado')
        self.assertEqual(self.emitir().status_code, 400)
        self.assertEqual(self.falso.enviados, [])

    def test_sin_clave_no_emite(self):
        with mock.patch.dict(os.environ, {'OPENFACTURA_API_KEY': ''}):
            r = self.emitir()
        self.assertEqual(r.status_code, 400)
        self.assertIn('OPENFACTURA_API_KEY', r.json()['error'])

    def test_error_de_openfactura_se_informa(self):
        def falla(*a, **k):
            if a[1] == '/v2/dte/organization':
                return ORG
            raise openfactura.OpenFacturaError('Validación de Campos', 'OF-10', [{'field': 'IVA', 'issue': 'Debe Indicar IVA'}], 400)
        with mock.patch.object(openfactura, '_pedir', falla):
            r = self.emitir()
        self.assertEqual(r.status_code, 502)
        self.assertIn('IVA: Debe Indicar IVA', r.json()['error'])
        self.assertFalse(DocumentoTributario.objects.exists())

    def test_cliente_con_rut_va_como_receptor(self):
        self.cliente.rut, self.cliente.razon_social = '76.123.456-7', 'El Fogón SpA'
        self.cliente.save()
        self.emitir()
        self.assertEqual(self.falso.enviados[0]['dte']['Encabezado']['Receptor'],
                         {'RUTRecep': '76123456-7', 'RznSocRecep': 'El Fogón SpA'})

    def test_actualizar_estado(self):
        self.emitir()
        doc = DocumentoTributario.objects.get()
        DocumentoTributario.objects.filter(pk=doc.pk).update(estado_sii='')
        r = self.client.post(reverse('estado_documento', args=[doc.id]))
        self.assertEqual(r.json()['estado_sii'], 'Aceptado')
