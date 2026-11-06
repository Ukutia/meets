"""Autenticación automática del SII: pedir semilla, firmarla y canjearla por
un token (servicios SOAP CrSeed y GetTokenFromSeed).

El mismo token sirve como cookie TOKEN para los servicios web del SII, como
el Registro de Compras y Ventas.
"""
import urllib.error
import urllib.request
from xml.sax.saxutils import escape

from django.core.cache import cache
from lxml import etree

from . import SIIError, certificado, firma

HOSTS = {'produccion': 'palena.sii.cl', 'certificacion': 'maullin.sii.cl'}
TIMEOUT = 30
DURACION_TOKEN = 30 * 60  # el SII no publica la vigencia; se renueva antes de que expire
USER_AGENT = 'Mozilla/5.0 (compatible; MeatYourMatch/1.0)'

_SOBRE = ('<?xml version="1.0" encoding="UTF-8"?>'
          '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
          '<soapenv:Header/><soapenv:Body>{}</soapenv:Body></soapenv:Envelope>')


def _soap(url, cuerpo):
    req = urllib.request.Request(url, data=_SOBRE.format(cuerpo).encode(), method='POST', headers={
        'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""', 'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            respuesta = r.read()
    except urllib.error.HTTPError as e:
        raise SIIError(f'El SII respondió {e.code} en {url.split("/")[-1]}') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SIIError(f'No se pudo conectar con el SII: {e}') from e
    return _respuesta_interna(respuesta)


def _respuesta_interna(respuesta):
    """El SII devuelve un XML escapado dentro de <...Return>; lo desenvuelve."""
    try:
        sobre = etree.fromstring(respuesta)
        texto = next((el.text for el in sobre.iter() if isinstance(el.tag, str)
                      and etree.QName(el).localname.endswith('Return')), None)
        if not texto:
            raise SIIError('Respuesta del SII sin contenido')
        return etree.fromstring(texto.strip().encode())
    except etree.XMLSyntaxError as e:
        raise SIIError('Respuesta del SII ilegible') from e


def _campo(xml, nombre):
    resultado = xml.xpath(f'//*[local-name()="{nombre}"]/text()')
    return resultado[0].strip() if resultado else ''


def _revisar(xml, paso):
    estado = _campo(xml, 'ESTADO')
    if estado != '00':
        # El SII manda los acentos ya dañados ("Inv\xef\xbf\xbdlido"); se dejan como "?".
        glosa = (_campo(xml, 'GLOSA') or 'sin detalle').replace('\xef\xbf\xbd', '?')
        raise SIIError(f'El SII rechazó {paso} (estado {estado or "?"}: {glosa})')


def semilla(ambiente='produccion'):
    xml = _soap(f'https://{HOSTS[ambiente]}/DTEWS/CrSeed.jws', '<getSeed/>')
    _revisar(xml, 'la semilla')
    return _campo(xml, 'SEMILLA')


def xml_token(valor_semilla, cert):
    raiz = etree.fromstring(f'<getToken><item><Semilla>{escape(valor_semilla)}</Semilla></item></getToken>')
    return etree.tostring(firma.firmar(raiz, cert), xml_declaration=True, encoding='UTF-8').decode()


def token(ambiente='produccion', forzar=False):
    clave = f'sii-token-{ambiente}'
    if not forzar and (t := cache.get(clave)):
        return t
    cert = certificado.cargar()
    firmado = xml_token(semilla(ambiente), cert)
    xml = _soap(f'https://{HOSTS[ambiente]}/DTEWS/GetTokenFromSeed.jws',
                f'<getToken><pszXml>{escape(firmado)}</pszXml></getToken>')
    _revisar(xml, 'el certificado')
    t = _campo(xml, 'TOKEN')
    if not t:
        raise SIIError('El SII no entregó token')
    cache.set(clave, t, DURACION_TOKEN)
    return t
