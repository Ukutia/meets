# Conciliación tributaria SII — MEAT YOUR MATCH

## Análisis y diseño

El resumen comercial (`contabilidad.resumen_mensual`) usa `DetallePedido.fecha`,
`total_venta` y `total_costo`. Esa fecha se asigna al crear la línea, por lo que
no equivale necesariamente a la fecha del pedido, entrega o emisión. Incluye
operaciones históricas y ventas sin documento. Se conserva para rentabilidad.

El cierre existente ya separaba pedidos, cobros y `DocumentoTributario`, e
integraba OpenFactura. Se extendió ese mismo modelo: **no se creó otro libro de
ventas**. El importador de compras anterior solo guardaba un informe y podía
completar RUT de proveedores por folio. El importador de ventas asociaba por
RUT/monto/ventana de fechas. Ahora los candidatos comerciales requieren revisión
manual; las importaciones no cambian pedidos, proveedores ni inventario.

Antes el anticipo de carne se sumaba al crédito IVA normal. Ahora se muestra
separado y se imputa solo tras validación, con tope en el IVA determinado.

Se reutilizan:

- `DocumentoTributario`: ventas y compras, emisor/receptor, período RCV,
  impuestos desglosados, estado SII, fila original y vínculos a `Pedido`,
  `Factura`, `Gasto` o `NotaCredito` (uno a la vez).
- `ImportacionSII`: encabezados, SHA-256, sección de compras, fecha informada de
  actualización y fecha efectiva de importación; se conserva cada importación.
- `Pedido.fecha`: fecha comercial original. `fecha_entrega` es nueva y nullable;
  no se deduce del estado Pagado/Preparado ni se rellena con fechas tributarias.
- `Factura`: conserva sus importes e incorpora tipo DTE, exento, otros impuestos
  y pagadero explícito opcional. Los documentos SII no sobrescriben sus montos.
  El pagadero por defecto sigue siendo total menos notas de crédito.
- `Cliente.nombre`, `razon_social`, `rut`, `contacto` y `Proveedor.nombre/rut`:
  identificación y candidatos comerciales, sin registros duplicados de clientes.
- `HistorialConciliacion`: actor, fecha, acción, estado antes/después, vínculos,
  diferencias de monto/fecha y justificación. Protege la evidencia contra borrado.
- `CierreTributario`: parámetros por mes, fundamento, historial y copia del F29
  declarado manualmente; una reimportación recalcula la estimación y conserva la
  copia declarada.

## Migraciones

1. `0041_conciliacion_tributaria`: modelos, campos, clave documental y restricción
   de un vínculo interno por documento.
2. `0042_empresa_conciliacion`: configura, solo donde falten datos, RUT
   `78537642-0`, inicio `2026-10-19` y régimen Pro Pyme General 14 D N.º 3 con
   contabilidad simplificada. Son datos proporcionados por el usuario. No fija
   tasa PPM ni altera operaciones históricas.
3. `0043_desglose_factura_compra`: tipo DTE, exento, otros impuestos y pagadero.

Aplicar en el entorno de destino con `python manage.py migrate`. Las pruebas
utilizan bases desechables; no se aplicaron migraciones a producción.

## API

Todas las rutas usan la autenticación existente. Prefijo general: `/api/`.

| Método y ruta | Función |
|---|---|
| `GET /cierre/conciliacion/?mes=2026-10` | Dashboard, documentos, indicadores, advertencias y F29 estimado |
| `PUT /cierre/conciliacion/` | Parámetros mensuales con fundamento; registro opcional de F29 declarado |
| `GET /cierre/conciliacion/<id>/` | Documento, candidatos y auditoría |
| `PATCH /cierre/conciliacion/<id>/` | Confirmar vínculo/revisión, desvincular, validar/excluir crédito o anticipo |
| `PATCH /cierre/pedidos/<id>/entrega/` | Confirmar la fecha real de entrega sin cambiar la fecha comercial |
| `POST /cierre/sii/` (existente, ampliado) | CSV ventas, boletas, compras y resumen |
| `PATCH /cierre/documentos/<id>/` (existente) | Los vínculos a pedidos también pasan por validación y auditoría |

El GET mensual admite `tipo`, `operacion` y `estado_conciliacion`. Los indicadores
representan el mes completo aunque se filtre la tabla. El período comercial y
el vendedor de la vista de cierre no recortan el período tributario de la empresa.

En ventas se rechaza un período distinto del mes de emisión: seleccionar
noviembre no traslada un documento emitido en octubre. En compras el período
del RCV puede diferir de la emisión y se conserva por separado.

Ejemplo de vínculo:

```json
{"registro_tipo":"pedido","registro_id":327,"justificacion":"Factura original revisada; entrega posterior"}
```

Para desvincular, enviar `registro_tipo: null` con justificación. Para revisar
sin cambiar el vínculo, basta `justificacion`. Los flags `credito_validado` y
`anticipo_validado` aceptan booleanos, solo habilitables en compras registradas.
No se permiten cambios de folio, fecha ni montos por esta API.

Importación multipart:

