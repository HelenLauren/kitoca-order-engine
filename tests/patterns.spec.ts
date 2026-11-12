import {
  OrderPipelineBuilder,
  OrderContext,
  OrderItem,
  OrderStep,
  NextFunction,
  TelemetryStepDecorator,
  RetryStepDecorator,
  PricingStrategyFactory,
  StandardPricingCreator,
  ExoticSpeciesBundleCreator,
  PromotionalCheckoutCreator,
  StatefulOrder,
  IbamaSpeciesComplianceStep,
  ThermalLogisticsComplianceStep,
} from "../src";

describe("Kitoca Order Engine - Novos Padrões GoF (Decorator, Factory Method, State, Template Method)", () => {
  const sampleItems: OrderItem[] = [
    {
      id: "P1",
      name: "Ração Extrusada Chinchila",
      targetSpecies: "Chinchila",
      unitPrice: 50,
      quantity: 3, // subtotal 150
      hasDiscount: true,
      discount: { type: "PERCENTAGE", value: 10 }, // 10% = 15
    },
  ];

  describe("1. Padrão Decorator (TelemetryStepDecorator & RetryStepDecorator)", () => {
    test("deve medir o tempo de execução de qualquer passo via TelemetryStepDecorator", async () => {
      const dummyStep: OrderStep = {
        name: "CustomValidationStep",
        execute: async (_ctx, next) => {
          await next();
        },
      };

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new TelemetryStepDecorator(dummyStep))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-DEC-01",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      await pipeline.process(ctx);

      const telemetry = ctx.metadata.stepTelemetry as any[];
      expect(telemetry).toBeDefined();
      expect(telemetry).toHaveLength(1);
      expect(telemetry[0].stepName).toBe("CustomValidationStep");
      expect(telemetry[0].success).toBe(true);
      expect(typeof telemetry[0].durationMs).toBe("number");
    });

    test("deve registrar falha na telemetria quando o passo decorado lançar erro", async () => {
      const failingStep: OrderStep = {
        name: "FailingStep",
        execute: async () => {
          throw new Error("Erro simulado no passo");
        },
      };

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new TelemetryStepDecorator(failingStep))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-DEC-FAIL",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow("Erro simulado no passo");
      const telemetry = ctx.metadata.stepTelemetry as any[];
      expect(telemetry[0].success).toBe(false);
    });

    test("deve reexecutar passo com falha transitória e ter sucesso usando RetryStepDecorator", async () => {
      let calls = 0;
      const flakyGatewayStep: OrderStep = {
        name: "FlakyGatewayStep",
        execute: async (ctx, next) => {
          calls++;
          if (calls < 3) {
            throw new Error("Timeout temporário de conexão");
          }
          ctx.paymentStatus = "AUTHORIZED";
          await next();
        },
      };

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new RetryStepDecorator(flakyGatewayStep, 3))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-RETRY-OK",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      await pipeline.process(ctx);

      expect(calls).toBe(3);
      expect(ctx.paymentStatus).toBe("AUTHORIZED");
      expect((ctx.metadata.stepRetries as any).FlakyGatewayStep).toBe(2);
    });

    test("deve lançar erro após esgotar maxRetries ou se maxRetries for negativo", async () => {
      expect(() => new RetryStepDecorator({ name: "S", execute: async () => {} }, -1)).toThrow(
        /não pode ser negativo/
      );

      const alwaysFailsStep: OrderStep = {
        name: "AlwaysFailsStep",
        execute: async (_ctx: OrderContext, _next: NextFunction) => {
          throw new Error("Serviço indisponível");
        },
      };

      const pipeline = OrderPipelineBuilder.create()
        .addStep(new RetryStepDecorator(alwaysFailsStep, 2))
        .build();

      const ctx: OrderContext = {
        orderId: "PED-RETRY-EXHAUSTED",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      await expect(pipeline.process(ctx)).rejects.toThrow("Serviço indisponível");
      expect((ctx.metadata.stepRetries as any).AlwaysFailsStep).toBe(2);
    });
  });

  describe("2. Padrão Factory Method (PricingStrategyCreator & PricingStrategyFactory)", () => {
    test("deve instanciar estratégias via Concrete Creators e calcular pedido", () => {
      const standardCreator = new StandardPricingCreator();
      const stdResult = standardCreator.calculateOrder(sampleItems, 20);
      expect(stdResult.subtotal).toBe(150);
      expect(stdResult.discountAmount).toBe(0);
      expect(stdResult.finalAmount).toBe(170);

      const exoticCreator = new ExoticSpeciesBundleCreator("Chinchila", 3, 0.1);
      const exoticResult = exoticCreator.calculateOrder(sampleItems, 20);
      expect(exoticResult.discountAmount).toBe(15);
      expect(exoticResult.finalAmount).toBe(155);

      const promoCreator = new PromotionalCheckoutCreator(0.05, {
        species: "Chinchila",
        minQuantity: 3,
        discountRatio: 0.1,
      });
      const promoResult = promoCreator.calculateOrder(sampleItems, 20, {
        paymentMethod: "PIX",
      });
      // Item discount (10% = 15) + PIX (5% = 7.5) + Species Bundle (10% = 15) = 37.5
      expect(promoResult.discountAmount).toBe(37.5);
      expect(promoResult.finalAmount).toBe(132.5);
    });

    test("deve criar estratégias dinamicamente via PricingStrategyFactory.create()", () => {
      const stdStrategy = PricingStrategyFactory.create({ type: "STANDARD" });
      expect(stdStrategy.calculate(sampleItems, 10).finalAmount).toBe(160);

      const bundleStrategy = PricingStrategyFactory.create({
        type: "EXOTIC_BUNDLE",
        targetSpecies: "Chinchila",
      });
      expect(bundleStrategy.calculate(sampleItems, 10).discountAmount).toBe(15);

      const comboStrategy = PricingStrategyFactory.create({
        type: "PROMOTIONAL_COMBO",
      });
      // Item discount (15) + PIX 5% (7.5) = 22.5
      expect(
        comboStrategy.calculate(sampleItems, 10, { paymentMethod: "PIX" })
          .discountAmount
      ).toBe(22.5);
    });
  });

  describe("3. Padrão State (StatefulOrder & OrderLifecycleState)", () => {
    test("deve transitar pelo fluxo completo válido: CREATED -> STOCK_CONFIRMED -> PAID -> SHIPPED", () => {
      const ctx: OrderContext = {
        orderId: "PED-STATE-01",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      const order = new StatefulOrder(ctx);
      expect(order.stateName).toBe("CREATED");

      order.confirmStock();
      expect(order.stateName).toBe("STOCK_CONFIRMED");

      order.authorizePayment();
      expect(order.stateName).toBe("PAID");
      expect(ctx.paymentStatus).toBe("AUTHORIZED");

      order.shipOrder("BR-TRACK-999");
      expect(order.stateName).toBe("SHIPPED");
      expect(ctx.metadata.trackingCode).toBe("BR-TRACK-999");
      expect(order.history).toEqual([
        "CREATED",
        "STOCK_CONFIRMED",
        "PAID",
        "SHIPPED",
      ]);
    });

    test("deve bloquear transições ilegais em cada estado e permitir cancelamento válido com estorno", () => {
      const ctx: OrderContext = {
        orderId: "PED-STATE-02",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };

      const order = new StatefulOrder(ctx);

      // Em CREATED não pode pagar nem enviar
      expect(() => order.authorizePayment()).toThrow(/antes de confirmar o estoque/);
      expect(() => order.shipOrder("TRK")).toThrow(/estoque e pagamento confirmados/);

      order.confirmStock();
      // Em STOCK_CONFIRMED não pode confirmar estoque de novo nem enviar sem pagar
      expect(() => order.confirmStock()).toThrow(/já foi confirmado/);
      expect(() => order.shipOrder("TRK")).toThrow(/antes da aprovação do pagamento/);

      order.authorizePayment();
      // Em PAID não pode pagar de novo nem enviar sem código de rastreio
      expect(() => order.confirmStock()).toThrow(/já confirmado/);
      expect(() => order.authorizePayment()).toThrow(/já está autorizado/);
      expect(() => order.shipOrder("   ")).toThrow(/Código de rastreio é obrigatório/);

      // Cancelar pedido já pago deve marcar refundRequired = true
      order.cancelOrder("Solicitação do cliente");
      expect(order.stateName).toBe("CANCELLED");
      expect(ctx.metadata.refundRequired).toBe(true);

      // Em CANCELLED todas as transições são bloqueadas
      expect(() => order.confirmStock()).toThrow(/pedido está cancelado/);
      expect(() => order.authorizePayment()).toThrow(/pedido está cancelado/);
      expect(() => order.shipOrder("TRK")).toThrow(/pedido está cancelado/);
      expect(() => order.cancelOrder("Novo motivo")).toThrow(/já se encontra cancelado/);
    });

    test("deve impedir qualquer alteração após o estado SHIPPED e permitir cancelar direto de CREATED ou STOCK_CONFIRMED", () => {
      const orderShipped = new StatefulOrder({
        orderId: "PED-SHIPPED",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      });
      orderShipped.confirmStock();
      orderShipped.authorizePayment();
      orderShipped.shipOrder("TRACK-123");

      expect(() => orderShipped.confirmStock()).toThrow(/já foi despachado/);
      expect(() => orderShipped.authorizePayment()).toThrow(/já foi pago e despachado/);
      expect(() => orderShipped.shipOrder("TRACK-456")).toThrow(/já se encontra em transporte/);
      expect(() => orderShipped.cancelOrder("Desistência")).toThrow(/já despachado/);

      const orderCreatedCancel = new StatefulOrder({
        orderId: "PED-CANCEL-1",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      });
      orderCreatedCancel.cancelOrder("Desistência inicial");
      expect(orderCreatedCancel.stateName).toBe("CANCELLED");

      const orderStockCancel = new StatefulOrder({
        orderId: "PED-CANCEL-2",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      });
      orderStockCancel.confirmStock();
      orderStockCancel.cancelOrder("Falha no cartão");
      expect(orderStockCancel.stateName).toBe("CANCELLED");
    });
  });

  describe("4. Padrão Template Method (AbstractComplianceValidationTemplate)", () => {
    test("deve validar licença do IBAMA apenas quando houver espécies controladas e aprovar quando regular", async () => {
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new IbamaSpeciesComplianceStep())
        .addStep(new ThermalLogisticsComplianceStep(5))
        .build();

      // 1. Espécie não controlada (Chinchila) e sem transporte térmico -> pula ambos os hooks
      const ctxUncontrolled: OrderContext = {
        orderId: "PED-TM-01",
        customerId: "C1",
        items: sampleItems,
        metadata: {},
      };
      await pipeline.process(ctxUncontrolled);
      expect(ctxUncontrolled.metadata.complianceApprovals).toBeUndefined();

      // 2. Espécie controlada (Iguana) COM licença IBAMA + transporte térmico confirmado
      const ctxControlledOk: OrderContext = {
        orderId: "PED-TM-02",
        customerId: "C1",
        items: [
          {
            id: "IG-1",
            name: "Lâmpada UVB Iguana",
            targetSpecies: "Iguana",
            unitPrice: 120,
            quantity: 2,
          },
        ],
        metadata: {
          ibamaLicense: "IBAMA-BR-2026-9988",
          requiresThermalTransport: true,
          thermalContainerConfirmed: true,
        },
      };
      await pipeline.process(ctxControlledOk);
      expect(ctxControlledOk.metadata.complianceApprovals).toHaveLength(2);
    });

    test("deve reprovar pedido quando faltar licença IBAMA ou violar regras de transporte térmico", async () => {
      const pipeline = OrderPipelineBuilder.create()
        .addStep(new IbamaSpeciesComplianceStep())
        .addStep(new ThermalLogisticsComplianceStep(3))
        .build();

      // Falta licença IBAMA para Jiboia
      const ctxNoIbama: OrderContext = {
        orderId: "PED-TM-ERR1",
        customerId: "C1",
        items: [
          {
            id: "JB-1",
            name: "Substrato Terrário Jiboia",
            targetSpecies: "Jiboia",
            unitPrice: 90,
            quantity: 1,
          },
        ],
        metadata: {},
      };
      await expect(pipeline.process(ctxNoIbama)).rejects.toThrow(
        /Número de registro\/licença IBAMA ausente/
      );

      // Excede limite térmico e sem confirmação de caixa térmica
      const ctxThermalFail: OrderContext = {
        orderId: "PED-TM-ERR2",
        customerId: "C1",
        items: [
          {
            id: "ANF-1",
            name: "Alimento Vivo Refrigerado",
            targetSpecies: "Axolote",
            unitPrice: 40,
            quantity: 5,
          },
        ],
        metadata: {
          requiresThermalTransport: true,
          thermalContainerConfirmed: false,
        },
      };
      await expect(pipeline.process(ctxThermalFail)).rejects.toThrow(
        /excede o limite térmico.*Confirmação de embalagem térmica/
      );
    });
  });
});

