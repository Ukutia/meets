"""Importación RCV conservadora: nunca crea ventas ni modifica inventario.

Encabezados heredados del lector existente. Validación con CSV reales de la
empresa pendiente; variantes desconocidas fallan sin importar parcialmente.
"""
import csv
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter
from datetime import date
from decimal import Decimal

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Sum
from .cartola import parse_fecha
from .models import ConfiguracionContable, DocumentoTributario, TIPOS_DTE

TIPOS_VALIDOS = {t for t, _ in TIPOS_DTE}
CODIGOS_ANTICIPO_CARNE = {17, 18}
TOLERANCIA = Decimal('2')
COLUMNAS = {
    'tipo': ['tipo doc', 'tipo documento', 'tipo dte'], 'folio': ['folio'],
    'fecha': ['fecha docto', 'fecha documento', 'fecha emision'],
    'rut': ['rut cliente', 'rut proveedor', 'rut receptor'],
    'emisor': ['rut emisor'], 'receptor': ['rut receptor'],
    'razon_social': ['razon social'], 'exento': ['monto exento'],
    'neto': ['monto neto'], 'iva': ['monto iva recuperable', 'monto iva'],
    'no_recuperable': ['monto iva no recuperable', 'monto iva no rec'],
    'uso_comun': ['monto iva uso comun'], 'total': ['monto total'],
    'cantidad': ['total documentos'], 'codigo_otro': ['codigo otro impuesto', 'codigo otro imp'],
    'valor_otro': ['valor otro impuesto', 'valor otro imp'],
    'estado': ['estado', 'estado sii', 'estado documento'], 'periodo': ['periodo tributario'],
}
ESTADOS = {'registro': 'registrado', 'registrado': 'registrado', 'registradas': 'registrado',
           'pendiente': 'pendiente', 'pendientes': 'pendiente', 'reclamado': 'reclamado',
           'reclamadas': 'reclamado', 'no incluir': 'no_incluir', 'emitido': 'emitido'}


