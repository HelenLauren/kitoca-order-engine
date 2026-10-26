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

export interface OrderCalculationSummary {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly shippingCost: number;
  readonly finalAmount: number;
}

export interface PricingStrategy {
  calculate(items: readonly OrderItem[], baseShipping: number): OrderCalculationSummary;
}

