export type SalesReportRow = {
  order_id: string;
  status: 'COMPLETED' | 'CANCELLED' | string;
  total: string | number;
  method: string | null;
  payment_amount: string | number | null;
};

export type SalesSummary = {
  salesTotal: number;
  paidOrders: number;
  averageTicket: number;
  salesByPaymentMethod: Record<string, number>;
  cancellations: number;
};

function cents(value: string | number | null): number {
  return Math.round(Number(value ?? 0) * 100);
}

export function summarizeSales(rows: readonly SalesReportRow[]): SalesSummary {
  const completed = new Map<string, number>();
  const salesByPaymentMethod: Record<string, number> = {};
  let cancellations = 0;

  for (const row of rows) {
    if (row.status === 'CANCELLED') cancellations += 1;
    if (row.status !== 'COMPLETED') continue;
    completed.set(row.order_id, cents(row.total));
    if (row.method) salesByPaymentMethod[row.method] = (salesByPaymentMethod[row.method] ?? 0) + cents(row.payment_amount);
  }

  const salesCents = [...completed.values()].reduce((sum, value) => sum + value, 0);
  const paidOrders = completed.size;
  return {
    salesTotal: salesCents / 100,
    paidOrders,
    averageTicket: paidOrders ? salesCents / paidOrders / 100 : 0,
    salesByPaymentMethod: Object.fromEntries(Object.entries(salesByPaymentMethod).map(([method, value]) => [method, value / 100])),
    cancellations,
  };
}

export function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function salesSummaryCsv(summary: SalesSummary): string {
  const rows = [
    ['metric', 'method', 'value'],
    ['sales_total', '', summary.salesTotal.toFixed(2)],
    ['paid_orders', '', summary.paidOrders],
    ['average_ticket', '', summary.averageTicket.toFixed(2)],
    ...Object.entries(summary.salesByPaymentMethod).map(([method, value]) => ['sales_by_payment_method', method, value.toFixed(2)]),
    ['cancellations', '', summary.cancellations],
  ];
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`;
}