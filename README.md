# @kitoca/order-engine
**Biblioteca Reutilizável de Pipeline Transacional, Precificação e Eventos**

> **Escopo:** Biblioteca de código puro em TypeScript (Node.js ≥ 18) para construção de pipelines de processamento e checkout. Desacopla o fluxo transacional de compras de um E-commerce sem vínculos com APIs ou servidores HTTP. Nesse repositório, o projeto Kitoca serve apenas como exemplo de aplicação da biblioteca.

---

## 1. Identificação do Projeto

- **Projeto:** Kitoca - Plataforma Integrada de E-commerce & Conteúdo de Pets Exóticos
- **Componente:** `@kitoca/order-engine` (Biblioteca de Checkout e Esteira de Pedidos)
- **Integrantes do Grupo:** Bruno Viccenzo Mazetto, Helen Lauren Bonato, Letícia Bastías Fabri, Rafael Sene
- **Link da Apresentação em Vídeo (YouTube):** Em andamento...

---

## 2. Visão Geral da Arquitetura & Padrões GoF

```
+---------------------------------------------------------------------------------------+
| OrderPipelineBuilder --creates--> OrderPipeline --uses--> OrderEventBus               |
|   - addStep(OrderStep)              - process(OrderContext) - subscribe()             |
|   - on(event, OrderObserver)                                - publish()               |
+---------------------------------------------------------------------------------------+
       |                                      |                     |
       v executa cadeia (Chain of Resp.)      v notifica (Observer) v
+------------------------------------+   +------------------------------------+
| <<interface>> OrderStep            |   | <<interface>> OrderObserver        |
+------------------------------------+   +------------------------------------+
| + execute(context, next): Promise  |   | + update(event): void | Promise    |
+------------------------------------+   +------------------------------------+
   ^               ^                        ^               ^
   |               |                        |               |
[StockValidation] [PaymentSimulator]    [AuditNotification] [Telemetria]

[PricingStrategy (Strategy Pattern)] <--- injetado no cálculo do contexto
```

### Padrões de Projeto Clássicos (GoF) Aplicados

1. **Chain of Responsibility:** Encadeia verificações de catálogo, validação de estoque e gateway de pagamento via `next()`, permitindo interromper ou injetar passos externamente.
2. **Strategy:** Isola algoritmos de precificação e descontos por espécie em contratos (`PricingStrategy`), permitindo alternância dinâmica em tempo de execução.
3. **Builder:** `OrderPipelineBuilder` provê interface fluente para compor passos e observadores, garantindo integridade antes de congelar a esteira.
4. **Observer:** `OrderEventBus` e `OrderObserver` notificam disparos de início, conclusão e falha de pedidos para auditoria e telemetria sem acoplamento.

---

## 3. Instalação & Build

```bash
# Instalação das dependências
npm install

# Build dos arquivos TypeScript (.js e .d.ts)
npm run build

# Execução da suíte de testes com Jest
npm test

# Execução dos testes com relatório de cobertura (Code Coverage)
npm run test:coverage

# Execução da demonstração prática interativa (Terminal)
npm run demo
```

---

## 4. Quick Start para Consumidores

```typescript
import {
  OrderPipelineBuilder,
  StockValidationStep,
  OrderContext,
} from "@kitoca/order-engine";

const inventoryAdapter = {
  getAvailableStock: async (productId: string) => 10,
};

const pipeline = OrderPipelineBuilder.create()
  .addStep(new StockValidationStep(inventoryAdapter))
  .build();

const pedido: OrderContext = {
  orderId: "PED-001",
  customerId: "CLI-10",
  items: [
    {
      id: "PROD-1",
      name: "Ração para Furão",
      targetSpecies: "Furão",
      unitPrice: 50,
      quantity: 2,
    },
  ],
  metadata: {},
};

const pedidoProcessado = await pipeline.process(pedido);
```

### Validação de Estoque Integrada ao Banco de Dados (Sem N+1 Queries)

Em cenários reais de e-commerce, a validação de estoque precisa consultar o banco de dados do projeto de forma eficiente (busca em lote via `IN`), considerar estoque já reservado e permitir reserva atômica para evitar compras simultâneas (furo de estoque).

