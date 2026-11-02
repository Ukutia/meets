import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle the actual TypeScript implementation without changing application output.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/saldos.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
  tsconfig: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)),
});
const { calcularSaldosVendedores } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const vendedores = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Luis' }];
const pedidos = [
  { vendedor: 1, fecha: '2026-04-30', total: 100 },
  { vendedor: { id: 1 }, fecha: '2026-05-01', total: 50 },
  { vendedor: 1, fecha: '2026-05-31', total: 25 },
  { vendedor: 1, fecha: '2026-06-01', total: 999 },
  { vendedor: 2, fecha: '2026-04-01', total: 200 },
];
const pagos = [
  { vendedor: 1, fecha: '2026-04-30', tipo: 'pago', monto: 40 },
  { vendedor: 1, fecha: '2026-05-01', tipo: 'pago', monto: 60 },
  { vendedor: 1, fecha: '2026-05-31', tipo: 'adelanto', monto: 10 },
  { vendedor: 1, fecha: '2026-06-01', tipo: 'pago', monto: 999 },
];

test('carries unpaid sales; a later payment settles the opening balance', () => {
  const [ana, luis] = calcularSaldosVendedores(vendedores, pedidos, pagos, { desde: '2026-05-01', hasta: '2026-05-31' });
  assert.deepEqual([ana.saldoInicial, ana.ventas, ana.pagos, ana.adelantos, ana.saldo], [60, 75, 60, 10, 65]);
  assert.deepEqual([luis.saldoInicial, luis.ventas, luis.saldo], [200, 0, 200]);
});

test('carries credits and advances, including sellers without current sales', () => {
  const [ana] = calcularSaldosVendedores(vendedores, [], pagos, { desde: '2026-06-01' });
  assert.equal(ana.saldoInicial, -110);
  assert.equal(ana.saldo, -1109);
});

test('all history has no opening balance and preserves the historical total', () => {
  const [ana] = calcularSaldosVendedores(vendedores, pedidos, pagos);
  assert.equal(ana.saldoInicial, 0);
  assert.equal(ana.saldo, 65);
});

test('moving the period start redistributes transactions without changing closing balance', () => {
  const [ana] = calcularSaldosVendedores(vendedores, pedidos, pagos, { desde: '2026-05-02', hasta: '2026-05-31' });
  assert.equal(ana.saldoInicial, 50);
  assert.equal(ana.ventas, 25);
  assert.equal(ana.pagos, 0);
  assert.equal(ana.saldo, 65);
});
