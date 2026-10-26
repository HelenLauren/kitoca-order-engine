import { OrderStep } from "../contracts/pipeline.contract";
import { OrderObserver } from "../contracts/observer.contract";
import { OrderPipeline } from "./pipeline";
import { OrderEventBus } from "./event-bus";

export class OrderPipelineBuilder {
  private steps: OrderStep[] = [];
  private eventBus = new OrderEventBus();

  public static create(): OrderPipelineBuilder {
    return new OrderPipelineBuilder();
  }

  public addStep(step: OrderStep): this {
    if (!step || typeof step.execute !== "function") {
      throw new Error(`[OrderPipelineBuilder] Passo inválido informado.`);
    }
    this.steps.push(step);
    return this;
  }

  public on(eventName: string, observer: OrderObserver): this {
    this.eventBus.subscribe(eventName, observer);
    return this;
  }

  public build(): OrderPipeline {
    if (this.steps.length === 0) {
      throw new Error(
        "[OrderPipelineBuilder] A esteira deve conter ao menos um passo."
      );
    }
    return new OrderPipeline(Object.freeze([...this.steps]), this.eventBus);
  }
}