A biblioteca fornece o [DatabaseInventoryGateway](file:///c:/Users/HelenLauren/develop/kitoca-order-engine/src/steps/stock-validation.step.ts#L61) para integração direta com qualquer ORM (Prisma, TypeORM, Drizzle, etc.):

```typescript
import {
  OrderPipelineBuilder,
  StockValidationStep,
  DatabaseInventoryGateway,
} from "@kitoca/order-engine";

// 1. Conexão direta com o banco de dados do seu projeto (ex: Prisma / Postgres)
const inventoryGateway = new DatabaseInventoryGateway(
  // Busca em lote no banco (SELECT ... WHERE id IN (...))
  async (productIds: string[]) => {
    return await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock: true, reservedStock: true, allowBackorder: true },
    });
  },
  // Reserva atômica opcional enquanto o pagamento é processado
  async (reservationReq) => {
    const token = await prisma.reservation.create({ data: reservationReq });
    return { success: true, reservationToken: token.id };
  }
);

// 2. Esteira com validação de estoque em lote e reserva temporária de 15 minutos
const pipeline = OrderPipelineBuilder.create()
  .addStep(
    new StockValidationStep(inventoryGateway, {
      reserveOnValidation: true,
      reservationTtlMinutes: 15,
      allowBackorders: false,
    })
  )
  .build();
```

---

### Validação e Aplicação de Desconto por Item Antes do Pagamento


A esteira suporta verificação de itens marcados com desconto (`hasDiscount: true`) com cálculo percentual (`%`) ou em valor fixo (`$`):

```typescript
import {
  OrderPipelineBuilder,
  StockValidationStep,
  ApplyItemDiscountStep,
  PaymentSimulatorStep,
  OrderContext,
} from "@kitoca/order-engine";

const pipeline = OrderPipelineBuilder.create()
  .addStep(new StockValidationStep(inventoryAdapter))
  // 1. Valida e aplica descontos antes do pagamento
  .addStep(new ApplyItemDiscountStep(/* freteBase = */ 15.0))
  // 2. Gateway processa o valor com desconto já deduzido
  .addStep(new PaymentSimulatorStep())
  .build();

const pedido: OrderContext = {
  orderId: "PED-PROMO-2026",
  customerId: "CLI-01",
  items: [
    {
      id: "P1",
      name: "Ração Premium Papagaio",
      targetSpecies: "Papagaio",
      unitPrice: 100,
      quantity: 2,
      hasDiscount: true,
      discount: { type: "PERCENTAGE", value: 15 }, // 15% de desconto
    },
    {
      id: "P2",
      name: "Brinquedo Roedor",
      targetSpecies: "Hamster",
      unitPrice: 50,
      quantity: 1,
      hasDiscount: true,
      discount: { type: "FIXED", value: 10 }, // R$ 10,00 de desconto
    },
  ],
  metadata: {},
};

const pedidoFinal = await pipeline.process(pedido);
// pedidoFinal.pricing.discountAmount => 40 (30 + 10)
// pedidoFinal.paymentStatus => "AUTHORIZED"
```

### Estratégias Compostas (GoF Composite Pattern) & Desconto por Meio de Pagamento

A biblioteca suporta o padrão **Composite (GoF)** para combinar múltiplas regras de precificação simultâneas (ex: desconto de produto + desconto por espécie + desconto de 5% no PIX) gerando um extrato detalhado (*breakdown*) dos descontos:

```typescript
import {
  OrderPipelineBuilder,
  StockValidationStep,
  CompositePricingStrategy,
  ItemDiscountPricingStrategy,
  PaymentMethodDiscountStrategy,
  PricingStep,
  PaymentProcessingStep,
  OrderContext,
} from "@kitoca/order-engine";

// 1. Combina a estratégia de produtos com a de desconto no PIX
const compositePricing = new CompositePricingStrategy([
  new ItemDiscountPricingStrategy(),
  new PaymentMethodDiscountStrategy("PIX", 0.05), // 5% de desconto no PIX
]);

// 2. Monta a esteira utilizando o PricingStep
const pipeline = OrderPipelineBuilder.create()
  .addStep(new StockValidationStep(inventoryAdapter))
  .addStep(new PricingStep(compositePricing, /* frete = */ 20.0))
  .addStep(new PaymentSimulatorStep())
  .build();

const pedido: OrderContext = {
  orderId: "PED-COMPOSITE-01",
  customerId: "CLI-99",
  items: [
    { id: "1", name: "Ração Chinchila", targetSpecies: "Chinchila", unitPrice: 100, quantity: 2, hasDiscount: true, discount: { type: "PERCENTAGE", value: 10 } }
  ],
  metadata: { paymentMethod: "PIX" },
};

const processado = await pipeline.process(pedido);
// processado.pricing.discountAmount => 29 (20 de desconto do item + 9 de desconto do PIX)
// processado.metadata.pricingBreakdown => Lista detalhada de cada desconto concedido!
```

---

### Arquitetura de Pagamentos Desacoplada (DIP & Gateways Reutilizáveis)


A biblioteca utiliza o Princípio da Inversão de Dependência (DIP) para pagamentos. Você pode usar o simulador integrado (com suporte a PIX, Cartão e Boleto) ou conectar qualquer gateway real (ex: Mercado Pago, Stripe, Pagar.me):

```typescript
import {
  OrderPipelineBuilder,
  PaymentProcessingStep,
  PaymentGateway,
  PaymentRequest,
  PaymentResult,
} from "@kitoca/order-engine";

// 1. Criando um adaptador de pagamento real (ex: Mercado Pago ou Stripe)
export class MercadoPagoGateway implements PaymentGateway {
  public async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Chamada externa à API do provedor financeiro
    return {
      success: true,
      status: "AUTHORIZED",
      transactionId: `MP-${Date.now()}`,
      authorizationCode: "AUTH-OK-987",
      paidAt: new Date(),
    };
  }
}

// 2. Conectando o gateway na esteira de checkout
const pipeline = OrderPipelineBuilder.create()
  .addStep(new PaymentProcessingStep(new MercadoPagoGateway()))
  .build();
```

---



## 5. Guia Passo-a-Passo de Extensão (Novos Plugins / Estratégias)

Qualquer desenvolvedor externo pode estender o comportamento do ecossistema Kitoca sem alterar o núcleo da biblioteca (respeitando o Princípio Aberto/Fechado - OCP):

### Criando um Novo `OrderStep` Customizado:

```typescript
import { OrderStep, OrderContext, NextFunction } from "@kitoca/order-engine";

export class AntiFraudCheckStep implements OrderStep {
  public readonly name = "AntiFraudCheckStep";

  public async execute(ctx: OrderContext, next: NextFunction): Promise<void> {
    if (ctx.pricing && ctx.pricing.finalAmount > 5000) {
      ctx.metadata.requiresManualReview = true;
    }
    // Sempre invoque next() para prosseguir na esteira
    await next();
  }
}
```

### Criando uma Nova `PricingStrategy` Customizada:

```typescript
import {
  PricingStrategy,
  OrderItem,
  OrderCalculationSummary,
} from "@kitoca/order-engine";

export class VipTutorPricingStrategy implements PricingStrategy {
  public calculate(
    items: readonly OrderItem[],
    baseShipping: number
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
```

---

## 6. Demonstração de Extensibilidade (Código Cliente Consumidor)

O cliente estende a biblioteca via Open/Closed Principle (OCP) criando um novo passo logístico e um listener de auditoria sem alterar arquivos da biblioteca:

```typescript
import {
  OrderPipelineBuilder,
  OrderStep,
  OrderContext,
  NextFunction,
  OrderObserver,
  OrderEvent,
  ExoticPetBundleDiscountStrategy,
  StockValidationStep,
} from "@kitoca/order-engine";

// 1. EXTENSÃO OCP: Passo customizado para checagem de acomodação volumosa de roedores
class HabitatLogisticsConstraintStep implements OrderStep {
  public readonly name = "HabitatLogisticsConstraintStep";

  public async execute(context: OrderContext, next: NextFunction): Promise<void> {
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
  public update(event: OrderEvent): void {
    console.log(`[AUDITORIA] Evento: ${event.name} em ${event.timestamp.toISOString()}`);
  }
}

// 3. Montagem Fluente no App do Kitoca
async function run() {
  const inventoryMock = { getAvailableStock: async () => 20 };
  const strategy = new ExoticPetBundleDiscountStrategy("Chinchila", 2, 0.15); // 15% off

  const pipeline = OrderPipelineBuilder.create()
    .addStep(new StockValidationStep(inventoryMock))
    .addStep(new HabitatLogisticsConstraintStep())
    .on("pipeline:completed", new AuditNotificationObserver())
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
  await pipeline.process(order);
}
```

---

## 7. Conformidade com os Princípios SOLID

| Princípio | Evidência Técnica na Biblioteca Kitoca |
| :--- | :--- |
| **SRP** *(Single Responsibility Principle)* | Classes especialistas: `StockValidationStep` só valida estoque; `OrderEventBus` só publica eventos; `StandardPricingStrategy` só calcula subtotal e frete. |
| **OCP** *(Open/Closed Principle)* | A esteira e o cálculo aceitam novos plugins via interfaces `OrderStep` e `PricingStrategy` sem modificar o core. |
| **LSP** *(Liskov Substitution Principle)* | Qualquer passo ou estratégia substitui o contrato base sem quebrar a execução de `OrderPipeline`. |
| **ISP** *(Interface Segregation Principle)* | Contratos segregados e mínimos: `OrderStep` possui apenas `execute`; `OrderObserver` apenas `update`. |
| **DIP** *(Dependency Inversion Principle)* | O motor depende exclusivamente de abstrações; dependências externas (como inventário) usam gateways abstratos. |
