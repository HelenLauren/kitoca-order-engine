import { OrderEvent, OrderObserver } from "../contracts/observer.contract";

export class OrderEventBus {
  private observers: Map<string, Set<OrderObserver>> = new Map();

  public subscribe(eventName: string, observer: OrderObserver): () => void {
    if (!this.observers.has(eventName)) {
      this.observers.set(eventName, new Set());
    }
    const bucket = this.observers.get(eventName)!;
    bucket.add(observer);
    return () => bucket.delete(observer);
  }

  public async publish<T>(eventName: string, payload: T): Promise<void> {
    const bucket = this.observers.get(eventName);
    if (!bucket || bucket.size === 0) return;
    const event: OrderEvent<T> = {
      name: eventName,
      timestamp: new Date(),
      payload,
    };
    await Promise.all(Array.from(bucket).map((obs) => obs.update(event)));
  }
}
