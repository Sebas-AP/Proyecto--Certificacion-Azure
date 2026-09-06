import { describe, expect, it } from 'vitest';
import { convertQuantity, movementDelta, resultingQuantity } from '../apps/api/src/inventory-domain.js';

describe('dominio de inventario', () => {
  it('convierte unidades con un factor positivo', () => expect(convertQuantity('2.5', '4')).toBe('10'));
  it('calcula entradas y salidas inmutables', () => {
    expect(movementDelta('PURCHASE', '3')).toBe('3');
    expect(movementDelta('WASTE', '3')).toBe('-3');
  });
  it('rechaza existencias negativas por defecto', () => expect(() => resultingQuantity('2', '-3')).toThrow());
  it('permite negativos solo con configuración explícita', () => expect(resultingQuantity('2', '-3', true)).toBe('-1'));
});