- `archivo`: CSV (máximo 10 MB), UTF-8/BOM o Windows-1252.
- `mes`: período RCV `AAAA-MM`, independiente de la emisión.
- `operacion`: `ventas` para boletas sin RUT de contraparte; `compras` para compras.
- `estado_registro`: `registrado`, `pendiente`, `reclamado`, `no_incluir` para
  archivos de compras sin columna de estado. La UI pide la sección descargada.
- `datos_actualizados_al`: fecha real de actualización en SII, opcional. Si no se
  conoce queda vacía; no se inventa desde la fecha de subida.

La importación es atómica: una fila inválida revierte todo el archivo. Verifica
RUT/DV, folios, fechas, números chilenos y encabezados. Duplicados iguales dentro
del archivo se omiten; duplicados conflictivos se rechazan. La clave única usa
tipo, folio, RUT emisor, RUT receptor y ambiente. El RUT de empresa explícito en
el archivo o su nombre, cuando existe, se contrasta con la configuración.
Las boletas sin RUT usan receptor vacío estable. Una emisión local compatible
anterior al campo emisor se reutiliza; no se crea otro documento.

Los encabezados reconocidos parten del lector que ya existía en el repositorio;
**no hay CSV originales disponibles de esta empresa**. No se garantiza aún la
compatibilidad con sus cuatro exportaciones concretas. Variantes desconocidas
fallan o se señalan como columnas monetarias pendientes, con la fila original
visible. Los resúmenes no generan boletas ni se suman al detalle.

## Cálculo y fuentes tributarias

Verificación documental realizada el 2 de noviembre de 2026:

