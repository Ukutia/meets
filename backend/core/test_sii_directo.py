"""Conexión directa al SII. Sin red: el certificado se genera en la prueba y
las respuestas del SII se simulan con el formato de sus servicios."""
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from xml.sax.saxutils import escape

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import BestAvailableEncryption, pkcs12
from cryptography.x509.oid import NameOID
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from lxml import etree
from rest_framework.test import APIClient

from .models import ConfiguracionContable, DocumentoTributario, ImportacionSII
from .sii_dte import SIIError, auth, certificado, firma, rcv
from .test_cierre import COMPRAS_ENC, VENTAS_ENC

EMPRESA = '78537642-0'
CLAVE = 'secreta'


def generar_pfx(rut='12345678-5'):
    llave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'PERSONA DE PRUEBA')])
    # otherName con el RUT como IA5String (cryptography agrega el [0] EXPLICIT).
    valor = rut.encode()
    der = b'\x16' + bytes([len(valor)]) + valor
    ahora = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nombre).issuer_name(nombre).public_key(llave.public_key())
            .serial_number(1).not_valid_before(ahora - timedelta(days=1)).not_valid_after(ahora + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.OtherName(certificado.OID_RUT, der)]), critical=False)
            .sign(llave, hashes.SHA256()))
    return pkcs12.serialize_key_and_certificates(b'prueba', llave, cert, None, BestAvailableEncryption(CLAVE.encode()))


PFX = generar_pfx()


def respuesta_sii(metodo, interno):
    """Sobre SOAP con el XML interno escapado, como responde el SII."""
    return (f'<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
            f'<soapenv:Body><ns1:{metodo}Response xmlns:ns1="urn:x"><ns1:{metodo}Return>{escape(interno)}'
            f'</ns1:{metodo}Return></ns1:{metodo}Response></soapenv:Body></soapenv:Envelope>').encode()


SEMILLA_OK = ('<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">'
              '<SII:RESP_BODY><SEMILLA>041738920115</SEMILLA></SII:RESP_BODY>'
              '<SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>')
TOKEN_OK = ('<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema">'
            '<SII:RESP_BODY><TOKEN>ABC123TOKEN</TOKEN></SII:RESP_BODY>'
            '<SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>')
TOKEN_MAL = ('<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR><ESTADO>08</ESTADO>'
             '<GLOSA>Error de Firma</GLOSA></SII:RESP_HDR></SII:RESPUESTA>')


class Respuesta:
    def __init__(self, cuerpo):
        self.cuerpo = cuerpo

    def read(self):
        return self.cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@mock.patch.dict('os.environ', {'SII_CERT_PFX_B64': __import__('base64').b64encode(PFX).decode(),
                                'SII_CERT_PASSWORD': CLAVE})
class CertificadoYFirmaTests(SimpleTestCase):
    def test_carga_pfx_y_lee_rut_del_titular(self):
        c = certificado.cargar()
        self.assertTrue(certificado.configurado())
        self.assertEqual(c.titular, 'PERSONA DE PRUEBA')
        self.assertEqual(c.rut, '12345678-5')

    def test_clave_incorrecta_da_mensaje_claro(self):
        with self.assertRaisesMessage(SIIError, 'SII_CERT_PASSWORD'):
            certificado.desde_pfx(PFX, 'otra')

    def test_firma_envolvente_verificable_y_detecta_alteraciones(self):
        c = certificado.cargar()
        xml = auth.xml_token('041738920115', c)
        raiz = etree.fromstring(xml.encode())
        self.assertEqual(raiz.findtext('item/Semilla'), '041738920115')
        firma.verificar(raiz, c.llave.public_key())
        sig = raiz.find(f'{{{firma.DS}}}Signature')
        self.assertEqual(sig.find(f'.//{{{firma.DS}}}Reference').get('URI'), '')
        self.assertIsNotNone(sig.find(f'.//{{{firma.DS}}}X509Certificate'))
        raiz.find('item/Semilla').text = '999'
        with self.assertRaises(ValueError):
            firma.verificar(raiz, c.llave.public_key())


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
@mock.patch.dict('os.environ', {'SII_CERT_PFX_B64': __import__('base64').b64encode(PFX).decode(),
                                'SII_CERT_PASSWORD': CLAVE})
class TokenTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_semilla_firmada_se_canjea_por_token_y_se_cachea(self):
        enviados = []

        def urlopen(req, timeout):
            enviados.append(req)
            return Respuesta(respuesta_sii('getSeed', SEMILLA_OK) if 'CrSeed' in req.full_url
                             else respuesta_sii('getToken', TOKEN_OK))

        with mock.patch('urllib.request.urlopen', urlopen):
            self.assertEqual(auth.token(), 'ABC123TOKEN')
            self.assertEqual(auth.token(), 'ABC123TOKEN')
        self.assertEqual(len(enviados), 2)
        self.assertIn('palena.sii.cl', enviados[0].full_url)
        # El XML firmado va escapado dentro de pszXml y contiene la semilla.
        cuerpo = etree.fromstring(enviados[1].data)
        firmado = etree.fromstring(cuerpo.xpath('//pszXml/text()')[0].encode())
        self.assertEqual(firmado.findtext('item/Semilla'), '041738920115')
        firma.verificar(firmado, certificado.cargar().llave.public_key())

    def test_rechazo_del_sii_muestra_glosa(self):
        def urlopen(req, timeout):
            return Respuesta(respuesta_sii('getSeed', SEMILLA_OK) if 'CrSeed' in req.full_url
                             else respuesta_sii('getToken', TOKEN_MAL))

        with mock.patch('urllib.request.urlopen', urlopen), self.assertRaisesMessage(SIIError, 'Error de Firma'):
            auth.token()


