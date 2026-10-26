import {
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
} from "../contracts/strategy.contract";

export class ExoticPetBundleDiscountStrategy implements PricingStrategy {
  constructor(
    private readonly speciesTarget: string,
    private readonly minItemsForDiscount: number,
    private readonly discountRatio: number
  ) {}

  public calculate(
    items: readonly OrderItem[],
    baseShipping: number
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
    return {
      subtotal,
      discountAmount,
      shippingCost: baseShipping,
      finalAmount: Math.max(0, subtotal - discountAmount + baseShipping),
    };
  }
}
