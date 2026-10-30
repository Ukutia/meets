"""Cliente de OpenFactura (Haulmer) para emitir boletas electrónicas.

Configuración por variables de entorno:
- OPENFACTURA_API_KEY: clave de la cuenta. Sin ella la emisión queda apagada.
- OPENFACTURA_URL: https://dev-api.haulmer.com (pruebas, por defecto) o
  https://api.haulmer.com (producción, con efecto tributario real).

Contrato verificado contra el ambiente de pruebas:
- POST /v2/dte/document {"response": [...], "dte": {...}} con encabezados
  apikey e Idempotency-Key -> {"TOKEN", "FOLIO", "PDF" (base64), "WARNING"}.
- Repetir la Idempotency-Key -> 400 OF-06 con el token del documento ya
  emitido: así un doble clic o un reintento nunca emite dos boletas.
- GET /v2/dte/document/<token>/status -> {"estado": "Aceptado", ...}
- GET /v2/dte/document/<token>/json -> {"json": {DTE}} (para recuperar el folio).
- Errores: {"error": {"message", "code", "details": [{"field", "issue"}]}}.
"""
import json
import os
import urllib.error
import urllib.request

from django.core.cache import cache

URL_PRUEBAS = 'https://dev-api.haulmer.com'
URL_PRODUCCION = 'https://api.haulmer.com'
TIMEOUT = 60


class OpenFacturaError(Exception):
    def __init__(self, mensaje, codigo='', detalles=None, status=None):
        super().__init__(mensaje)
        self.mensaje, self.codigo, self.detalles, self.status = mensaje, codigo, detalles or [], status

    def __str__(self):
        extra = '; '.join(f"{d.get('field')}: {d.get('issue')}" for d in self.detalles
                          if isinstance(d, dict) and d.get('field') != 'token')
        return f'{self.mensaje} ({extra})' if extra else self.mensaje


def api_key():
    return os.environ.get('OPENFACTURA_API_KEY', '')


def url_base():
    return os.environ.get('OPENFACTURA_URL', URL_PRUEBAS).rstrip('/')


def habilitada():
    return bool(api_key())


def ambiente():
    return 'produccion' if url_base() == URL_PRODUCCION else 'pruebas'


def _pedir(metodo, ruta, cuerpo=None, encabezados=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url_base() + ruta, data=datos, method=metodo, headers={
        'apikey': api_key(), 'Content-Type': 'application/json', **(encabezados or {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        texto = e.read().decode('utf-8', 'replace')
        try:
            cuerpo_error = json.loads(texto)
        except ValueError:
            raise OpenFacturaError(f'OpenFactura respondió {e.code}', status=e.code)
        err = cuerpo_error.get('error') or {}
        if e.code == 401:
            raise OpenFacturaError('La clave de OpenFactura no es válida', 'auth', status=401)
        raise OpenFacturaError(err.get('message') or cuerpo_error.get('message') or f'Error {e.code}',
                               err.get('code', ''), err.get('details') or [], e.code)
    except (urllib.error.URLError, TimeoutError) as e:
        raise OpenFacturaError(f'No se pudo conectar con OpenFactura: {e}', 'red')


def organizacion():
    """Datos de la empresa emisora registrados en OpenFactura (se cachean 1 h)."""
    clave = f'openfactura-org-{ambiente()}'
    org = cache.get(clave)
    if org is None:
        org = _pedir('GET', '/v2/dte/organization')
        cache.set(clave, org, 3600)
    return org


def emisor_boleta():
    org = organizacion()
    actividad = next((a for a in org.get('actividades') or [] if a.get('actividadPrincipal')), {})
    emisor = {
        'RUTEmisor': org['rut'],
        'RznSocEmisor': org.get('razonSocial', '')[:100],
        'GiroEmisor': (actividad.get('giro') or org.get('glosaDescriptiva') or '')[:80],
        'DirOrigen': org.get('direccion', '')[:60],
        'CmnaOrigen': org.get('comuna', '')[:20],
    }
    if org.get('cdgSIISucur'):
        emisor['CdgSIISucur'] = org['cdgSIISucur']
    return emisor


def emitir(dte, idempotency_key):
    """Emite el documento. Devuelve {'token', 'folio', 'pdf' (base64 o None),
    'advertencias', 'repetido'}. Si ya se había emitido con esa clave, recupera
    el folio en vez de fallar."""
    try:
        r = _pedir('POST', '/v2/dte/document', {'response': ['TOKEN', 'FOLIO', 'PDF'], 'dte': dte},
                   {'Idempotency-Key': idempotency_key})
        return {'token': r['TOKEN'], 'folio': int(r['FOLIO']), 'pdf': r.get('PDF'),
                'advertencias': r.get('WARNING') or [], 'repetido': False}
    except OpenFacturaError as e:
        if e.codigo != 'OF-06':
            raise
        token = next((d.get('issue') for d in e.detalles if isinstance(d, dict) and d.get('field') == 'token'), None)
        if not token:
            raise
        doc = _pedir('GET', f'/v2/dte/document/{token}/json').get('json', {})
        folio = doc.get('Encabezado', {}).get('IdDoc', {}).get('Folio')
        return {'token': token, 'folio': int(folio), 'pdf': None, 'advertencias': [], 'repetido': True}


def estado(token):
    return _pedir('GET', f'/v2/dte/document/{token}/status').get('estado', '')
