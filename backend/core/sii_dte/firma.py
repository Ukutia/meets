"""Firma XMLDSig envolvente como la exige el SII: C14N inclusivo, RSA-SHA1,
digest SHA1, Reference URI="" y KeyInfo con RSAKeyValue y X509Certificate.

El SII sigue exigiendo SHA1; por eso se firma a mano en vez de usar una
librería que lo rechace por defecto.
"""
import base64
import hashlib

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from lxml import etree

DS = 'http://www.w3.org/2000/09/xmldsig#'
C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'


def _b64(datos):
    return base64.b64encode(datos).decode()


def _entero_b64(n):
    return _b64(n.to_bytes((n.bit_length() + 7) // 8, 'big'))


def _sub(padre, nombre, texto=None, **attrs):
    el = etree.SubElement(padre, f'{{{DS}}}{nombre}', **attrs)
    if texto is not None:
        el.text = texto
    return el


def _digest(raiz):
    return _b64(hashlib.sha1(etree.tostring(raiz, method='c14n')).digest())


def firmar(raiz, cert):
    """Agrega <Signature> al final de `raiz` (el documento completo) y lo devuelve."""
    digest = _digest(raiz)
    firma = etree.SubElement(raiz, f'{{{DS}}}Signature', nsmap={None: DS})
    info = _sub(firma, 'SignedInfo')
    _sub(info, 'CanonicalizationMethod', Algorithm=C14N)
    _sub(info, 'SignatureMethod', Algorithm=DS + 'rsa-sha1')
    ref = _sub(info, 'Reference', URI='')
    _sub(_sub(ref, 'Transforms'), 'Transform', Algorithm=DS + 'enveloped-signature')
    _sub(ref, 'DigestMethod', Algorithm=DS + 'sha1')
    _sub(ref, 'DigestValue', digest)
    valor = _sub(firma, 'SignatureValue')
    key_info = _sub(firma, 'KeyInfo')
    numeros = cert.llave.public_key().public_numbers()
    rsa_kv = _sub(_sub(key_info, 'KeyValue'), 'RSAKeyValue')
    _sub(rsa_kv, 'Modulus', _entero_b64(numeros.n))
    _sub(rsa_kv, 'Exponent', _entero_b64(numeros.e))
    _sub(_sub(key_info, 'X509Data'), 'X509Certificate', cert.der_b64)
    firmado = cert.llave.sign(etree.tostring(info, method='c14n'), padding.PKCS1v15(), hashes.SHA1())
    valor.text = _b64(firmado)
    return raiz


def verificar(raiz, llave_publica):
    """Comprueba digest y firma de un documento firmado con `firmar`. Lanza
    InvalidSignature o ValueError si no calza (se usa en pruebas)."""
    firma = raiz.find(f'{{{DS}}}Signature')
    info = firma.find(f'{{{DS}}}SignedInfo')
    copia = etree.fromstring(etree.tostring(raiz))
    copia.remove(copia.find(f'{{{DS}}}Signature'))
    if _digest(copia) != info.findtext(f'.//{{{DS}}}DigestValue'):
        raise ValueError('El digest no coincide')
    llave_publica.verify(base64.b64decode(firma.findtext(f'{{{DS}}}SignatureValue')),
                         etree.tostring(info, method='c14n'), padding.PKCS1v15(), hashes.SHA1())
