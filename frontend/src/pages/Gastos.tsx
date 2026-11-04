import { useState } from 'react';
import { RangoFechaSelect, rangoInicial, type RangoState } from '@/components/shared/RangoFechaSelect';
import { GastosEmpresa } from '@/components/tesoreria/GastosEmpresa';

export default function Gastos() {
  const [rango, setRango] = useState<RangoState>(rangoInicial('anio'));

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Gastos de la Empresa</h1>
          <p className="text-muted-foreground">Luz, bencina, dominio y otras facturas que no son mercadería.</p>
        </div>
        <RangoFechaSelect value={rango} onChange={setRango} />
      </div>
      <GastosEmpresa rango={rango.rango} />
    </div>
  );
}
