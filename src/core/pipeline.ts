import { OrderContext, OrderStep } from "../contracts/pipeline.contract";
import { OrderEventBus } from "./event-bus";

export class OrderPipeline {
  constructor(
    private readonly steps: readonly OrderStep[],
    private readonly eventBus: OrderEventBus
  ) {}

  public async process(context: OrderContext): Promise<OrderContext> {
    await this.eventBus.publish("pipeline:started", { orderId: context.orderId });
    let index = 0;
    const runner = async (): Promise<void> => {
      if (index < this.steps.length) {
        const step = this.steps[index++];
        await step.execute(context, runner);
      }
    };

    try {
      await runner();
      await this.eventBus.publish("pipeline:completed", {
        orderId: context.orderId,
        context,
      });
      return context;
    } catch (error) {
      await this.eventBus.publish("pipeline:failed", {
        orderId: context.orderId,
        error,
      });
      throw error;
    }
  }
}