- [SII: códigos de otros impuestos](https://www.sii.cl/factura_electronica/factura_sii/guias_ayuda/instructivo_carga_lc.htm):
  17 anticipo de faenamiento y 18 anticipo de carne, 5%. Solo se toma el monto
  informado con esos códigos; nunca se inventa el 5% por proveedor o por una
  diferencia de total. La pantalla de compras deja el anticipo desactivado al
  cambiar de proveedor y requiere selección por documento.
- [SII: instrucciones F29](https://www.sii.cl/servicios_online/instrucciones_f29_20241112.pdf):
  anticipos del período y remanente son separados del IVA crédito, y su
  imputación tiene como tope el IVA determinado. El remanente previo ingresado
  debe estar confirmado y neto de devoluciones/ajustes que correspondan; no se
  implementa solicitud de devolución ni su arrastre automático.
- [SII: uso del crédito fiscal](https://www.sii.cl/destacados/f29/usocreditofiscal.htm):
  el período de crédito puede depender del acuse de recibo. Por eso se conserva
  el período de registro y no se deduce solo de la emisión o entrada de stock.
- [SII: Circular 53/2025](https://www.sii.cl/normativa_legislacion/circulares/2025/circu53.pdf):
  contempla reducción transitoria de tasas bajo condiciones. La tasa PPM se
  confirma por mes con fundamento; no se aplica 0,125% universalmente.
- [SII: regímenes tributarios](https://www.sii.cl/destacados/modernizacion/tipos_regimenes_mt.html):
  la determinación tributaria Pro Pyme no equivale simplemente al margen
  comercial. La base PPM documental es referencia; se exige confirmar la base
  procedente del período para considerar el cierre completo.

El débito suma IVA de documentos de ventas, menos NC 61; notas de débito suman.
El crédito usa `Monto IVA Recuperable` de compras registradas, sujeto a exclusión
manual. Pendientes, reclamadas, no incluir, pruebas y operaciones anteriores al
inicio quedan fuera. El IVA de uso común/no recuperable no se agrega al crédito.
El anticipo validado es independiente del crédito normal y no paga PPM.
El DTE 46 queda advertido y sin crédito automático hasta validar su tratamiento
particular de cambio de sujeto.

Sin tasa, base o remanentes confirmados, el total F29 se muestra pendiente.
`retenciones` es un ajuste **imputable** confirmado por el usuario; no corresponde
a retenciones de terceros que la empresa deba enterar. `otros_impuestos` contiene
obligaciones adicionales confirmadas. No se imputa automáticamente un impuesto
especial por el mero hecho de aparecer en el CSV.

Redondeo tributario a pesos con `ROUND_HALF_UP`. Se conservan montos documentales
exactos; la tolerancia de comparación heredada es $2. Una diferencia justificada
puede conciliarse documentalmente y sigue visible en la tabla.

## Interfaz

`ConciliacionTributaria` se integra en **Cierre de mes**, reutilizando Card,
Dialog, Table, Input, Badge, React Query, API autenticada y formato CLP existentes.
Incluye indicadores, filtros, F29 estimado/declarado, parámetros con fundamento,
lista de pedidos sin respaldo, fechas de entrega y detalle con candidatos de
otros meses, selección por ID, justificación y auditoría.

`DocumentosSII` conserva la importación e historial existentes y añade sección de
compras y fecha de actualización. `ResumenContable` consume el mismo servicio
tributario; Reportes identifica sus valores de inventario como estimaciones
comerciales y dirige al cierre para preparar el F29.

## Validación de octubre: datos reconstruidos

Estos resultados son de pruebas con los totales aportados, no de la base real ni
de CSV originales. Las bases de las cuatro compras no se proporcionaron; se
mantienen pendientes y no se atribuye automáticamente toda diferencia al anticipo.

| Concepto | Antes, informado por usuario | Resultado documental de pruebas |
|---|---:|---:|
| Venta neta | $18.972.785 | $6.540.821 |
| IVA débito | $3.604.829 | $1.242.757 |
| Total documentado | — | $7.783.578 |
| Facturas / boletas | — | 4 / 16 |
| Base PPM documental / informada SII | — | $6.540.821 / $6.540.826 |
| PPM con base informada y tasa confirmada 0,125% | — | $8.176 |

Los $5 entre la base documental y el código 563 quedan visibles: no se alteran
los documentos para forzar la igualdad. La tasa y base anteriores solo existen
en el fixture de prueba; no se guardan como parámetros de producción.

Las cuatro facturas 6–9 sugieren pedidos 291, 290, 307 y 327. Las boletas 7 y 13
sugieren pedidos 295 y 302. Todas requieren confirmación. Pedido 327 conserva su
fecha comercial de noviembre aunque el documento se emita en octubre.

| Folio compra | Plataforma | SII | Diferencia pendiente |
|---|---:|---:|---:|
| 651811 | $1.858.625 | $1.936.719 | $78.094 |
| 67636 | $44.254 | $45.435 | $1.181 |
| 39512756 | $555.594 | $579.573 | $23.979 |
| 650276 | $1.729.175 | $1.801.829 | $72.654 |

Las pruebas cubren importación repetida, duplicados iguales/conflictivos,
aislamiento compra/venta y emisor, 19% más anticipo y sin anticipo, pendientes y
cambios de estado, gastos/exentas, coincidencia exacta, RUT y razón social,
montos ambiguos, entregas sin respaldo y entre meses, históricos, redondeo,
desglose incorrecto, vínculo/desvínculo auditado, preservación de decisiones,
reimportación posterior a declaración y los casos de octubre.

Comandos de comprobación (PowerShell, SQLite desechable):

```powershell
$env:DATABASE_URL='sqlite:///:memory:'
python manage.py test core --noinput
python manage.py makemigrations --check --dry-run
python manage.py check
# En frontend:
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Verificación final: **173 pruebas aprobadas**, incluidas 35 específicas de
conciliación, con Django 5.1.3, versión fijada por el repositorio.
TypeScript, ESLint del componente nuevo,
compilación Vite, chequeo Django y ausencia de migraciones pendientes de generar
comprobados. La prueba de navegador con Playwright/Edge recorre octubre,
filtros, candidatos y vínculo/desvínculo auditado en una base SQLite temporal;
se revisaron escritorio y móvil sin errores JavaScript.

Advertencias existentes: fixtures antiguos con datetimes sin zona, ausencia de
`staticfiles` en pruebas, Browserslist antiguo y tamaño de bundle Vite. No hubo
fallos de compilación ni de migraciones.

## Límites pendientes

- Contrastar encabezados y montos con CSV reales de compras registradas,
  pendientes, ventas y detalle de boletas. No hay conexión automática al SII.
- Confirmar tasa/base PPM, acuses, procedencia de crédito/anticipo, bases del 5%,
  remanentes y cualquier impuesto especial para la empresa y cada período.
- La tabla interna `Factura` conserva su folio como PK global; no admite dos
  proveedores con igual folio. El registro SII sí los distingue y deja sin
  vínculo los casos no representables. Cambiar esa PK requeriría otra migración
  amplia del inventario y se evitó para conservar el sistema existente.
- Un documento se vincula a un registro interno; no implementa reparto de una
  factura entre varios pedidos ni agrupación de varios documentos principales
  para un pedido. Las notas pueden coexistir como ajustes, sin duplicar ventas.
- No se conoce entrega real de históricos: queda nullable y requiere confirmación.
- La importación repetida actualiza documentos presentes; no infiere bajas de
  documentos ausentes ni presume que se descargó el RCV completo.
- El estado documental conciliado y el cumplimiento completo son distintos.
  Faltantes, documentación tardía, fechas/parametrización desconocidas y
  advertencias de impuestos impiden mostrar cumplimiento completo.
- No se transmite F29, ni se automatiza acuse, devolución, rectificatoria o F22.

## Archivos de implementación

Backend: `core/models.py`, `serializers.py`, `sii.py`, `conciliacion.py`,
`contabilidad.py`, `views.py`, `views_cierre.py`, `views_conciliacion.py`, `urls.py`,
`views_tesoreria.py`,
las tres migraciones indicadas, `test_conciliacion.py`, `test_cierre.py` y
`test_finanzas.py`.

Frontend: `components/cierre/ConciliacionTributaria.tsx`, `DocumentosSII.tsx`,
`components/tesoreria/ResumenContable.tsx`, `pages/CierreMes.tsx`, `Facturas.tsx`,
`Reportes.tsx`, `services/api.ts` y `types/index.ts`.
