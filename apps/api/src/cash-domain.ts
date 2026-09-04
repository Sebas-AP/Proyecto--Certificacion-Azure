export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

export function cents(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Importe invalido');
  return Math.round(parsed * 100);
}

export function money(value: string | number): number {
  return cents(value) / 100;
}

export function sumAmounts(values: ReadonlyArray<string | number>): number {
  return money(values.reduce<number>((sum, value) => sum + cents(value), 0) / 100);
}

export function calculateChange(amount: string | number, cashReceived: string | number): number {
  const change = cents(cashReceived) - cents(amount);
  if (change < 0) throw new Error('El efectivo recibido es insuficiente');
  return money(change / 100);
}

export function calculateExpectedCash(
  openingCash: string | number,
  movementsIn: string | number,
  movementsOut: string | number,
  cashPayments: string | number,
  cashChange: string | number,
): number {
  return money((cents(openingCash) + cents(movementsIn) - cents(movementsOut) + cents(cashPayments) - cents(cashChange)) / 100);
}

export function canCompleteOrder(total: string | number, paid: string | number): boolean {
  return cents(total) === cents(paid);
}