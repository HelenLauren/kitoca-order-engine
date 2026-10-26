import {
  OrderPipelineBuilder,
  OrderContext,
  OrderItem,
  OrderCalculationSummary,
  PricingStrategy,
  StockValidationStep,
  OrderStep,
  NextFunction,
  OrderObserver,
  OrderEvent,
  ExoticPetBundleDiscountStrategy,
} from "../src";

// 1. EXTENSÃO OCP: Passo customizado para checagem de acomodação volumosa de roedores
class HabitatLogisticsConstraintStep implements OrderStep {
  public readonly name = "HabitatLogisticsConstraintStep";

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const hasBulkyCage = context.items.some((i) =>
      i.name.toLowerCase().includes("gaiola chinchila")
    );
    if (hasBulkyCage) {
      context.metadata.specialCareLogistics = true;
    }
    await next();
  }
}

// 2. EXTENSÃO OCP: Observador customizado de auditoria
class AuditNotificationObserver implements OrderObserver {
  public receivedEvents: OrderEvent[] = [];

  public update(event: OrderEvent): void {
    this.receivedEvents.push(event);
  }
}

// 3. EXTENSÃO OCP: Passo customizado de checagem antifraude (Guia de Extensão)
class AntiFraudCheckStep implements OrderStep {
  public readonly name = "AntiFraudCheckStep";

  public async execute(
    ctx: OrderContext,
    next: NextFunction
  ): Promise<void> {
    if (ctx.pricing && ctx.pricing.finalAmount > 5000) {
      ctx.metadata.requiresManualReview = true;
    }
    await next();
  }
}

// 4. EXTENSÃO OCP: Estratégia de precificação customizada para Tutor VIP (Guia de Extensão)
class VipTutorPricingStrategy implements PricingStrategy {
  public calculate(
    items: readonly OrderItem[],
    _baseShipping: number
  ): OrderCalculationSummary {
    const subtotal = items.reduce(
      (acc, it) => acc + it.unitPrice * it.quantity,
      0
    );
    const discountAmount = subtotal * 0.2; // 20% tutor VIP
    return {
      subtotal,
      discountAmount,
      shippingCost: 0, // Frete grátis
      finalAmount: subtotal - discountAmount,
    };
  }
}

describe("Kitoca Order Engine - Extensibility Tests (OCP)", () => {
  test("deve suportar passo e evento customizado injetados pelo cliente (OCP)", async () => {
    let notified = false;

    class CustomDiscountStep implements OrderStep {
      public readonly name = "CustomDiscountStep";
      async execute(ctx: OrderContext, next: NextFunction) {
        ctx.metadata.customApplied = true;
        await next();
      }
    }

    const pipeline = OrderPipelineBuilder.create()
      .addStep(new CustomDiscountStep())
      .on("pipeline:completed", {
        update: () => {
          notified = true;
        },
      })
      .build();

    const result = await pipeline.process({
      orderId: "2",
      customerId: "C2",
      items: [],
      metadata: {},
    });

    expect(result.metadata.customApplied).toBe(true);
    expect(notified).toBe(true);
  });

  test("deve executar a montagem fluente com HabitatLogisticsConstraintStep e AuditNotificationObserver", async () => {
    const inventoryMock = { getAvailableStock: async () => 20 };
    const strategy = new ExoticPetBundleDiscountStrategy("Chinchila", 2, 0.15); // 15% off
    const auditObserver = new AuditNotificationObserver();

    const pipeline = OrderPipelineBuilder.create()
      .addStep(new StockValidationStep(inventoryMock))
      .addStep(new HabitatLogisticsConstraintStep())
      .on("pipeline:completed", auditObserver)
      .build();

    const order: OrderContext = {
      orderId: "PED-KITOCA-2026",
      customerId: "TUTOR-01",
      items: [
        {
          id: "P1",
          name: "Gaiola Chinchila Alta",
          targetSpecies: "Chinchila",
          unitPrice: 300,
          quantity: 2,
        },
      ],
      metadata: {},
    };

    order.pricing = strategy.calculate(order.items, 25.0);
    const processedOrder = await pipeline.process(order);

    expect(order.pricing.subtotal).toBe(600);
    expect(order.pricing.discountAmount).toBe(90);
    expect(order.pricing.finalAmount).toBe(535); // 600 - 90 + 25 = 535
    expect(processedOrder.metadata.specialCareLogistics).toBe(true);
    expect(auditObserver.receivedEvents).toHaveLength(1);
    expect(auditObserver.receivedEvents[0].name).toBe("pipeline:completed");
  });

  test("deve suportar AntiFraudCheckStep e VipTutorPricingStrategy do guia de extensão", async () => {
    const vipStrategy = new VipTutorPricingStrategy();
    const items: OrderItem[] = [
      {
        id: "EXP-01",
        name: "Terrário Automatizado Especial",
        targetSpecies: "Pogona",
        unitPrice: 3500,
        quantity: 2,
      },
    ];

    const pricing = vipStrategy.calculate(items, 50);
    expect(pricing.subtotal).toBe(7000);
    expect(pricing.discountAmount).toBe(1400); // 20%
    expect(pricing.shippingCost).toBe(0); // frete grátis
    expect(pricing.finalAmount).toBe(5600);

    const pipeline = OrderPipelineBuilder.create()
      .addStep(new AntiFraudCheckStep())
      .build();

    const ctx: OrderContext = {
      orderId: "PED-VIP-99",
      customerId: "VIP-TUTOR",
      items,
      pricing,
      metadata: {},
    };

    await pipeline.process(ctx);
    expect(ctx.metadata.requiresManualReview).toBe(true);
  });
});
