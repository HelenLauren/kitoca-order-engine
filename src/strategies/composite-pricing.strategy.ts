import {
  DiscountDetail,
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

export class CompositePricingStrategy implements PricingStrategy {
  constructor(private readonly strategies: readonly PricingStrategy[]) {}

  public calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    context?: PricingStrategyContext
  ): OrderCalculationSummary {
    const subtotal = items.reduce(
      (acc, it) => acc + it.unitPrice * it.quantity,
      0
    );

    let totalDiscount = 0;
    const combinedDiscounts: DiscountDetail[] = [];

    for (const strategy of this.strategies) {
      const result = strategy.calculate(items, baseShipping, context);
      totalDiscount += result.discountAmount;

      if (result.discounts && result.discounts.length > 0) {
        combinedDiscounts.push(...result.discounts);
      }
    }

    const cappedDiscount = Math.min(subtotal, totalDiscount);
    const finalAmount = Math.max(0, subtotal - cappedDiscount + baseShipping);

    return {
      subtotal,
      discountAmount: cappedDiscount,
      shippingCost: baseShipping,
      finalAmount,
      discounts: combinedDiscounts,
    };
  }
}