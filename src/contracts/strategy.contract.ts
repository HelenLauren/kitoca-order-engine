export type DiscountType = "PERCENTAGE" | "FIXED";

export interface ItemDiscount {
  readonly type: DiscountType;
  readonly value: number;
}

export interface OrderItem {
  readonly id: string;
  readonly name: string;
  readonly targetSpecies: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly hasDiscount?: boolean;
  readonly discount?: ItemDiscount;
}

export type DiscountSource =
  | "ITEM"
  | "BUNDLE"
  | "COUPON"
  | "PAYMENT_METHOD"
  | "LOYALTY"
  | "CUSTOM";

export interface DiscountDetail {
  readonly description: string;
  readonly amount: number;
  readonly source: DiscountSource;
}

export interface OrderCalculationSummary {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly shippingCost: number;
  readonly finalAmount: number;
  readonly discounts?: readonly DiscountDetail[];
}

export interface PricingStrategyContext {
  readonly customerId?: string;
  readonly paymentMethod?: string;
  readonly couponCode?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface PricingStrategy {
  calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    context?: PricingStrategyContext
  ): OrderCalculationSummary;
}