export type KitchenEvent = {
  id: string;
  type: 'order.sent_to_kitchen' | 'order.kitchen_status_changed';
  branchId: string;
  orderId: string;
  status: string;
  occurredAt: string;
};

type Subscriber = (event: KitchenEvent) => void;
const subscribers = new Map<string, Set<Subscriber>>();

function scope(companyId: string, branchId: string): string {
  return `${companyId}:${branchId}`;
}

export function publishKitchenEvent(companyId: string, event: KitchenEvent): void {
  const branchSubscribers = subscribers.get(scope(companyId, event.branchId));
  branchSubscribers?.forEach((subscriber) => {
    try {
      subscriber(event);
    } catch {
      branchSubscribers.delete(subscriber);
    }
  });
  if (branchSubscribers && !branchSubscribers.size) subscribers.delete(scope(companyId, event.branchId));
}

export function subscribeKitchenEvents(companyId: string, branchId: string, subscriber: Subscriber): () => void {
  const key = scope(companyId, branchId);
  const branchSubscribers = subscribers.get(key) ?? new Set<Subscriber>();
  branchSubscribers.add(subscriber);
  subscribers.set(key, branchSubscribers);
  return () => {
    branchSubscribers.delete(subscriber);
    if (!branchSubscribers.size) subscribers.delete(key);
  };
}