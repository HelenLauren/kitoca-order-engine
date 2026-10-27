import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";
import {
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";

/**
 * Passo Genérico de Precificação da Esteira:
 * Executa qualquer PricingStrategy (ou CompositePricingStrategy) dentro da esteira de checkout,
 * calculando subtotais, frete, descontos e populando context.pricing e metadados de auditoria.
 */
export class PricingStep implements OrderStep {
  public readonly name = "PricingStep";

  constructor(
    private readonly strategy: PricingStrategy,
    private readonly fallbackShipping: number = 0
  ) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const shipping =
      context.pricing?.shippingCost ??
      (typeof context.metadata.shippingCost === "number"
        ? (context.metadata.shippingCost as number)
        : this.fallbackShipping);

    const pricingContext: PricingStrategyContext = {
      customerId: context.customerId,
      paymentMethod:
        typeof context.metadata.paymentMethod === "string"
          ? (context.metadata.paymentMethod as string)
          : undefined,
      couponCode:
        typeof context.metadata.couponCode === "string"
          ? (context.metadata.couponCode as string)
          : undefined,
      metadata: context.metadata,
    };

    const summary = this.strategy.calculate(
      context.items,
      shipping,
      pricingContext
    );

    context.pricing = summary;
    context.metadata.pricingBreakdown = summary.discounts ?? [];

    await next();
  }
}