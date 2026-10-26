import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";
import { ItemDiscountPricingStrategy } from "../strategies/item-discount.strategy";

export class ApplyItemDiscountStep implements OrderStep {
  public readonly name = "ApplyItemDiscountStep";

  constructor(private readonly fallbackBaseShipping: number = 0) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    // 1. Validar integridade dos descontos marcados nos produtos
    for (const item of context.items) {
      if (item.hasDiscount) {
        if (!item.discount) {
          throw new Error(
            `[Desconto Inválido] O item '${item.name}' está marcado com desconto, mas não possui especificação de desconto.`
          );
        }
        if (item.discount.value < 0) {
          throw new Error(
            `[Desconto Inválido] O valor de desconto do item '${item.name}' não pode ser negativo.`
          );
        }
        if (item.discount.type === "PERCENTAGE" && item.discount.value > 100) {
          throw new Error(
            `[Desconto Inválido] O desconto percentual do item '${item.name}' não pode ser superior a 100%.`
          );
        }
      }
    }

    // 2. Calcular o desconto dos itens usando a estratégia
    const shipping =
      context.pricing?.shippingCost ??
      (typeof context.metadata.shippingCost === "number"
        ? (context.metadata.shippingCost as number)
        : this.fallbackBaseShipping);

    const discountStrategy = new ItemDiscountPricingStrategy();
    const calculation = discountStrategy.calculate(context.items, shipping);

    const previousDiscount = context.pricing ? context.pricing.discountAmount : 0;
    const totalDiscount = calculation.discountAmount + previousDiscount;
    const subtotal = calculation.subtotal;
    const finalAmount = Math.max(0, subtotal - totalDiscount + shipping);

    context.pricing = {
      subtotal,
      discountAmount: totalDiscount,
      shippingCost: shipping,
      finalAmount,
    };

    // 3. Registrar auditoria no metadata antes de seguir para o pagamento
    context.metadata.discountAppliedBeforePayment = true;
    context.metadata.itemDiscountTotal = calculation.discountAmount;

    await next();
  }
}
