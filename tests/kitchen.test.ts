import { describe, expect, it } from 'vitest';
import { canKitchenTransition } from '../apps/api/src/order-domain.js';
import { publishKitchenEvent, subscribeKitchenEvents } from '../apps/api/src/kitchen-events.js';

describe('cocina', () => {
  it('solo permite iniciar y luego marcar lista', () => {
    expect(canKitchenTransition('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(canKitchenTransition('IN_PROGRESS', 'READY')).toBe(true);
    expect(canKitchenTransition('PENDING', 'READY')).toBe(false);
    expect(canKitchenTransition('READY', 'READY')).toBe(false);
  });

  it('aisla los eventos por sucursal y permite desuscribirse', () => {
    const branchOne: string[] = [];
    const branchTwo: string[] = [];
    const removeOne = subscribeKitchenEvents('company', 'branch-one', (event) => branchOne.push(event.orderId));
    const removeTwo = subscribeKitchenEvents('company', 'branch-two', (event) => branchTwo.push(event.orderId));
    const event = { id: 'event', type: 'order.sent_to_kitchen' as const, branchId: 'branch-one', orderId: 'order', status: 'PENDING', occurredAt: new Date().toISOString() };
    publishKitchenEvent('company', event);
    removeOne();
    publishKitchenEvent('company', event);
    removeTwo();
    expect(branchOne).toEqual(['order']);
    expect(branchTwo).toEqual([]);
  });

  it('ignora conexiones SSE que fallan al recibir un evento', () => {
    const event = { id: 'event', type: 'order.sent_to_kitchen' as const, branchId: 'branch-error', orderId: 'order', status: 'PENDING', occurredAt: new Date().toISOString() };
    subscribeKitchenEvents('company', 'branch-error', () => { throw new Error('cliente desconectado'); });
    expect(() => publishKitchenEvent('company', event)).not.toThrow();
    const received: string[] = [];
    subscribeKitchenEvents('company', 'branch-error', (nextEvent) => received.push(nextEvent.orderId));
    publishKitchenEvent('company', event);
    expect(received).toEqual(['order']);
  });
});