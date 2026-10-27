import {
  DiscountDetail,
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

export class ExoticPetBundleDiscountStrategy implements PricingStrategy {
  constructor(
    private readonly speciesTarget: string,
    private readonly minItemsForDiscount: number,
    private readonly discountRatio: number
  ) {}

  public calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    _context?: PricingStrategyContext
  ): OrderCalculationSummary {
    const subtotal = items.reduce(
      (acc, it) => acc + it.unitPrice * it.quantity,
      0
    );
    const targetItemsCount = items
      .filter(
        (it) =>
          it.targetSpecies.toLowerCase() === this.speciesTarget.toLowerCase()
      )
      .reduce((acc, it) => acc + it.quantity, 0);

    const discountAmount =
      targetItemsCount >= this.minItemsForDiscount
        ? subtotal * this.discountRatio
        : 0;

    const discounts: DiscountDetail[] =
      discountAmount > 0
        ? [
            {
              description: `Desconto de combo para espécie '${this.speciesTarget}' (${(
                this.discountRatio * 100
              ).toFixed(0)}%)`,
              amount: discountAmount,
              source: "BUNDLE",
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