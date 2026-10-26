import {
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
} from "../contracts/strategy.contract";

export class ItemDiscountPricingStrategy implements PricingStrategy {
  public calculate(
    items: readonly OrderItem[],
    baseShipping: number
  ): OrderCalculationSummary {
    let subtotal = 0;
    let totalDiscount = 0;

    for (const item of items) {
      const itemSubtotal = item.unitPrice * item.quantity;
      subtotal += itemSubtotal;

      if (item.hasDiscount && item.discount) {
        let discountPerUnit = 0;
        if (item.discount.type === "PERCENTAGE") {
          discountPerUnit = item.unitPrice * (item.discount.value / 100);
        } else if (item.discount.type === "FIXED") {
          discountPerUnit = Math.min(item.unitPrice, item.discount.value);
        }
        totalDiscount += discountPerUnit * item.quantity;
      }
    }

    return {
      subtotal,
      discountAmount: totalDiscount,
      shippingCost: baseShipping,
      finalAmount: Math.max(0, subtotal - totalDiscount + baseShipping),
    };
  }
}
