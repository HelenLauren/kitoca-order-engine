import {
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

export class StandardPricingStrategy implements PricingStrategy {
  public calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    _context?: PricingStrategyContext
  ): OrderCalculationSummary {
    const subtotal = items.reduce(
      (acc, it) => acc + it.unitPrice * it.quantity,
      0
    );
    const discountAmount = 0;
    return {
      subtotal,
      discountAmount,
      shippingCost: baseShipping,
      finalAmount: Math.max(0, subtotal - discountAmount + baseShipping),
      discounts: [],
    };
  }
}