class RCVTests(SimpleTestCase):
    def test_lineas_de_la_exportacion(self):
        self.assertEqual(rcv.lineas({'data': ['a;b', '1;2', ''], 'respEstado': {'codRespuesta': 0}}), ['a;b', '1;2'])
        self.assertEqual(rcv.lineas({'data': 'a;b\n1;2'}), ['a;b', '1;2'])
        self.assertEqual(rcv.lineas({'data': [], 'respEstado': {'codRespuesta': 0}}), [])
        with self.assertRaisesMessage(SIIError, 'Error interno'):
            rcv.lineas({'data': None, 'respEstado': {'codRespuesta': 2, 'msgeRespuesta': 'Error interno'}})

    def test_cuerpo_de_compras_y_ventas(self):
        c = rcv._cuerpo('getDetalleCompraExport', 'T', EMPRESA, '2026-10', 'compras', 'pendiente')
        self.assertEqual(c['data'], {'rutEmisor': '78537642', 'dvEmisor': '0', 'ptributario': '202610', 'codTipoDoc': 0,
                                     'operacion': 'COMPRA', 'estadoContab': 'PENDIENTE'})
        self.assertEqual(c['metaData']['conversationId'], 'T')
        self.assertTrue(c['metaData']['namespace'].endswith('/getDetalleCompraExport'))
        self.assertEqual(rcv._cuerpo('getDetalleVentaExport', 'T', EMPRESA, '2026-10', 'ventas', '')['data']['operacion'], 'VENTA')

    def test_sesion_vencida_renueva_token_una_vez(self):
        tokens = iter(['viejo', 'nuevo'])
        pedidos = []

        def pedir(metodo, cuerpo, tok):
            pedidos.append(tok)
            if tok == 'viejo':
                raise rcv.TokenVencido('x')
            return {'data': ['Nro;Folio', '1;5']}

        with mock.patch.object(rcv.auth, 'token', lambda amb, forzar=False: next(tokens)), \
                mock.patch.object(rcv, '_pedir', pedir):
            self.assertEqual(rcv.descargar(EMPRESA, '2026-10', 'ventas'), b'Nro;Folio\n1;5')
        self.assertEqual(pedidos, ['viejo', 'nuevo'])


def csv_bytes(*filas):
    return '\n'.join(';'.join(map(str, f)) for f in filas).encode()


VENTA = csv_bytes(VENTAS_ENC, [1, 33, 'Del Giro', '76123456-0', 'Casa Asa SpA', 7, '25/10/2026', '', 0, 1000, 190, 1190])
COMPRA = csv_bytes(COMPRAS_ENC, [1, 33, 'Del Giro', '77777777-7', 'Frigorífico', 651811, '20/10/2026', 0, 100000, 19000, 0,
                                 124000, 18, 5000, 5])


class SincronizarTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='contador'))
        ConfiguracionContable.objects.update_or_create(pk=1, defaults={
            'rut_empresa': EMPRESA, 'inicio_actividades': date(2026, 10, 19)})

    def sincronizar(self, descargar):
        with mock.patch.object(certificado, 'configurado', lambda: True), \
                mock.patch.object(rcv, 'descargar', descargar):
            return self.client.post(reverse('cierre_sii_sincronizar'), {'mes': '2026-10'}, format='json')

    @staticmethod
    def sii_simulado(rut, mes, operacion, estado):
        if operacion == 'ventas':
            return VENTA
        return COMPRA if estado == 'registrado' else b''

    def test_importa_ventas_y_compras_y_no_repite_secciones_iguales(self):
        r = self.sincronizar(self.sii_simulado)
        self.assertEqual(r.status_code, 200, r.content)
        resultados = {(s['operacion'], s['estado_registro']): s['resultado'] for s in r.data['secciones']}
        self.assertEqual(resultados[('ventas', '')], 'importado')
        self.assertEqual(resultados[('compras', 'registrado')], 'importado')
        self.assertEqual(resultados[('compras', 'pendiente')], 'sin_documentos')
        compra = DocumentoTributario.objects.get(operacion='compras')
        self.assertEqual((compra.folio, compra.estado_sii, compra.anticipo), (651811, 'registrado', 5000))
        self.assertEqual(DocumentoTributario.objects.get(operacion='ventas').rut_emisor, EMPRESA)
        imp = ImportacionSII.objects.get(tipo='compras')
        self.assertEqual(imp.nombre_archivo, f'RCV_COMPRAS_REGISTRADO_{EMPRESA}_202610.csv')
        self.assertIsNotNone(imp.datos_actualizados_al)

        r = self.sincronizar(self.sii_simulado)
        self.assertEqual({s['resultado'] for s in r.data['secciones']}, {'sin_cambios', 'sin_documentos'})
        self.assertEqual(ImportacionSII.objects.count(), 2)
        self.assertEqual(DocumentoTributario.objects.count(), 2)

    def test_sii_caido_responde_error_sin_importar(self):
        def falla(*a):
            raise SIIError('No se pudo conectar con el SII')

        r = self.sincronizar(falla)
        self.assertEqual(r.status_code, 502)
        self.assertIn('No se pudo conectar', r.data['error'])
        self.assertFalse(ImportacionSII.objects.exists())

    def test_sin_certificado(self):
        with mock.patch.object(certificado, 'configurado', lambda: False):
            r = self.client.post(reverse('cierre_sii_sincronizar'), {'mes': '2026-10'}, format='json')
        self.assertEqual(r.status_code, 400)
        r = self.client.get(reverse('cierre_sii_conexion'))
        self.assertEqual(r.data, {'configurado': False})
