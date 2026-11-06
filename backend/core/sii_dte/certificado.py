"""Certificado digital (.pfx) de la persona autorizada ante el SII.

Configuración (nunca en el repositorio ni en la base de datos):
- SII_CERT_PFX_B64: el archivo .pfx codificado en base64 (Railway), o
  SII_CERT_PFX_PATH: ruta al .pfx (desarrollo local).
- SII_CERT_PASSWORD: clave del .pfx.
"""
import base64
import os
import re
from dataclasses import dataclass
from datetime import datetime

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, pkcs12
from cryptography.x509.oid import NameOID

from . import SIIError

# Extensión otherName donde las entidades certificadoras chilenas guardan el RUT.
OID_RUT = x509.ObjectIdentifier('1.3.6.1.4.1.8321.1')

_cache = {}


@dataclass(frozen=True)
class Certificado:
    llave: rsa.RSAPrivateKey
    cert: x509.Certificate

    @property
    def der_b64(self):
        return base64.b64encode(self.cert.public_bytes(Encoding.DER)).decode()

    @property
    def titular(self):
        nombres = self.cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        return nombres[0].value if nombres else self.cert.subject.rfc4514_string()

    @property
    def vence(self) -> datetime:
        return self.cert.not_valid_after_utc

    @property
    def rut(self):
        try:
            san = self.cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        except x509.ExtensionNotFound:
            return ''
        for nombre in san.get_values_for_type(x509.OtherName):
            if nombre.type_id == OID_RUT:
                m = re.search(rb'(\d{6,8}-[\dkK])', nombre.value)
                if m:
                    return m.group(1).decode().upper()
        return ''


def configurado():
    return bool(os.environ.get('SII_CERT_PFX_B64') or os.environ.get('SII_CERT_PFX_PATH'))


def _leer_pfx():
    b64 = os.environ.get('SII_CERT_PFX_B64', '').strip()
    if b64:
        try:
            return base64.b64decode(b64, validate=False)
        except ValueError as e:
            raise SIIError('SII_CERT_PFX_B64 no es base64 válido') from e
    ruta = os.environ.get('SII_CERT_PFX_PATH', '')
    if ruta:
        try:
            with open(ruta, 'rb') as f:
                return f.read()
        except OSError as e:
            raise SIIError(f'No se pudo leer el certificado en SII_CERT_PFX_PATH: {e.strerror}') from e
    raise SIIError('Falta configurar el certificado digital (SII_CERT_PFX_B64 y SII_CERT_PASSWORD)')


def desde_pfx(datos: bytes, clave: str) -> Certificado:
    try:
        llave, cert, _ = pkcs12.load_key_and_certificates(datos, clave.encode() if clave else None)
    except ValueError as e:
        raise SIIError('No se pudo abrir el certificado: revisa SII_CERT_PASSWORD') from e
    if cert is None or not isinstance(llave, rsa.RSAPrivateKey):
        raise SIIError('El .pfx no trae un certificado con llave privada RSA')
    return Certificado(llave, cert)


def cargar() -> Certificado:
    datos, clave = _leer_pfx(), os.environ.get('SII_CERT_PASSWORD', '')
    clave_cache = (hash(datos), clave)
    if clave_cache not in _cache:
        _cache.clear()
        _cache[clave_cache] = desde_pfx(datos, clave)
    return _cache[clave_cache]
