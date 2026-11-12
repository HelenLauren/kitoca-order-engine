import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";

export interface ComplianceApprovalRecord {
  readonly validatorName: string;
  readonly approvedAt: Date;
}

/**
 * Validação de conformidade.
 */
export abstract class AbstractComplianceValidationTemplate implements OrderStep {
  public abstract readonly name: string;

  /**
   * Define a sequência de passos para qualquer checagem de conformidade.
   */
  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    if (!this.shouldValidate(context)) {
      await next();
      return;
    }

    const violations = await this.collectViolations(context);

    if (violations.length > 0) {
      this.handleViolations(context, violations);
    }

    this.onComplianceSuccess(context);
    await next();
  }

  /**
   * Define se a regra se aplica ao pedido atual.
   */
  protected shouldValidate(context: OrderContext): boolean {
    return context.items.length > 0;
  }

  /**
   * Subclasses devem implementar a coleta de violações.
   */
  protected abstract collectViolations(
    context: OrderContext
  ): Promise<string[]> | string[];

  /**
   * Falha padrão: interrompe a esteira com mensagem consolidada.
   */
  protected handleViolations(
    _context: OrderContext,
    violations: readonly string[]
  ): never {
    throw new Error(
      `[Compliance:${this.name}] Pedido reprovado: ${violations.join(" | ")}`
    );
  }

  /**
   * Sucesso padrão: registra o selo de aprovação regulatória nos metadados do pedido.
   */
  protected onComplianceSuccess(context: OrderContext): void {
    const existing = Array.isArray(context.metadata.complianceApprovals)
      ? (context.metadata.complianceApprovals as ComplianceApprovalRecord[])
      : [];

    context.metadata.complianceApprovals = [
      ...existing,
      {
        validatorName: this.name,
        approvedAt: new Date(),
      },
    ];
  }
}
