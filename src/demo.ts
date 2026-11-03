import {
  OrderPipelineBuilder,
  StockValidationStep,
  ApplyItemDiscountStep,
  CouponValidationStep,
  PaymentSimulatorStep,
  OrderObserver,
  OrderEvent,
  OrderContext,
  CouponLookupService,
} from "./index";

// 1. Observer com logs ricos e visuais para a apresentação
class ConsoleAuditObserver implements OrderObserver<any> {
  public update(event: OrderEvent<any>): void {
    const timestamp = event.timestamp.toLocaleTimeString("pt-BR");
    if (event.name === "pipeline:started") {
      console.log(`\n[\x1b[36m${timestamp}\x1b[0m] \x1b[34m[EVENTO]\x1b[0m Pedido iniciado: ${event.payload?.orderId}`);
    } else if (event.name === "pipeline:completed") {
      console.log(`[\x1b[36m${timestamp}\x1b[0m] \x1b[32m[EVENTO]\x1b[0m Pedido finalizado com sucesso! Status Pagamento: \x1b[32m${event.payload?.context?.paymentStatus}\x1b[0m`);
    } else if (event.name === "pipeline:failed") {
      console.log(`[\x1b[36m${timestamp}\x1b[0m] \x1b[31m[EVENTO]\x1b[0m Falha na esteira: ${event.payload?.error?.message}`);
    }
  }
}

// 2. Mock de Gateway de Estoque
const inventoryMock = {
  async getAvailableStock(productId: string): Promise<number> {
    const stockDatabase: Record<string, number> = {
      "PROD-CHINCHILA-PREMIUM": 15,
      "PROD-FURAO-PLAY": 8,
    };
    return stockDatabase[productId] ?? 0;
  },
};

// 3. Mock de Serviço de Cupons
const couponServiceMock: CouponLookupService = {
  async findCoupon(code: string) {
    const coupons: Record<string, any> = {
      BEMVINDO10: { code: "BEMVINDO10", type: "PERCENTAGE", value: 10 },
      FRETEGRATIS: { code: "FRETEGRATIS", type: "FREE_SHIPPING", value: 0 },
      KITOCA20: { code: "KITOCA20", type: "FIXED", value: 20, minOrderValue: 100 },
    };
    return coupons[code] ?? null;
  },
};

async function main() {
  console.log("================================================================================");
  console.log("   \x1b[35m@kitoca/order-engine\x1b[0m - Demonstração Prática de Arquitetura & GoF");
  console.log("   Padrões: Chain of Responsibility + Strategy + Builder + Observer");
  console.log("================================================================================");

  // Construção fluente da esteira via Builder
  const pipeline = OrderPipelineBuilder.create()
    .addStep(new StockValidationStep(inventoryMock))
    .addStep(new ApplyItemDiscountStep(/* freteBase = */ 25.0))
    .addStep(new CouponValidationStep(couponServiceMock))
    .addStep(new PaymentSimulatorStep())
    .on("pipeline:started", new ConsoleAuditObserver())
    .on("pipeline:completed", new ConsoleAuditObserver())
    .on("pipeline:failed", new ConsoleAuditObserver())
    .build();

  // Pedido com item em promoção + cupom promocional
  const order: OrderContext = {
    orderId: "PED-KITOCA-2026-001",
    customerId: "CLIENTE-RAFAEL-SENE",
    items: [
      {
        id: "PROD-CHINCHILA-PREMIUM",
        name: "Ração Super Premium Chinchila 1kg",
        targetSpecies: "Chinchila",
        unitPrice: 120.0,
        quantity: 2,
        hasDiscount: true,
        discount: { type: "PERCENTAGE", value: 10 }, // 10% no item
      },
      {
        id: "PROD-FURAO-PLAY",
        name: "Túnel Interativo para Furões",
        targetSpecies: "Furão",
        unitPrice: 80.0,
        quantity: 1,
      },
    ],
    metadata: {
      couponCode: "BEMVINDO10", // 10% adicional via cupom
    },
  };

  console.log("\n-> Processando pedido através da esteira...");
  const processedOrder = await pipeline.process(order);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("                      RESUMO DA TRANSAÇÃO");
  console.log("--------------------------------------------------------------------------------");
  console.log(` Pedido ID:             ${processedOrder.orderId}`);
  console.log(` Cliente:               ${processedOrder.customerId}`);
  console.log(` Status Pagamento:      \x1b[32m${processedOrder.paymentStatus}\x1b[0m`);
  console.log(` Subtotal Produtos:     R$ ${processedOrder.pricing?.subtotal.toFixed(2)}`);
  console.log(` Desconto Total:        -R$ ${processedOrder.pricing?.discountAmount.toFixed(2)}`);
  console.log(` Frete:                 R$ ${processedOrder.pricing?.shippingCost.toFixed(2)}`);
  console.log(` -----------------------------------------------------------------------------`);
  console.log(` VALOR FINAL PAGO:      \x1b[33mR$ ${processedOrder.pricing?.finalAmount.toFixed(2)}\x1b[0m`);
  console.log("--------------------------------------------------------------------------------\n");
}

main().catch(console.error);
