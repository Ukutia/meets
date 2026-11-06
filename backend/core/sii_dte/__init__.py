"""Conexión directa con el SII usando el certificado digital de la empresa.

- certificado: carga el .pfx desde variables de entorno.
- firma: firma XMLDSig (RSA-SHA1, C14N) en el formato que exige el SII.
- auth: semilla -> token por los servicios SOAP del SII.
- rcv: descarga del Registro de Compras y Ventas.
"""


class SIIError(Exception):
    """Error al hablar con el SII; el mensaje se puede mostrar al usuario."""
