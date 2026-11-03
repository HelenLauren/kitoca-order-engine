# Guia do Desenvolvedor: Instalação, Propósito e Implementação (`@kitoca/order-engine`)

Este documento explica **por que** e **quando** utilizar a biblioteca `@kitoca/order-engine`, **como instalá-la** em qualquer projeto Node.js/TypeScript e **como implementá-la na prática** dentro de uma aplicação real.

---

## 1. Para que serve a biblioteca e qual problema ela resolve?

No desenvolvimento de um e-commerce (especialmente no nicho de **pets não convencionais/exóticos**), o fluxo de fechamento de pedido (*checkout*) costuma virar um bloco monolítico difícil de manter, misturando chamadas de banco de dados, cálculos de desconto, regras logísticas de animais/habitats, validação de cupom, cobrança no gateway de pagamento e disparo de e-mails/eventos.

A **`@kitoca/order-engine`** resolve isso fornecendo um **motor de pipeline transacional 100% desacoplado de HTTP, frameworks (Express, NestJS, Fastify) e ORMs (Prisma, TypeORM, Drizzle)**:

- **Padroniza o Checkout em Passos (`OrderStep`):** Cada etapa (estoque, cupom, preço, antifraude, pagamento) é uma peça isolada que pode ser adicionada, removida ou reordenada com `OrderPipelineBuilder`.
- **Evita Problemas Clássicos de Banco de Dados:** O `DatabaseInventoryGateway` já força a consulta de estoque em lote (evitando *N+1 queries*), desconta estoque reservado e suporta reserva atômica temporária (evitando venda duplicada do mesmo item).
- **Regras de Negócio para Pets Exóticos Prontas:** Suporte nativo a descontos progressivos por espécie (`ExoticPetBundleDiscountStrategy`), descontos por produto (`%` ou `R$`), desconto por método de pagamento (ex: PIX) e combinação de múltiplas regras (`CompositePricingStrategy`) com extrato auditável.
- **Pós-Venda Orientado a Eventos (`OrderObserver`):** Permite disparar nota fiscal, e-mail, webhook ou telemetria quando o pedido inicia (`pipeline:started`), conclui (`pipeline:completed`) ou falha (`pipeline:failed`), sem poluir a regra de pagamento.

---

## 2. Como Instalar a Biblioteca em Outro Projeto

Existem **3 maneiras** de instalar a `@kitoca/order-engine` no projeto consumidor:

### Opção A: Direto pelo GitHub (Recomendado sem precisar publicar no npm)
No terminal do seu projeto backend/API, execute:

```bash
npm install github:HelenLauren/kitoca-order-engine
```
*(Ou fixando uma branch/tag específica: `npm install github:HelenLauren/kitoca-order-engine#main`)*

> **Como funciona nos bastidores:** O script `"prepare": "npm run build"` configurado no `package.json` da biblioteca compila automaticamente o TypeScript (`dist/index.js` e `dist/index.d.ts`) assim que o `npm install` baixa o repositório.

---

### Opção B: Via Registro do NPM (Caso publicada no npmjs.com)
Se o pacote estiver publicado no registro oficial do NPM:

```bash
npm install @kitoca/order-engine
```

*(Para publicar uma nova versão a partir deste repositório, basta rodar `npm login` e `npm publish --access public`).*

---

### Opção C: Instalação Local (Para testar durante o desenvolvimento)
Se você está desenvolvendo a API do seu e-commerce na mesma máquina e quer testar alterações locais da biblioteca:

1. **Referenciando a pasta local diretamente:**
   ```bash
   npm install ../kitoca-order-engine
   ```
2. **Ou gerando um pacote `.tgz` isolado:**
   ```bash
   # Na pasta da biblioteca (kitoca-order-engine):
   npm run build && npm pack

   # Na pasta do projeto consumidor:
   npm install ../kitoca-order-engine/kitoca-order-engine-1.0.0.tgz
   ```

---

## 3. Como Implementar na Prática (Passo a Passo)

Abaixo está um roteiro completo de como um desenvolvedor integra a biblioteca em um backend real (ex: Node.js com Prisma e um gateway de pagamento como Stripe ou Mercado Pago).

### Passo 1: Conectar o Estoque ao seu Banco de Dados (`DatabaseInventoryGateway`)
Em vez de a biblioteca exigir um banco específico, você passa uma função que busca os produtos no seu banco de dados de uma só vez:

```typescript
// src/infra/kitoca-inventory.ts
import { DatabaseInventoryGateway } from "@kitoca/order-engine";
import { prisma } from "./prisma-client"; // Exemplo com Prisma ORM

export const inventoryGateway = new DatabaseInventoryGateway(
  // 1. Consulta única em lote (evita N+1 queries)
  async (productIds: string[]) => {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    return products.map((p) => ({
      id: p.id,
      stock: p.stockQuantity,
      reservedStock: p.reservedQuantity,
      allowBackorder: p.allowBackorder,
    }));
  },
  // 2. (Opcional) Reserva temporária atômica no banco durante o checkout
  async (reservation) => {
    const created = await prisma.stockReservation.create({
      data: {
        orderId: reservation.orderId,
        expiresAt: new Date(Date.now() + reservation.ttlMinutes * 60_000),
      },
    });
    return {
      success: true,
      reservationToken: created.id,
      reservedUntil: created.expiresAt,
    };
  }
);
```

---

### Passo 2: Conectar o Serviço de Cupons e o Gateway de Pagamento
Você implementa as interfaces simples `CouponLookupService` e `PaymentGateway`:

