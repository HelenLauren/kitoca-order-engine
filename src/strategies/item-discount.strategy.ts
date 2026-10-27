import {
  DiscountDetail,
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

export class ItemDiscountPricingStrategy implements PricingStrategy {
  public calculate(
    items: readonly OrderItem[],
    baseShipping: number,
    _context?: PricingStrategyContext
  ): OrderCalculationSummary {
    let subtotal = 0;
    let totalDiscount = 0;
    const discounts: DiscountDetail[] = [];

    for (const item of items) {
      const itemSubtotal = item.unitPrice * item.quantity;
      subtotal += itemSubtotal;

      if (item.hasDiscount && item.discount) {
        let discountPerUnit = 0;
        let desc = "";

        if (item.discount.type === "PERCENTAGE") {
          discountPerUnit = item.unitPrice * (item.discount.value / 100);
          desc = `Desconto promocional de ${item.discount.value}% no item '${item.name}'`;
        } else if (item.discount.type === "FIXED") {
          discountPerUnit = Math.min(item.unitPrice, item.discount.value);
          desc = `Desconto promocional de R$ ${item.discount.value.toFixed(
            2
          )} no item '${item.name}'`;
        }

        const itemTotalDiscount = discountPerUnit * item.quantity;
        totalDiscount += itemTotalDiscount;

        if (itemTotalDiscount > 0) {
          discounts.push({
            description: desc,
            amount: itemTotalDiscount,
            source: "ITEM",
          });
        }
      }
    }

    return {
      subtotal,
      discountAmount: totalDiscount,
      shippingCost: baseShipping,
      finalAmount: Math.max(0, subtotal - totalDiscount + baseShipping),
      discounts,
    };
  }
}