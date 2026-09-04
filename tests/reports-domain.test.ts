import { describe, expect, it } from 'vitest';
import { escapeCsv, salesSummaryCsv, summarizeSales } from '../apps/api/src/reports-domain.js';

describe('reportes piloto', () => {
  it('calcula ventas y ticket sin duplicar un pedido con pagos mixtos', () => {
    expect(summarizeSales([
      { order_id: 'order-1', status: 'COMPLETED', total: '100.00', method: 'CASH', payment_amount: '60.00' },
      { order_id: 'order-1', status: 'COMPLETED', total: '100.00', method: 'CARD', payment_amount: '40.00' },
      { order_id: 'order-2', status: 'CANCELLED', total: '80.00', method: null, payment_amount: null },
    ])).toEqual({
      salesTotal: 100,
      paidOrders: 1,
      averageTicket: 100,
      salesByPaymentMethod: { CASH: 60, CARD: 40 },
      cancellations: 1,
    });
  });

  it('escapa campos CSV peligrosos y conserva salto de linea', () => {
    expect(escapeCsv('Gorditas, "especiales"\nturno')).toBe('"Gorditas, ""especiales""\nturno"');
    expect(salesSummaryCsv({ salesTotal: 10, paidOrders: 1, averageTicket: 10, salesByPaymentMethod: { 'CARD, POS': 10 }, cancellations: 0 }))
      .toContain('sales_by_payment_method,"CARD, POS",10.00');
  });
});