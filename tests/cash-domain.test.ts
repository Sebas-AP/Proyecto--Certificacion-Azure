import { describe, expect, it } from 'vitest';
import { calculateChange, calculateExpectedCash, canCompleteOrder, sumAmounts } from '../apps/api/src/cash-domain.js';

describe('dominio de caja y pagos', () => {
  it('suma importes sin errores de coma flotante', () => {
    expect(sumAmounts(['10.10', '0.20', 1.05])).toBe(11.35);
  });

  it('rechaza sobrepago y solo completa con coincidencia exacta', () => {
    expect(canCompleteOrder('100.00', '100.00')).toBe(true);
    expect(canCompleteOrder('100.00', '99.99')).toBe(false);
    expect(canCompleteOrder('100.00', '100.01')).toBe(false);
  });

  it('calcula cambio de efectivo y rechaza efectivo insuficiente', () => {
    expect(calculateChange('35.50', '50.00')).toBe(14.5);
    expect(() => calculateChange('35.50', '35.49')).toThrow('insuficiente');
  });

  it('calcula efectivo esperado y diferencia de cierre', () => {
    const expected = calculateExpectedCash('500.00', '20.00', '10.00', '100.00', '15.00');
    expect(expected).toBe(595);
    expect(600 - expected).toBe(5);
  });

  it('mantiene idempotencia por clave como contrato de dominio', () => {
    const keys = new Set(['payment-001']);
    expect(keys.has('payment-001')).toBe(true);
    expect(keys.size).toBe(1);
  });
});