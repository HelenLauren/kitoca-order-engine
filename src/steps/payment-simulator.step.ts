import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";
import {
  PaymentGateway,
  PaymentMethod,
  PaymentRequest,
  PaymentResult,
} from "../contracts/payment.contract";

export * from "../contracts/payment.contract";

export interface MockPaymentGatewayOptions {
  readonly shouldFail?: boolean;
  readonly failureMessage?: string;
  readonly defaultMethod?: PaymentMethod;
  readonly latencyMs?: number;
}

export class MockPaymentGateway implements PaymentGateway {
  constructor(private readonly options: MockPaymentGatewayOptions = {}) {}

  public async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (this.options.latencyMs && this.options.latencyMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.latencyMs)
      );
    }

    if (this.options.shouldFail) {
      return {
        success: false,
        status: "DECLINED",
        transactionId: `TX-FAIL-${Date.now()}`,
        errorMessage:
          this.options.failureMessage ||
          "[Gateway] Transação recusada pela instituição bancária.",
      };
    }

    const method =
      request.method || this.options.defaultMethod || "CREDIT_CARD";
    const transactionId = `TX-${Date.now()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    return {
      success: true,
      status: "AUTHORIZED",
      transactionId,
      authorizationCode: `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
      qrCodePix:
        method === "PIX"
          ? `00020126580014br.gov.bcb.pix0136${transactionId}520400005303986540${request.amount.toFixed(
              2
            )}5802BR5906KITOCA6009SAOPAULO62070503***6304`
          : undefined,
      paidAt: new Date(),
    };
  }
}

export class PaymentProcessingStep implements OrderStep {
  public readonly name = "PaymentProcessingStep";

  constructor(protected readonly gateway: PaymentGateway) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const amountToCharge =
      context.pricing?.finalAmount ??
      context.items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

    const method =
      (context.metadata.paymentMethod as PaymentMethod) || "CREDIT_CARD";

    const request: PaymentRequest = {
      orderId: context.orderId,
      customerId: context.customerId,
      amount: amountToCharge,
      method,
      metadata: context.metadata,
    };

    const result = await this.gateway.processPayment(request);

    // Registra auditoria da transação no contexto
    context.metadata.paymentTransaction = result;

    if (!result.success || result.status === "DECLINED") {
      context.paymentStatus = "DECLINED";
      throw new Error(
        result.errorMessage ||
          "[Gateway] Transação recusada pela instituição bancária."
      );
    }

    context.paymentStatus = result.status;
    await next();
  }
}

export class PaymentSimulatorStep extends PaymentProcessingStep {
  constructor(shouldSimulateFailure: boolean | PaymentGateway = false) {
    if (typeof shouldSimulateFailure === "boolean") {
      super(
        new MockPaymentGateway({
          shouldFail: shouldSimulateFailure,
          failureMessage:
            "[Gateway] Transação recusada pela instituição bancária.",
        })
      );
    } else {
      super(shouldSimulateFailure);
    }
  }
}
