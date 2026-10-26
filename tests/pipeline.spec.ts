import {
  OrderPipelineBuilder,
  OrderContext,
  OrderItem,
  StandardPricingStrategy,
  ExoticPetBundleDiscountStrategy,
  StockValidationStep,
  PaymentSimulatorStep,
} from "../src";

describe("Kitoca Order Engine - Pipeline Tests", () => {
  const items: OrderItem[] = [
    {
      id: "1",
      name: "Ração Chinchila",
      targetSpecies: "Chinchila",
      unitPrice: 40,
      quantity: 3,
    },
  ];

  describe("Pricing Strategies", () => {
    test("deve calcular subtotal e frete sem desconto usando StandardPricingStrategy", () => {
      const strategy = new StandardPricingStrategy();
      const summary = strategy.calculate(items, 15.0);

      expect(summary.subtotal).toBe(120);
      expect(summary.discountAmount).toBe(0);
      expect(summary.shippingCost).toBe(15.0);
      expect(summary.finalAmount).toBe(135.0);
    });

    test("deve calcular desconto de 10% para 3 itens da espécie Chinchila", () => {
      const strategy = new ExoticPetBundleDiscountStrategy("Chinchila", 3, 0.1);
      const summary = strategy.calculate(items, 10.0);

      expect(summary.subtotal).toBe(120);
      expect(summary.discountAmount).toBe(12);
      expect(summary.shippingCost).toBe(10.0);
      expect(summary.finalAmount).toBe(118);
    });

    test("não deve aplicar desconto se a quantidade da espécie for menor que o mínimo", () => {
      const strategy = new ExoticPetBundleDiscountStrategy("Chinchila", 5, 0.1);
      const summary = strategy.calculate(items, 10.0);

      expect(summary.subtotal).toBe(120);
      expect(summary.discountAmount).toBe(0);
      expect(summary.finalAmount).toBe(130);
    });
  });

  describe("StockValidationStep", () => {
    test("deve avançar no pipeline quando o estoque for suficiente", async () => {
      const mockInv = { getAvailableStock: async () => 10 };
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new StockValidationStep(mockInv))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-01",
        customerId: "C1",
        items,
        metadata: {},
      };

      const result = await pipeline.process(ctx);
      expect(result).toBe(ctx);
    });

    test("deve interromper o pipeline quando estoque for insuficiente", async () => {
      const mockInv = { getAvailableStock: async () => 1 }; // precisa de 3
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new StockValidationStep(mockInv))
        .build();

      const ctx: OrderContext = {
        orderId: "1",
        customerId: "C1",
        items,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow(
        /Estoque Insuficiente/
      );
    });
  });

  describe("PaymentSimulatorStep", () => {
    test("deve autorizar o pagamento com sucesso", async () => {
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new PaymentSimulatorStep(false))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-02",
        customerId: "C1",
        items,
        metadata: {},
      };

      await pipeline.process(ctx);
      expect(ctx.paymentStatus).toBe("AUTHORIZED");
    });

    test("deve recusar a transação e lançar erro se simulado para falhar", async () => {
      let failedNotified = false;
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new PaymentSimulatorStep(true))
        .on("pipeline:failed", {
          update: () => {
            failedNotified = true;
          },
        })
        .build();

      const ctx: OrderContext = {
        orderId: "PED-03",
        customerId: "C1",
        items,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow(
        /Transação recusada pela instituição bancária/
      );
      expect(ctx.paymentStatus).toBe("DECLINED");
      expect(failedNotified).toBe(true);
    });
  });

  describe("OrderPipeline & Builder lifecycle", () => {
    test("deve disparar eventos pipeline:started e pipeline:completed no fluxo de sucesso", async () => {
      const events: string[] = [];

      const pipeline = OrderPipelineBuilder.create()
        .on("pipeline:started", {
          update: (e) => {
            events.push(e.name);
          },
        })
        .on("pipeline:completed", {
          update: (e) => {
            events.push(e.name);
          },
        })
        .addStep({
          name: "DummyStep",
          execute: async (_ctx, next) => {
            await next();
          },
        })
        .build();

      const ctx: OrderContext = {
        orderId: "PED-04",
        customerId: "C1",
        items: [],
        metadata: {},
      };

      await pipeline.process(ctx);
      expect(events).toEqual(["pipeline:started", "pipeline:completed"]);
    });

    test("deve lançar erro se tentar criar pipeline sem passos", () => {
      expect(() => OrderPipelineBuilder.create().build()).toThrow(
        "[OrderPipelineBuilder] A esteira deve conter ao menos um passo."
      );
    });

    test("deve lançar erro ao passar passo inválido para addStep", () => {
      expect(() =>
        OrderPipelineBuilder.create().addStep(null as any)
      ).toThrow("[OrderPipelineBuilder] Passo inválido informado.");

      expect(() =>
        OrderPipelineBuilder.create().addStep({ name: "InvalidStep" } as any)
      ).toThrow("[OrderPipelineBuilder] Passo inválido informado.");
    });
  });
});
