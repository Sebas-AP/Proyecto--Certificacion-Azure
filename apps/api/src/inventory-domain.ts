export type InventoryMovementType = 'PURCHASE' | 'THEORETICAL_CONSUMPTION' | 'WASTE' | 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COUNT';

export function convertQuantity(quantity: string, factor: string): string {
  const value = Number(quantity) * Number(factor);
  if (!Number.isFinite(value) || Number(quantity) <= 0 || Number(factor) <= 0) throw new Error('La cantidad y el factor deben ser positivos');
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

export function movementDelta(type: InventoryMovementType, quantity: string): string {
  if (Number(quantity) <= 0 || !Number.isFinite(Number(quantity))) throw new Error('La cantidad debe ser positiva');
  return ['THEORETICAL_CONSUMPTION', 'WASTE', 'NEGATIVE_ADJUSTMENT', 'TRANSFER_OUT'].includes(type) ? `-${quantity}` : quantity;
}

export function resultingQuantity(current: string, delta: string, allowNegative = false): string {
  const result = Number(current) + Number(delta);
  if (!Number.isFinite(result) || (!allowNegative && result < 0)) throw new Error('La existencia resultante no puede ser negativa');
  return result.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0';
}