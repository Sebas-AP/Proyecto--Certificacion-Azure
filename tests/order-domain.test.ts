import { describe, expect, it } from 'vitest';
import { calculateTotal, canTransition } from '../apps/api/src/order-domain.js';

describe('dominio de pedidos', () => {
  it('calcula total con cantidad y modificadores', () => {
    expect(calculateTotal([{ quantity: 2, unitPrice: 35, modifierTotal: 5 }, { quantity: 1, unitPrice: 20 }])).toBe(100);
  });
  it('solo permite transiciones controladas', () => {
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransition('DRAFT', 'SENT_TO_KITCHEN')).toBe(false);
    expect(canTransition('SENT_TO_KITCHEN', 'DRAFT')).toBe(false);
  });
});