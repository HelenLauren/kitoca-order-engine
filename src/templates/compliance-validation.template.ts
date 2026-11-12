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

/**
 * Validação de licença ambiental (IBAMA) para espécies silvestres/exóticas controladas.
 */
export class IbamaSpeciesComplianceStep extends AbstractComplianceValidationTemplate {
  public readonly name = "IbamaSpeciesComplianceStep";

  constructor(
    private readonly controlledSpecies: readonly string[] = [
      "Iguana",
      "Jiboia",
      "Papagaio",
      "Jabuti",
    ]
  ) {
    super();
  }

  protected override shouldValidate(context: OrderContext): boolean {
    const controlledSet = new Set(
      this.controlledSpecies.map((s) => s.toLowerCase())
    );
    return context.items.some((item) =>
      controlledSet.has(item.targetSpecies.toLowerCase())
    );
  }

  protected collectViolations(context: OrderContext): string[] {
    const violations: string[] = [];
    const license = context.metadata.ibamaLicense;

    if (typeof license !== "string" || license.trim().length < 5) {
      violations.push(
        "Número de registro/licença IBAMA ausente ou inválido para compra de insumos de espécies controladas."
      );
    }

    return violations;
  }
}

/**
 * Validação de transporte climatizado para cargas perecíveis/biológicas de répteis e anfíbios.
 */
export class ThermalLogisticsComplianceStep extends AbstractComplianceValidationTemplate {
  public readonly name = "ThermalLogisticsComplianceStep";

  constructor(private readonly maxSupportedItemsPerBox: number = 10) {
    super();
  }

  protected override shouldValidate(context: OrderContext): boolean {
    return Boolean(context.metadata.requiresThermalTransport);
  }

  protected collectViolations(context: OrderContext): string[] {
    const violations: string[] = [];
    const totalQuantity = context.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    if (totalQuantity > this.maxSupportedItemsPerBox) {
      violations.push(
        `Quantidade de itens (${totalQuantity}) excede o limite térmico por embalagem (${this.maxSupportedItemsPerBox}).`
      );
    }

    if (!context.metadata.thermalContainerConfirmed) {
      violations.push(
        "Confirmação de embalagem térmica (isopor/gel pack) não informada no pedido."
      );
    }

    return violations;
  }
}
