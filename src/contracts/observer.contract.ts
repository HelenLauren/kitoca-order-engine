export interface OrderEvent<T = unknown> {
  readonly name: string;
  readonly timestamp: Date;
  readonly payload: T;
}

export interface OrderObserver<T = unknown> {
  update(event: OrderEvent<T>): Promise<void> | void;
}
