export interface OrderItem {
  readonly id: string;
  readonly name: string;
  readonly targetSpecies: string;
  readonly unitPrice: number;
  readonly quantity: number;
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