```typescript
// src/infra/kitoca-gateways.ts
import {
  CouponLookupService,
  PaymentGateway,
  PaymentRequest,
  PaymentResult,
} from "@kitoca/order-engine";

export const couponService: CouponLookupService = {
  async findCoupon(code: string) {
    // Pode vir do Redis ou Banco de Dados
    if (code === "CHINCHILA10") {
      return { code: "CHINCHILA10", type: "PERCENTAGE", value: 10, minOrderValue: 100 };
    }
    return null;
  },
};

export class MeuGatewayPagamento implements PaymentGateway {
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Aqui você chama a SDK do Mercado Pago / Stripe / Pagar.me
    return {
      success: true,
      status: "AUTHORIZED",
      transactionId: `TX-${Date.now()}`,
      authorizationCode: "AUTH-998877",
      paidAt: new Date(),
    };
  }
}
```

---

### Passo 3: Montar a Esteira de Checkout (`OrderPipelineBuilder`)
Agora o desenvolvedor combina as estratégias de preço, os passos de validação e os ouvintes de pós-venda em uma esteira reutilizável:

```typescript
// src/services/checkout.service.ts
import {
  OrderPipelineBuilder,
  StockValidationStep,
  PricingStep,
  CouponValidationStep,
  PaymentProcessingStep,
  CompositePricingStrategy,
  ExoticPetBundleDiscountStrategy,
  ItemDiscountPricingStrategy,
  PaymentMethodDiscountStrategy,
  OrderContext,
} from "@kitoca/order-engine";
import { inventoryGateway } from "../infra/kitoca-inventory";
import { couponService, MeuGatewayPagamento } from "../infra/kitoca-gateways";

// 1. Define as regras de precificação combinadas (Composite Pattern)
const pricingStrategy = new CompositePricingStrategy([
  new ItemDiscountPricingStrategy(), // Descontos individuais dos itens (% ou R$)
  new ExoticPetBundleDiscountStrategy("Chinchila", 3, 0.10), // 10% off comprando 3+ itens de Chinchila
  new PaymentMethodDiscountStrategy("PIX", 0.05), // +5% off no PIX
]);

// 2. Constrói a esteira de checkout (Builder + Chain of Responsibility + Observer)
const checkoutPipeline = OrderPipelineBuilder.create()
  .addStep(
    new StockValidationStep(inventoryGateway, {
      reserveOnValidation: true,
      reservationTtlMinutes: 15,
    })
  )
  .addStep(new PricingStep(pricingStrategy, /* frete padrão = */ 25.0))
  .addStep(new CouponValidationStep(couponService))
  .addStep(new PaymentProcessingStep(new MeuGatewayPagamento()))
  .on("pipeline:completed", {
    update: async (event) => {
      const pedido = event.payload as OrderContext;
      console.log(`[Pós-Venda] Pedido ${pedido.orderId} aprovado! Enviando e-mail e NF...`);
    },
  })
  .on("pipeline:failed", {
    update: async (event) => {
      console.error(`[Alerta] Falha no checkout:`, event.payload);
    },
  })
  .build();

// 3. Função chamada pelo Controller HTTP (Express/Fastify/NestJS) ou fila (RabbitMQ/SQS)
export async function finalizarPedido(dadosEntrada: OrderContext) {
  return await checkoutPipeline.process(dadosEntrada);
}
```

---

### Passo 4: Consumir no Controller ou Caso de Uso
No controller da sua API (ou em um worker/CLI), basta montar o `OrderContext` e chamar `finalizarPedido`:

```typescript
const resultado = await finalizarPedido({
  orderId: "PED-2026-001",
  customerId: "TUTOR-42",
  items: [
    {
      id: "PROD-10",
      name: "Ração Extrusada Chinchila",
      targetSpecies: "Chinchila",
      unitPrice: 60,
      quantity: 3, // Ativa o bundle de 3 unidades da espécie Chinchila
      hasDiscount: true,
      discount: { type: "FIXED", value: 5 }, // R$ 5 off por pacote
    },
  ],
  metadata: {
    paymentMethod: "PIX",
    couponCode: "CHINCHILA10",
    shippingCost: 20.0,
  },
});

console.log("Status do pagamento:", resultado.paymentStatus); // "AUTHORIZED"
console.log("Resumo financeiro:", resultado.pricing);
console.log("Auditoria de descontos:", resultado.metadata.pricingBreakdown);
console.log("Cupom aplicado:", resultado.metadata.appliedCoupon);
```

---

## 4. Criando Regras Próprias sem Alterar a Biblioteca (Extensibilidade OCP)

Se o desenvolvedor precisar de uma trava específica do negócio dele (por exemplo, **exigir número de registro do IBAMA** ao comprar acessórios para répteis silvestres), basta implementar a interface `OrderStep`:

```typescript
import { OrderStep, OrderContext, NextFunction } from "@kitoca/order-engine";

export class IbamaDocumentationStep implements OrderStep {
  public readonly name = "IbamaDocumentationStep";

  public async execute(context: OrderContext, next: NextFunction): Promise<void> {
    const requiresIbama = context.items.some((item) => item.targetSpecies === "Iguana");

    if (requiresIbama && !context.metadata.ibamaRegistrationNumber) {
      throw new Error(
        "[Compliance] Compras para Iguana exigem o número de registro IBAMA no cadastro."
      );
    }

    await next();
  }
}
```

E plugar na esteira com `.addStep(new IbamaDocumentationStep())`.

