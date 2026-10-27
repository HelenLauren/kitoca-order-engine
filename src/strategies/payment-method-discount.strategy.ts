import {
  DiscountDetail,
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

export class PaymentMethodDiscountStrategy implements PricingStrategy {
  constructor(
    private readonly targetMethod: string = "PIX",
    private readonly discountRatio: number = 0.05
  ) {}

  public calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    context?: PricingStrategyContext
  ): OrderCalculationSummary {
    const subtotal = items.reduce(
      (acc, it) => acc + it.unitPrice * it.quantity,
      0
    );

    const isMatch =
      context?.paymentMethod?.toUpperCase() === this.targetMethod.toUpperCase();

    const discountAmount = isMatch ? subtotal * this.discountRatio : 0;

    const discounts: DiscountDetail[] =
      discountAmount > 0
        ? [
            {
              description: `Desconto de ${(this.discountRatio * 100).toFixed(
                0
              )}% para pagamento via ${this.targetMethod}`,
              amount: discountAmount,
              source: "PAYMENT_METHOD",
            },
          ]
        : [];

    return {
      subtotal,
      discountAmount,
      shippingCost: baseShipping,
      finalAmount: Math.max(0, subtotal - discountAmount + baseShipping),
      discounts,
    };
  }
}