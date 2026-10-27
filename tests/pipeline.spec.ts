import {
  OrderPipelineBuilder,
  OrderContext,
  OrderItem,
  StandardPricingStrategy,
  ExoticPetBundleDiscountStrategy,
  ItemDiscountPricingStrategy,
  StockValidationStep,
  DatabaseInventoryGateway,
  PaymentSimulatorStep,
  PaymentProcessingStep,
  PaymentGateway,
  MockPaymentGateway,
  ApplyItemDiscountStep,
  CompositePricingStrategy,
  PaymentMethodDiscountStrategy,
  PricingStep,
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

    test("deve integrar com banco de dados via DatabaseInventoryGateway em lote sem N+1 queries", async () => {
      // Simula uma tabela do banco de dados (ex: Postgres / Prisma)
      const fakeDb = new Map([
        ["PROD-A", { id: "PROD-A", stock: 15, reservedStock: 3 }], // estoque efetivo = 12
        ["PROD-B", { id: "PROD-B", stock: 5, reservedStock: 0 }],
      ]);

      let queriesCount = 0;
      const dbGateway = new DatabaseInventoryGateway(async (productIds) => {
        queriesCount++;
        // 1 única consulta em lote no banco: SELECT ... WHERE id IN (...)
        return productIds.map((id) => fakeDb.get(id)!).filter(Boolean);
      });

      const multiItems: OrderItem[] = [
        { id: "PROD-A", name: "Gaiola Luxo", targetSpecies: "Roedores", unitPrice: 200, quantity: 2 },
        { id: "PROD-B", name: "Ração Premium", targetSpecies: "Roedores", unitPrice: 50, quantity: 4 },
      ];

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new StockValidationStep(dbGateway))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-DB-01",
        customerId: "CUST-1",
        items: multiItems,
        metadata: {},
      };

      await pipeline.process(ctx);

      // Verificamos que executou apenas 1 query em lote (evitou N+1)
      expect(queriesCount).toBe(1);
      const report = ctx.metadata.stockValidationReport as any;
      expect(report).toBeDefined();
      expect(report.allAvailable).toBe(true);
      expect(report.items).toHaveLength(2);
      expect(report.items[0].availableQuantity).toBe(12); // 15 - 3 reservados
    });

    test("deve suportar reserva temporária de estoque atômica na validação", async () => {
      let reservedOrderId = "";
      const dbGateway = new DatabaseInventoryGateway(
        async () => [{ id: "1", stock: 10 }],
        async (req) => {
          reservedOrderId = req.orderId;
          return {
            success: true,
            reservationToken: "TOKEN-RES-XYZ-99",
            reservedUntil: new Date(Date.now() + 15 * 60 * 1000),
          };
        }
      );

      const pipeline = OrderPipelineBuilder.create()
        .addStep(
          new StockValidationStep(dbGateway, {
            reserveOnValidation: true,
            reservationTtlMinutes: 15,
          })
        )
        .build();

      const ctx: OrderContext = {
        orderId: "PED-RESERVE-77",
        customerId: "C1",
        items,
        metadata: {},
      };

      await pipeline.process(ctx);

      expect(reservedOrderId).toBe("PED-RESERVE-77");
      expect(ctx.metadata.stockReservationToken).toBe("TOKEN-RES-XYZ-99");
    });

    test("deve permitir prosseguir caso o item permita encomenda (backorder)", async () => {
      const dbGateway = new DatabaseInventoryGateway(async () => [
        { id: "1", stock: 0, allowBackorder: true }, // Estoque 0 mas permite encomenda
      ]);

      const pipeline = OrderPipelineBuilder.create()
        .addStep(
          new StockValidationStep(dbGateway, {
            allowBackorders: true,
          })
        )
        .build();

      const ctx: OrderContext = {
        orderId: "PED-BACKORDER-01",
        customerId: "C1",
        items,
        metadata: {},
      };

      const result = await pipeline.process(ctx);
      expect(result).toBe(ctx);
    });

    test("deve reportar todos os múltiplos itens sem estoque de uma vez", async () => {
      const dbGateway = new DatabaseInventoryGateway(async () => [
        { id: "P1", stock: 1 },
        { id: "P2", stock: 0 },
      ]);

      const multiItems: OrderItem[] = [
        { id: "P1", name: "Ração Rara", targetSpecies: "Chinchila", unitPrice: 50, quantity: 5 },
        { id: "P2", name: "Bebedouro Inox", targetSpecies: "Chinchila", unitPrice: 30, quantity: 2 },
      ];

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new StockValidationStep(dbGateway))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-MULTI-FAIL",
        customerId: "C1",
        items: multiItems,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow(
        /Ração Rara.*Bebedouro Inox/
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

  describe("Product Discounts (% and $) - ItemDiscountPricingStrategy & ApplyItemDiscountStep", () => {
    test("deve calcular descontos percentuais e em valor fixo por produto", () => {
      const discountedItems: OrderItem[] = [
        {
          id: "P1",
          name: "Ração Premium Papagaio",
          targetSpecies: "Papagaio",
          unitPrice: 100,
          quantity: 2,
          hasDiscount: true,
          discount: { type: "PERCENTAGE", value: 15 }, // 15% de 100 = 15 x 2 = 30
        },
        {
          id: "P2",
          name: "Brinquedo Madeira Roedores",
          targetSpecies: "Hamster",
          unitPrice: 50,
          quantity: 1,
          hasDiscount: true,
          discount: { type: "FIXED", value: 10 }, // R$ 10 de desconto x 1 = 10
        },
        {
          id: "P3",
          name: "Bebedouro Automático",
          targetSpecies: "Aves",
          unitPrice: 30,
          quantity: 1,
          hasDiscount: false, // Sem desconto
        },
      ];

      const strategy = new ItemDiscountPricingStrategy();
      const summary = strategy.calculate(discountedItems, 20);

      // Subtotal: (100 * 2) + 50 + 30 = 280
      // Descontos: 30 + 10 = 40
      // Frete: 20
      // Final: 280 - 40 + 20 = 260
      expect(summary.subtotal).toBe(280);
      expect(summary.discountAmount).toBe(40);
      expect(summary.shippingCost).toBe(20);
      expect(summary.finalAmount).toBe(260);
    });

    test("deve aplicar o desconto na pipeline antes da autorização do pagamento", async () => {
      const inventoryMock = { getAvailableStock: async () => 50 };
      const discountedItems: OrderItem[] = [
        {
          id: "P1",
          name: "Ração Super Premium Furão",
          targetSpecies: "Furão",
          unitPrice: 80,
          quantity: 2,
          hasDiscount: true,
          discount: { type: "PERCENTAGE", value: 20 }, // 20% de 80 = 16 x 2 = 32 de desconto
        },
      ];

      let priceObservedAtPayment: number | undefined;

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new StockValidationStep(inventoryMock))
        .addStep(new ApplyItemDiscountStep(15)) // Aplica o desconto antes do pagamento (frete base 15)
        .addStep({
          name: "InspectBeforePaymentStep",
          execute: async (ctx, next) => {
            priceObservedAtPayment = ctx.pricing?.finalAmount;
            await next();
          },
        })
        .addStep(new PaymentSimulatorStep(false))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-DISCOUNT-01",
        customerId: "CUST-1",
        items: discountedItems,
        metadata: {},
      };

      await pipeline.process(ctx);

      // Subtotal: 160, Desconto: 32, Frete: 15, Total: 160 - 32 + 15 = 143
      expect(ctx.pricing?.subtotal).toBe(160);
      expect(ctx.pricing?.discountAmount).toBe(32);
      expect(ctx.pricing?.finalAmount).toBe(143);
      expect(priceObservedAtPayment).toBe(143);
      expect(ctx.paymentStatus).toBe("AUTHORIZED");
      expect(ctx.metadata.discountAppliedBeforePayment).toBe(true);
      expect(ctx.metadata.itemDiscountTotal).toBe(32);
    });

    test("deve lançar erro se produto marcado com desconto não tiver especificação de desconto", async () => {
      const invalidItems: OrderItem[] = [
        {
          id: "P-INVALID",
          name: "Item Inválido",
          targetSpecies: "Reptil",
          unitPrice: 100,
          quantity: 1,
          hasDiscount: true, // marcado como true mas sem discount
        },
      ];

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new ApplyItemDiscountStep())
        .build();

      const ctx: OrderContext = {
        orderId: "PED-ERR",
        customerId: "CUST-ERR",
        items: invalidItems,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow(
        /Item Inválido.*está marcado com desconto, mas não possui especificação de desconto/
      );
    });

    test("deve validar se percentual de desconto ultrapassa 100% ou se valor é negativo", async () => {
      const overDiscountItem: OrderItem[] = [
        {
          id: "P-OVER",
          name: "Item Desconto Excessivo",
          targetSpecies: "Aves",
          unitPrice: 100,
          quantity: 1,
          hasDiscount: true,
          discount: { type: "PERCENTAGE", value: 150 }, // > 100%
        },
      ];

      const negativeDiscountItem: OrderItem[] = [
        {
          id: "P-NEG",
          name: "Item Desconto Negativo",
          targetSpecies: "Aves",
          unitPrice: 100,
          quantity: 1,
          hasDiscount: true,
          discount: { type: "FIXED", value: -10 }, // < 0
        },
      ];

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new ApplyItemDiscountStep())
        .build();

      await expect(
        pipeline.process({
          orderId: "ERR1",
          customerId: "C1",
          items: overDiscountItem,
          metadata: {},
        })
      ).rejects.toThrow(/não pode ser superior a 100%/);

      await expect(
        pipeline.process({
          orderId: "ERR2",
          customerId: "C2",
          items: negativeDiscountItem,
          metadata: {},
        })
      ).rejects.toThrow(/não pode ser negativo/);
    });
  });

  describe("Enhanced Pricing Architecture - Composite, Payment Method & PricingStep", () => {
    test("deve conceder desconto no PIX via PaymentMethodDiscountStrategy", () => {
      const strategy = new PaymentMethodDiscountStrategy("PIX", 0.1); // 10% no PIX
      const orderItems: OrderItem[] = [
        { id: "1", name: "Ração", targetSpecies: "Cão", unitPrice: 100, quantity: 2 },
      ];

      // Quando o método for PIX: subtotal 200, desconto 20
      const pixSummary = strategy.calculate(orderItems, 15, { paymentMethod: "PIX" });
      expect(pixSummary.subtotal).toBe(200);
      expect(pixSummary.discountAmount).toBe(20);
      expect(pixSummary.finalAmount).toBe(195);
      expect(pixSummary.discounts).toHaveLength(1);
      expect(pixSummary.discounts![0].source).toBe("PAYMENT_METHOD");

      // Quando for Cartão: sem desconto
      const cardSummary = strategy.calculate(orderItems, 15, { paymentMethod: "CREDIT_CARD" });
      expect(cardSummary.discountAmount).toBe(0);
      expect(cardSummary.finalAmount).toBe(215);
      expect(cardSummary.discounts).toHaveLength(0);
    });

    test("deve combinar múltiplas estratégias via CompositePricingStrategy com breakdown detalhado", () => {
      const promoItem: OrderItem = {
        id: "P1",
        name: "Ração Chinchila",
        targetSpecies: "Chinchila",
        unitPrice: 50,
        quantity: 4, // 200 subtotal
        hasDiscount: true,
        discount: { type: "PERCENTAGE", value: 10 }, // 10% item = 20
      };

      // 1. Desconto por item (10% = 20)
      const itemStrategy = new ItemDiscountPricingStrategy();
      // 2. Desconto por método PIX (5% = 10)
      const pixStrategy = new PaymentMethodDiscountStrategy("PIX", 0.05);

      const composite = new CompositePricingStrategy([itemStrategy, pixStrategy]);
      const summary = composite.calculate([promoItem], 20, { paymentMethod: "PIX" });

      expect(summary.subtotal).toBe(200);
      expect(summary.discountAmount).toBe(30); // 20 item + 10 PIX
      expect(summary.shippingCost).toBe(20);
      expect(summary.finalAmount).toBe(190); // 200 - 30 + 20
      expect(summary.discounts).toHaveLength(2);
      expect(summary.discounts![0].source).toBe("ITEM");
      expect(summary.discounts![1].source).toBe("PAYMENT_METHOD");
    });

    test("deve executar PricingStep dentro da esteira e registrar auditoria do breakdown", async () => {
      const composite = new CompositePricingStrategy([
        new ItemDiscountPricingStrategy(),
        new PaymentMethodDiscountStrategy("PIX", 0.05),
      ]);

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new PricingStep(composite, 25))
        .addStep(new PaymentSimulatorStep())
        .build();

      const ctx: OrderContext = {
        orderId: "PED-PRICING-STEP",
        customerId: "CUST-01",
        items: [
          {
            id: "PROD-1",
            name: "Gaiola Hamster",
            targetSpecies: "Hamster",
            unitPrice: 100,
            quantity: 1,
            hasDiscount: true,
            discount: { type: "FIXED", value: 15 },
          },
        ],
        metadata: {
          paymentMethod: "PIX",
        },
      };

      await pipeline.process(ctx);

      // Subtotal 100, Desconto Item: 15, Desconto PIX 5%: 5 = 20 total. Frete: 25. Final: 105
      expect(ctx.pricing?.subtotal).toBe(100);
      expect(ctx.pricing?.discountAmount).toBe(20);
      expect(ctx.pricing?.finalAmount).toBe(105);
      expect(ctx.paymentStatus).toBe("AUTHORIZED");
      expect(ctx.metadata.pricingBreakdown).toHaveLength(2);
    });
  });
});