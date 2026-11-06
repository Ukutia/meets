# Conexión directa al SII — plan

Decisión (4-nov-2026): la app se conecta directo al SII con el certificado
digital de la empresa y **reemplaza a OpenFactura**. Alcance: leer el Registro
de Compras y Ventas (RCV), emitir boletas (39), facturas (33) y notas de
crédito (61).

## Lo que hace el usuario (no se puede programar)

| # | Trámite | Cuándo |
|---|---|---|
| U1 | Confirmar que el titular del certificado figura como usuario autorizado de 78537642-0 con permiso de facturación | Antes de la fase 1 |
| U2 | Postular a la empresa como emisor con **sistema propio** en el ambiente de certificación (maullin.sii.cl) | Antes de la fase 3 |
| U3 | Pedir folios CAF de **certificación** para 33, 39, 61 (y 56 si sale en el set) | Al aprobar U2 |
| U4 | Descargar los sets de prueba asignados (facturas y boletas) | Al aprobar U2 |
| U5 | Firmar la declaración de cumplimiento y registrarse como emisor con software propio | Al final de la fase 3 |
| U6 | Pedir folios CAF de **producción** | Fase 4 |

Pendiente de confirmar con el SII: si al pasar a software propio la empresa
puede seguir usando el portal gratuito mientras tanto, y si el resumen de
ventas diarias de boletas (RVD, ex RCOF) sigue siendo obligatorio.

## Secretos y configuración (Railway)

- `SII_CERT_PFX_B64`: el .pfx en base64. `SII_CERT_PASSWORD`: su clave.
  Nunca en el repo, en la base de datos ni en el chat.
- `SII_AMBIENTE`: `certificacion` (por defecto) o `produccion`.
- Los CAF (XML con llave privada de folios) se suben desde la app y se guardan
  en la base cifrados con una clave derivada de `SECRET_KEY` / `SII_CAF_KEY`.
- Se eliminan `OPENFACTURA_API_KEY` / `OPENFACTURA_URL`.

## Arquitectura (`backend/core/sii_dte/`)

| Módulo | Responsabilidad |
|---|---|
| `certificado.py` | Cargar el .pfx (`cryptography`), exponer llave, certificado y RUT del titular |
| `firma.py` | XMLDSig enveloped RSA-SHA1 como exige el SII (`lxml` + firma propia o `signxml`) |
| `auth.py` | Semilla → token. SOAP para facturas/RCV; REST aparte para boletas. Token cacheado |
| `caf.py` | Modelo `CAF`: rango, vigencia, folio siguiente con `select_for_update` (nunca repetir ni saltar) |
| `dte.py` | Armar XML de 33/39/61 desde Pedido/NotaCredito, TED (timbre con llave del CAF), validar contra XSD oficiales |
| `envio.py` | EnvioDTE (SOAP/upload) y EnvioBOLETA (REST); track ID; consulta de estado |
| `rcv.py` | Descarga de compras/ventas por período y alimentación del importador actual de `sii.py` |
| `pdf.py` | Representación impresa con PDF417 del TED |

Modelos: `CAF`, `EnvioSII` (XML enviado, track ID, estado, respuesta) y
`DocumentoTributario` ampliado con origen `sii_directo`, XML firmado y track ID.
La emisión es idempotente por pedido igual que hoy: el folio se reserva en la
misma transacción que el documento.

La boleta exige un **sitio público de consulta** indicado en el impreso: una
vista pública sin login que verifique folio/fecha/monto.

## Estado fase 1 (4-nov-2026)

Implementado en `backend/core/sii_dte/` (`certificado`, `firma`, `auth`, `rcv`),
`ConexionSIIView` (`GET/POST /api/cierre/sii/conexion/`) y `SincronizarRCVView`
(`POST /api/cierre/sii/sincronizar/ {"mes": "AAAA-MM"}`), más la tarjeta «Traer
del SII» en Cierre de mes › Importar / revisar SII. La sincronización baja
ventas y las cuatro secciones de compras y las pasa por el mismo importador que
el CSV (`registrar_importacion`); una sección igual a la última no se repite.

Verificado contra el SII real: semilla de palena y maullin, y el canje de
token llega a validación del certificado (un autofirmado se rechaza con
«Certificate no existe»). **Falta probarlo con el certificado real**: token,
y que la exportación del RCV traiga los encabezados que espera `leer_rcv`.
El resumen de boletas sigue subiéndose como CSV.

Para activarlo en Railway:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\ruta\certificado.pfx")) | Set-Clipboard
```

Pegar en `SII_CERT_PFX_B64` y la clave en `SII_CERT_PASSWORD`; luego «Probar conexión».

## Fases

**Fase 1 — Núcleo + RCV (sin certificación).** Certificado, firma, token, y
descarga del RCV por mes hacia la conciliación existente (reemplaza subir
CSV, que queda como respaldo). Prueba real en producción solo de lectura.
Riesgo: el SII no publica una API oficial del RCV; se usan los servicios que
consume su propia web, que pueden cambiar.

**Fase 2 — Motor de emisión.** CAF, XML 33/39/61, TED, firma, validación XSD,
envío y estado contra el ambiente de certificación. PDF con PDF417. Retirar
OpenFactura (código, tests, botón) cuando esto emita en certificación.

**Fase 3 — Certificación SII.** Generar el set de pruebas con los datos que
entregue el SII, simulación, intercambio (recibir DTE y responder acuses),
muestras impresas. Cada etapa la revisa el SII; suele tomar semanas.

**Fase 4 — Producción.** CAF reales, `SII_AMBIENTE=produccion`, monitoreo de
rechazos y alerta de folios por agotarse. Acuse/reclamo de compras opcional.

## Dependencias nuevas

`lxml`, `cryptography`, `signxml` (o firma manual), `pdf417gen`/`reportlab`
para el PDF. Evaluar la librería `cl-sii` (Python) para estructuras y
parseo antes de escribir todo a mano.

## Fuentes

- [SII: proceso de certificación](https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm)
- [SII: instructivo emisión boleta electrónica (REST)](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf)
- [SII: certificación de boletas](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm)
- [SII: instructivo set de pruebas](https://www.sii.cl/factura_electronica/inst_set_pruebas.pdf)
- [SII: cambio de software comercial a propio](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6529.htm)
