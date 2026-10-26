import { OrderCalculationSummary, OrderItem } from "./strategy.contract";

export type NextFunction = () => Promise<void>;

export interface OrderContext {
  readonly orderId: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  pricing?: OrderCalculationSummary;
  paymentStatus?: "PENDING" | "AUTHORIZED" | "DECLINED";
  metadata: Record<string, unknown>;
}

export interface OrderStep {
  readonly name: string;
  execute(context: OrderContext, next: NextFunction): Promise<void>;
}
