import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";

export interface StepTelemetryRecord {
  readonly stepName: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly executedAt: Date;
}

/**
 * Padrão GoF: Decorator (Estrutural)
 * Classe base abstrata que envolve qualquer OrderStep permitindo adicionar
 * responsabilidades dinâmicas (telemetria, retry, auditoria) sem alterar o passo original.
 */
export abstract class OrderStepDecorator implements OrderStep {
  public get name(): string {
    return this.wrappedStep.name;
  }

  constructor(protected readonly wrappedStep: OrderStep) {}

  public abstract execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void>;
}

/**
 * Concrete Decorator 1: Mede o tempo de execução e status de um passo da esteira,
 * gravando métricas em `context.metadata.stepTelemetry`.
 */
export class TelemetryStepDecorator extends OrderStepDecorator {
  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const start = Date.now();
    let success = true;

    try {
      await this.wrappedStep.execute(context, next);
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const durationMs = Date.now() - start;
      const existing = Array.isArray(context.metadata.stepTelemetry)
        ? (context.metadata.stepTelemetry as StepTelemetryRecord[])
        : [];

      const record: StepTelemetryRecord = {
        stepName: this.wrappedStep.name,
        durationMs,
        success,
        executedAt: new Date(),
      };

      context.metadata.stepTelemetry = [...existing, record];
    }
  }
}

/**
 * Concrete Decorator 2: Reexecuta automaticamente um passo em caso de falha transitória
 * (ex: instabilidade momentânea no gateway de pagamento ou banco de estoque) até `maxRetries`.
 */
export class RetryStepDecorator extends OrderStepDecorator {
  constructor(
    wrappedStep: OrderStep,
    private readonly maxRetries: number = 2
  ) {
    super(wrappedStep);
    if (maxRetries < 0) {
      throw new Error("[RetryStepDecorator] O número de tentativas não pode ser negativo.");
    }
  }

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    let attempts = 0;
    let downstreamCalled = false;

    const trackedNext: NextFunction = async () => {
      downstreamCalled = true;
      await next();
    };

    while (true) {
      try {
        attempts++;
        await this.wrappedStep.execute(context, trackedNext);
        break;
      } catch (error) {
        // Se o erro ocorreu num passo seguinte (após next()) ou esgotou tentativas, propaga
        if (downstreamCalled || attempts > this.maxRetries) {
          this.recordRetries(context, attempts - 1);
          throw error;
        }
      }
    }

    this.recordRetries(context, attempts - 1);
  }

  private recordRetries(context: OrderContext, retriesUsed: number): void {
    const retriesMap =
      typeof context.metadata.stepRetries === "object" &&
      context.metadata.stepRetries !== null
        ? (context.metadata.stepRetries as Record<string, number>)
        : {};

    context.metadata.stepRetries = {
      ...retriesMap,
      [this.wrappedStep.name]: retriesUsed,
    };
  }
}

