import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";

export class PaymentSimulatorStep implements OrderStep {
  public readonly name = "PaymentSimulatorStep";

  constructor(private readonly shouldSimulateFailure = false) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    if (this.shouldSimulateFailure) {
      context.paymentStatus = "DECLINED";
      throw new Error(
        `[Gateway] Transação recusada pela instituição bancária.`
      );
    }
    context.paymentStatus = "AUTHORIZED";
    await next();
  }
}
