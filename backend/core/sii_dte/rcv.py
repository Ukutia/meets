"""Descarga del Registro de Compras y Ventas (RCV) del SII.

El SII no publica una API oficial del RCV: se usan los mismos servicios que
llama su página (www4.sii.cl/consdcvinternetui) con el token como cookie.
La exportación devuelve las líneas del CSV que se descarga a mano, así que
se procesan con el mismo lector (`sii.leer_rcv`). Si el SII cambia esos
servicios, la carga manual del CSV sigue funcionando.
"""
import json
import urllib.error
import urllib.request
import uuid

from . import SIIError, auth

URL = 'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/'
NAMESPACE = 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/'
TIMEOUT = 60
# Secciones del registro de compras -> valor que espera el SII.
ESTADOS_COMPRA = {'registrado': 'REGISTRO', 'pendiente': 'PENDIENTE',
                  'no_incluir': 'NO_INCLUIR', 'reclamado': 'RECLAMADO'}


class TokenVencido(SIIError):
    pass


def _cuerpo(metodo, tok, rut, mes, operacion, estado):
    numero, dv = rut.split('-')
    return {
        'metaData': {'namespace': NAMESPACE + metodo, 'conversationId': tok,
                     'transactionId': str(uuid.uuid4()), 'page': None},
        'data': {'rutEmisor': numero, 'dvEmisor': dv.upper(), 'ptributario': mes.replace('-', ''),
                 'codTipoDoc': 0, 'operacion': 'COMPRA' if operacion == 'compras' else 'VENTA',
                 'estadoContab': ESTADOS_COMPRA[estado] if operacion == 'compras' else ''},
    }


def _pedir(metodo, cuerpo, tok):
    req = urllib.request.Request(URL + metodo, data=json.dumps(cuerpo).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*',
        'Cookie': f'TOKEN={tok}', 'Origin': 'https://www4.sii.cl',
        'Referer': 'https://www4.sii.cl/consdcvinternetui/', 'User-Agent': auth.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            texto = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise TokenVencido('El SII no aceptó la sesión') from e
        raise SIIError(f'El SII respondió {e.code} al pedir el registro') from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SIIError(f'No se pudo conectar con el SII: {e}') from e
    try:
        return json.loads(texto)
    except ValueError as e:
        # Sin sesión válida el SII redirige a su página de login (HTML).
        raise TokenVencido('El SII devolvió una página en vez de datos (sesión no válida)') from e


def lineas(respuesta):
    """Saca las líneas CSV de la respuesta. [] si el período no tiene documentos."""
    estado = respuesta.get('respEstado') or {}
    datos = respuesta.get('data')
    codigo = estado.get('codRespuesta')
    if codigo not in (None, 0, '0') and not datos:
        mensaje = estado.get('msgeRespuesta') or estado.get('codError') or f'código {codigo}'
        if 'no' in str(mensaje).lower() and 'datos' in str(mensaje).lower():
            return []
        raise SIIError(f'El SII no entregó el registro: {mensaje}')
    if not datos:
        return []
    if isinstance(datos, str):
        datos = datos.splitlines()
    return [l for l in datos if isinstance(l, str) and l.strip()]


def descargar(rut_empresa, mes, operacion, estado='registrado'):
    """Devuelve el CSV (bytes, UTF-8) del detalle de `operacion` ('ventas' o
    'compras', con su sección `estado`) para el período `mes` (AAAA-MM).
    b'' si no hay documentos."""
    metodo = 'getDetalleCompraExport' if operacion == 'compras' else 'getDetalleVentaExport'
    for intento in range(2):
        tok = auth.token('produccion', forzar=intento > 0)
        try:
            resultado = lineas(_pedir(metodo, _cuerpo(metodo, tok, rut_empresa, mes, operacion, estado), tok))
            break
        except TokenVencido:
            if intento:
                raise
    if len(resultado) <= 1:  # solo encabezado
        return b''
    return '\n'.join(resultado).encode('utf-8')
