export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'SENT_TO_KITCHEN' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'COMPLETED';

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['SENT_TO_KITCHEN', 'CANCELLATION_REQUESTED'],
  SENT_TO_KITCHEN: ['CANCELLATION_REQUESTED', 'COMPLETED'], CANCELLATION_REQUESTED: ['CANCELLED'], CANCELLED: [], COMPLETED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean { return transitions[from].includes(to); }
export type KitchenStatus = 'PENDING' | 'IN_PROGRESS' | 'READY';
export function canKitchenTransition(from: KitchenStatus, to: KitchenStatus): boolean {
  return (from === 'PENDING' && to === 'IN_PROGRESS') || (from === 'IN_PROGRESS' && to === 'READY');
}
export function calculateTotal(items: ReadonlyArray<{ quantity: number; unitPrice: number; modifierTotal?: number }>): number {
  return Math.round(items.reduce((sum, item) => sum + item.quantity * (item.unitPrice + (item.modifierTotal ?? 0)), 0) * 100) / 100;
}