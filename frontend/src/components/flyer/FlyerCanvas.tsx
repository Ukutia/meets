import { forwardRef } from 'react';
import '@fontsource/josefin-sans/600.css';
import '@fontsource/josefin-sans/700.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/400-italic.css';
import '@fontsource/lato/700.css';

// Dimensiones base del flyer (proporción A4). Se exporta con pixelRatio para alta resolución.
export const FLYER_WIDTH = 720;
export const FLYER_HEIGHT = 1018;

const C = {
  fondo: '#f4ebde',
  pastilla: '#e8cbae',
  cafe: '#7e5a39',
  texto: '#3b2a1c',
};

export interface FlyerFila {
  id: number;
  nombre: string;
  precio: string;
  peso: string;
}

export interface FlyerProps {
  titulo1: string;
  titulo2: string;
  subtitulo: string;
  telefono: string;
  filas: FlyerFila[];
}

const Cloche = () => (
  <svg width="64" height="40" viewBox="0 0 64 40" fill={C.cafe}>
    <circle cx="32" cy="5" r="3.5" />
    <path d="M6 28 C6 13 18 8 32 8 C46 8 58 13 58 28 Z" />
    <rect x="2" y="29" width="60" height="4" rx="2" />
    <path d="M10 35 h44 l-6 5 H16 Z" opacity="0.8" />
  </svg>
);

const Chevron = () => (
  <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke={C.cafe} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3 L14 13 L25 3" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill={C.fondo} />
    <path
      fill={C.cafe}
      d="M27.6 23.9l-3.1-1.3a1.4 1.4 0 0 0-1.6.4l-1.4 1.7a11 11 0 0 1-5.2-5.2l1.7-1.4a1.4 1.4 0 0 0 .4-1.6l-1.3-3.1a1.4 1.4 0 0 0-1.6-.8l-2.9.7a1.4 1.4 0 0 0-1.1 1.4A15.6 15.6 0 0 0 26.9 30a1.4 1.4 0 0 0 1.4-1.1l.7-2.9a1.4 1.4 0 0 0-.8-1.6z"
    />
  </svg>
);

export const FlyerCanvas = forwardRef<HTMLDivElement, FlyerProps>(
  ({ titulo1, titulo2, subtitulo, telefono, filas }, ref) => {
    // Las filas se comprimen si hay más productos de los que caben con el espaciado original.
    const zonaFilas = 452;
    const paso = Math.min(51.5, zonaFilas / Math.max(filas.length, 1));
    const altoFila = Math.min(34, paso - 6);
    const fuenteFila = Math.min(17, altoFila * 0.5);
    const conPeso = filas.filter((f) => f.peso.trim());

    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: FLYER_WIDTH,
          height: FLYER_HEIGHT,
          background: C.fondo,
          overflow: 'hidden',
          fontFamily: "'Lato', sans-serif",
          color: C.texto,
        }}
      >
        {/* Foto 1 con marco */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 445, height: 250, background: C.pastilla, borderBottomRightRadius: 28 }} />
        <img
          src="/flyer/foto1.jpg"
          alt=""
          crossOrigin="anonymous"
          style={{ position: 'absolute', left: 15, top: 16, width: 412, height: 217, objectFit: 'cover', borderRadius: 14 }}
        />

        {/* Logo */}
        <img
          src="/flyer/logo.png"
          alt=""
          crossOrigin="anonymous"
          style={{ position: 'absolute', left: 455, top: 30, width: 248, height: 80, objectFit: 'contain' }}
        />

        {/* Foto 2 con marco */}
        <div style={{ position: 'absolute', left: 342, top: 221, width: 400, height: 227, background: C.pastilla, borderRadius: 28 }} />
        <img
          src="/flyer/foto2.jpg"
          alt=""
          crossOrigin="anonymous"
          style={{ position: 'absolute', left: 355, top: 240, width: 380, height: 193, objectFit: 'cover', borderRadius: 14 }}
        />

        {/* Título */}
        <div style={{ position: 'absolute', left: 37, top: 277, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 9 }}>
          {[titulo1, titulo2].filter((t) => t.trim()).map((t, i) => (
            <div
              key={i}
              style={{
                background: C.cafe,
                color: C.fondo,
                fontFamily: "'Josefin Sans', sans-serif",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1,
                padding: '10px 9px 6px',
                marginLeft: i * 3,
                textTransform: 'uppercase',
              }}
            >
              {t}
            </div>
          ))}
        </div>

        <div style={{ position: 'absolute', left: 39, top: 412, fontSize: 21 }}>{subtitulo}</div>

        {/* Lista de precios */}
        <div style={{ position: 'absolute', left: 37, top: 458 }}>
          {filas.map((f, i) => (
            <div key={f.id} style={{ position: 'absolute', top: i * paso, display: 'flex', gap: 9 }}>
              {[
                { texto: f.nombre, ancho: 159 },
                { texto: f.precio, ancho: 119 },
              ].map((celda, j) => (
                <div
                  key={j}
                  style={{
                    width: celda.ancho,
                    height: altoFila,
                    borderRadius: 9,
                    background: C.pastilla,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: fuenteFila,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    padding: '0 4px',
                  }}
                >
                  {celda.texto}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Peso aproximado por pieza */}
        {conPeso.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 404,
              width: 262,
              bottom: FLYER_HEIGHT - 903,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Cloche />
            <div style={{ fontStyle: 'italic', fontSize: 15, textAlign: 'center', lineHeight: 1.35, marginTop: 6, width: 160 }}>
              Peso aproximado por pieza.
            </div>
            <div style={{ margin: '4px 0 6px' }}>
              <Chevron />
            </div>
            <div style={{ alignSelf: 'stretch', background: C.pastilla, borderRadius: 10, padding: '12px 11px', fontSize: 14.5, lineHeight: 1.45 }}>
              {conPeso.map((f) => (
                <div key={f.id}>
                  {f.nombre} — {f.peso}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pie con teléfono */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 87,
            background: C.cafe,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            paddingLeft: 42,
          }}
        >
          {telefono.trim() && (
            <>
              <PhoneIcon />
              <span style={{ color: C.fondo, fontSize: 40, letterSpacing: 0.5 }}>{telefono}</span>
            </>
          )}
        </div>
      </div>
    );
  }
);
FlyerCanvas.displayName = 'FlyerCanvas';