def json_seguro(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def validar_mes(mes):
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', str(mes or '')):
        raise ValueError('Período inválido, usa AAAA-MM')
    date.fromisoformat(mes + '-01')
    return mes


def filtro_mes(campo, mes):
    validar_mes(mes)
    anio, m = map(int, mes.split('-'))
    return {f'{campo}__year': anio, f'{campo}__month': m}


def _norm(texto):
    texto = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', ' ', texto.lower()).strip()


def normalizar_rut(rut):
    return re.sub(r'[^0-9K]', '', str(rut or '').upper()).lstrip('0')


def validar_rut(rut):
    texto = str(rut or '').strip().upper()
    if not re.fullmatch(r'[\d.]+-?[\dK]', texto):
        raise ValueError(f'RUT inválido: {rut}')
    r = normalizar_rut(texto)
    if not 2 <= len(r) <= 9 or not r[:-1].isdigit():
        raise ValueError(f'RUT inválido: {rut}')
    suma = sum(int(n) * (2 + i % 6) for i, n in enumerate(reversed(r[:-1])))
    dv = 11 - suma % 11
    esperado = '0' if dv == 11 else 'K' if dv == 10 else str(dv)
    if r[-1] != esperado:
        raise ValueError(f'Dígito verificador inválido: {rut}')
    return f'{r[:-1]}-{r[-1]}'


def _monto(valor):
    s = str(valor or '').strip().replace('$', '').replace(' ', '')
    if not s:
        return Decimal('0')
    if not re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?', s):
        raise ValueError(f'Monto chileno inválido: {valor}')
    monto = Decimal(s.replace('.', '').replace(',', '.'))
    if abs(monto) >= Decimal('10000000000'):
        raise ValueError('Monto fuera de rango')
    return monto


def _entero(valor):
    m = re.fullmatch(r'(?:[^\d]*\()?([0-9]+)\)?', str(valor or '').strip())
    return int(m.group(1)) if m else None


def _decodificar(contenido):
    for codificacion in ('utf-8-sig', 'cp1252'):
        try:
            return contenido.decode(codificacion)
        except UnicodeDecodeError:
            continue
    raise ValueError('No se pudo leer el archivo')


def leer_rcv(contenido, nombre_archivo='', operacion=''):
    texto = _decodificar(contenido)
    separador = ';' if texto.count(';') >= texto.count(',') else ','
    filas = list(csv.reader(io.StringIO(texto), delimiter=separador))
    idx = next((i for i, f in enumerate(filas[:20])
                if {'folio', 'total documentos'} & {_norm(c) for c in f}), None)
    if idx is None:
        raise ValueError('No se reconoce el encabezado RCV (Folio / Total Documentos)')
    encabezado = [_norm(c) for c in filas[idx]]
    if len([c for c in encabezado if c]) != len(set(c for c in encabezado if c)):
        raise ValueError('Encabezados repetidos: requiere revisión del formato')
    mapa = {campo: encabezado.index(n) for campo, nombres in COLUMNAS.items()
            for n in reversed(nombres) if n in encabezado}
    if 'cantidad' in mapa:
        tipo = 'resumen'
    elif 'rut proveedor' in encabezado:
        tipo = 'compras'
    elif 'rut cliente' in encabezado:
        tipo = 'ventas'
    elif operacion in ('compras', 'ventas') and ('receptor' in mapa or operacion == 'ventas'):
        tipo = operacion
    else:
        raise ValueError('Indica ventas/boletas o compras; no se reconoce la contraparte')
    requeridas = {'tipo', 'total', 'neto', 'exento', 'iva'}
    if tipo != 'resumen':
        requeridas |= {'folio', 'fecha'}
    if not requeridas <= mapa.keys():
        raise ValueError('Faltan columnas: ' + ', '.join(sorted(requeridas - mapa.keys())))
    if tipo == 'compras' and 'monto iva recuperable' not in encabezado:
        raise ValueError('Compras requiere Monto IVA Recuperable; no se deduce del IVA total')
    resultado = []
    for numero, f in enumerate(filas[idx + 1:], start=idx + 2):
        if not any(c.strip() for c in f):
            continue
        if len(f) != len(encabezado):
            raise ValueError(f'Fila {numero}: cantidad de columnas distinta del encabezado')
        celda = lambda campo: f[mapa[campo]].strip() if campo in mapa else ''
        try:
            dte = _entero(celda('tipo'))
            if dte not in TIPOS_VALIDOS:
                raise ValueError(f'Tipo de documento no soportado: {celda("tipo")}')
            folio = celda('folio')
            if tipo != 'resumen' and (not re.fullmatch(r'\d{1,10}', folio) or int(folio) <= 0):
                raise ValueError('Folio inválido')
            fecha_texto = celda('fecha')
            if tipo != 'resumen' and not re.fullmatch(r'(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?', fecha_texto):
                raise ValueError('La fecha debe incluir día, mes y año completo')
            fecha = parse_fecha(fecha_texto)
            if tipo != 'resumen' and not fecha:
                raise ValueError('Fecha de emisión inválida')
            rut = validar_rut(celda('rut')) if celda('rut') else ''
            if tipo == 'compras' and not rut:
                raise ValueError('Falta RUT del proveedor')
            if tipo == 'ventas' and dte not in (39, 41) and not rut:
                raise ValueError('Falta RUT del receptor')
            estado = celda('estado')
            if estado and _norm(estado) not in ESTADOS:
                raise ValueError(f'Estado SII no soportado: {estado}')
            fila = {'tipo': dte, 'folio': int(folio) if folio else None,
                    'fecha': fecha, 'rut': rut, 'razon_social': celda('razon_social'),
                    'cantidad': _entero(celda('cantidad')) or 0,
                    'codigo_otro': _entero(celda('codigo_otro')),
                    'estado': ESTADOS.get(_norm(estado), ''),
                    'emisor': validar_rut(celda('emisor')) if celda('emisor') else '',
                    'receptor': validar_rut(celda('receptor')) if celda('receptor') else '',
                    'periodo': celda('periodo'), 'original': dict(zip(filas[idx], f))}
            for campo in ('exento', 'neto', 'iva', 'total', 'valor_otro', 'no_recuperable', 'uso_comun'):
                fila[campo] = _monto(celda(campo))
                if fila[campo] < 0:
                    raise ValueError('Los montos deben ser positivos; el signo lo determina el tipo DTE')
            if fila['valor_otro'] and fila['codigo_otro'] is None:
                raise ValueError('Otro impuesto sin código: requiere revisión')
            resultado.append(fila)
        except ValueError as exc:
            raise ValueError(f'Fila {numero}: {exc}') from exc
    meses = Counter(f['fecha'].strftime('%Y-%m') for f in resultado if f['fecha'])
    m = re.search(r'(20\d{2})(0[1-9]|1[0-2])', nombre_archivo)
    mes = meses.most_common(1)[0][0] if meses else f'{m[1]}-{m[2]}' if m else ''
    rut_archivo = re.search(r'(?<!\d)(\d{1,2}\.?\d{3}\.?\d{3}-[\dKk])(?!\d)', nombre_archivo)
    return {'tipo': tipo, 'mes': mes, 'filas': resultado, 'encabezados': filas[idx],
            'rut_empresa_archivo': validar_rut(rut_archivo[1]) if rut_archivo else '',
            'sha256': hashlib.sha256(contenido).hexdigest()}


def importar_documentos(filas, importacion, usuario):
    from .conciliacion import auditar, instantanea, coincidencia_exacta, fila_documento
    empresa = validar_rut(ConfiguracionContable.actual().rut_empresa)
    nuevos = actualizados = asociados = 0
    claves = {}
    for f in filas:
        venta = importacion.tipo == 'ventas'
        emisor = f['emisor'] or (empresa if venta else f['rut'])
        receptor = f['receptor'] or (f['rut'] if venta else empresa)
        if (venta and emisor != empresa) or (not venta and receptor != empresa):
            raise ValueError('El RUT de la empresa no coincide con el archivo')
        clave = (f['tipo'], f['folio'], emisor, receptor)
        if clave in claves:
            if claves[clave] != f:
                raise ValueError(f'Documento duplicado con datos distintos: folio {f["folio"]}')
            continue
        claves[clave] = f
        periodo = validar_mes(f['periodo'] or importacion.mes)
        if periodo != importacion.mes:
            raise ValueError('El período de la fila difiere del seleccionado')
        if venta and f['fecha'].strftime('%Y-%m') != periodo:
            raise ValueError('El período de ventas debe coincidir con la emisión tributaria; no se traslada al mes seleccionado')
        doc = DocumentoTributario.objects.select_for_update().filter(
            tipo=f['tipo'], folio=f['folio'], rut_emisor=emisor, rut_receptor=receptor, ambiente='produccion').first()
        if not doc and venta:
            previos = list(DocumentoTributario.objects.select_for_update().filter(
                tipo=f['tipo'], folio=f['folio'], ambiente='produccion', operacion='ventas'))
            previos = [d for d in previos if (not d.rut_emisor or normalizar_rut(d.rut_emisor) == normalizar_rut(empresa))
                       and (not d.rut_receptor or normalizar_rut(d.rut_receptor) == normalizar_rut(receptor))]
            if len(previos) == 1:
                doc = previos[0]
            elif len(previos) > 1:
                raise ValueError('Hay documentos locales ambiguos para el mismo folio; revisa su identidad antes de importar')
        antes = instantanea(doc) if doc else {}
        if doc:
            actualizados += 1
            doc.estado_conciliacion = fila_documento(doc)['estado_conciliacion']
        else:
            doc = DocumentoTributario(tipo=f['tipo'], folio=f['folio'], usuario=usuario)
            nuevos += 1
        doc.operacion, doc.rut_emisor, doc.rut_receptor = importacion.tipo, emisor, receptor
        doc.fecha_emision, doc.periodo_tributario = f['fecha'], periodo
        doc.razon_social = f['razon_social']
        for campo in ('neto', 'iva', 'exento', 'total'):
            setattr(doc, campo, f[campo])
        doc.anticipo = f['valor_otro'] if f['codigo_otro'] in CODIGOS_ANTICIPO_CARNE else Decimal('0')
        doc.otros_impuestos = f['valor_otro'] - doc.anticipo
        doc.iva_no_recuperable, doc.iva_uso_comun = f['no_recuperable'], f['uso_comun']
        doc.estado_sii = f['estado'] or ('emitido' if venta else importacion.estado_registro)
        if not venta and doc.estado_sii not in ('registrado', 'pendiente', 'reclamado', 'no_incluir'):
            raise ValueError('Selecciona el estado del registro de compras')
        credito_anterior = doc.credito_validado
        doc.origen, doc.importacion, doc.datos_originales = 'sii', importacion, f['original']
        cambio = any(str(antes.get(k, '')) != str(instantanea(doc).get(k, '')) for k in
                     ('neto', 'iva', 'total', 'anticipo', 'otros_impuestos', 'estado_sii', 'periodo_tributario',
                      'iva_no_recuperable', 'iva_uso_comun', 'fecha_emision'))
        doc.credito_validado = (not venta and doc.estado_sii == 'registrado' and doc.tipo != 46) if cambio else credito_anterior
        if doc.justificacion and antes.get('credito_validado') is False:
            doc.credito_validado = False
        if cambio:
            doc.anticipo_validado = False
            doc.estado_conciliacion = 'por_revisar'
        doc.save()
        if not doc.justificacion and not any((doc.pedido_id, doc.factura_id, doc.gasto_id, doc.nota_compra_id)):
            asociados += coincidencia_exacta(doc, usuario)
        auditar(doc, 'importar', antes, usuario)
    return {'nuevos': nuevos, 'actualizados': actualizados, 'asociados': asociados,
            'duplicados_omitidos': len(filas) - len(claves)}


def importar_ventas(filas, importacion, usuario):
    return importar_documentos(filas, importacion, usuario)


def resumen_boletas(filas, mes):
    tipos = []
    for f in filas:
        docs = DocumentoTributario.objects.filter(operacion='ventas', tipo=f['tipo'], ambiente='produccion',
                                                 **filtro_mes('fecha_emision', mes))
        tipos.append({'tipo': f['tipo'], 'cantidad_sii': f['cantidad'], 'total_sii': f['total'],
                      'neto_sii': f['neto'], 'iva_sii': f['iva'], 'cantidad_registrada': docs.count(),
                      'total_registrado': docs.aggregate(t=Sum('total'))['t'] or Decimal('0')})
    return {'mes': mes, 'tipos': tipos}
