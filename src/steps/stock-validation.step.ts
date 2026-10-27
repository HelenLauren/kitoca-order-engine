import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";
import { OrderItem } from "../contracts/strategy.contract";

export interface StockItemReport {
  readonly productId: string;
  readonly productName: string;
  readonly requestedQuantity: number;
  readonly availableQuantity: number;
  readonly reservedQuantity?: number;
  readonly hasSufficientStock: boolean;
  readonly allowBackorder?: boolean;
}

export interface StockValidationReport {
  readonly allAvailable: boolean;
  readonly items: readonly StockItemReport[];
  readonly outOfStockItems: readonly StockItemReport[];
  readonly reservationToken?: string;
}

export interface StockReservationRequest {
  readonly orderId: string;
  readonly items: readonly OrderItem[];
  readonly ttlMinutes?: number;
}

export interface StockReservationResult {
  readonly success: boolean;
  readonly reservationToken?: string;
  readonly reservedUntil?: Date;
  readonly errorMessage?: string;
}

export interface StockInventoryGateway {
  getAvailableStock(productId: string): Promise<number>;
  checkStockBatch?(
    items: readonly OrderItem[]
  ): Promise<StockValidationReport | readonly StockItemReport[]>;
  reserveStock?(
    request: StockReservationRequest
  ): Promise<StockReservationResult>;
}

export interface StockValidationOptions {
  readonly reserveOnValidation?: boolean;
  readonly reservationTtlMinutes?: number;
  readonly allowBackorders?: boolean;
}

export type DatabaseStockQueryFn = (
  productIds: string[]
) => Promise<Array<{ id: string; stock: number; allowBackorder?: boolean; reservedStock?: number }>>;

export class DatabaseInventoryGateway implements StockInventoryGateway {
  constructor(
    private readonly queryFn: DatabaseStockQueryFn,
    private readonly reserveFn?: (
      request: StockReservationRequest
    ) => Promise<StockReservationResult>
  ) {}

  public async getAvailableStock(productId: string): Promise<number> {
    const results = await this.queryFn([productId]);
    const record = results[0];
    if (!record) return 0;
    const reserved = record.reservedStock ?? 0;
    return Math.max(0, record.stock - reserved);
  }

  public async checkStockBatch(
    items: readonly OrderItem[]
  ): Promise<readonly StockItemReport[]> {
    const ids = items.map((i) => i.id);
    const dbRecords = await this.queryFn(ids);
    const dbMap = new Map(dbRecords.map((r) => [r.id, r]));

    return items.map((it) => {
      const record = dbMap.get(it.id);
      const totalStock = record?.stock ?? 0;
      const reserved = record?.reservedStock ?? 0;
      const effectiveStock = Math.max(0, totalStock - reserved);
      const allowBackorder = record?.allowBackorder ?? false;
      const hasSufficientStock =
        effectiveStock >= it.quantity || allowBackorder;

      return {
        productId: it.id,
        productName: it.name,
        requestedQuantity: it.quantity,
        availableQuantity: effectiveStock,
        reservedQuantity: reserved,
        hasSufficientStock,
        allowBackorder,
      };
    });
  }

  public async reserveStock(
    request: StockReservationRequest
  ): Promise<StockReservationResult> {
    if (this.reserveFn) {
      return await this.reserveFn(request);
    }
    return { success: true };
  }
}

export class StockValidationStep implements OrderStep {
  public readonly name = "StockValidationStep";

  constructor(
    private readonly inventoryService: StockInventoryGateway,
    private readonly options: StockValidationOptions = {}
  ) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const reports: StockItemReport[] = [];

    if (typeof this.inventoryService.checkStockBatch === "function") {
      const batchResult = await this.inventoryService.checkStockBatch(
        context.items
      );
      if (Array.isArray(batchResult)) {
        reports.push(...batchResult);
      } else if (batchResult && "items" in batchResult) {
        reports.push(...batchResult.items);
      }

    } else {
      for (const item of context.items) {
        const available = await this.inventoryService.getAvailableStock(item.id);
        reports.push({
          productId: item.id,
          productName: item.name,
          requestedQuantity: item.quantity,
          availableQuantity: available,
          hasSufficientStock: available >= item.quantity,
          allowBackorder: false,
        });
      }
    }

    const outOfStock = reports.filter(
      (r) =>
        !r.hasSufficientStock &&
        !(this.options.allowBackorders && r.allowBackorder)
    );

    if (outOfStock.length > 0) {
      if (outOfStock.length === 1) {
        const item = outOfStock[0];
        throw new Error(
          `[Estoque Insuficiente] O item '${item.productName}' possui apenas ${item.availableQuantity} un.`
        );
      }
      const itemDetails = outOfStock
        .map(
          (it) =>
            `'${it.productName}' (possui ${it.availableQuantity}, precisa de ${it.requestedQuantity} un.)`
        )
        .join("; ");
      throw new Error(
        `[Estoque Insuficiente] Itens sem estoque suficiente: ${itemDetails}.`
      );
    }

    let reservationToken: string | undefined;
    if (
      this.options.reserveOnValidation &&
      typeof this.inventoryService.reserveStock === "function"
    ) {
      const reserveResult = await this.inventoryService.reserveStock({
        orderId: context.orderId,
        items: context.items,
        ttlMinutes: this.options.reservationTtlMinutes ?? 15,
      });

      if (!reserveResult.success) {
        throw new Error(
          reserveResult.errorMessage ||
            `[Estoque Insuficiente] Não foi possível reservar o estoque para o pedido '${context.orderId}'.`
        );
      }
      reservationToken = reserveResult.reservationToken;
    }

    const validationSummary: StockValidationReport = {
      allAvailable: true,
      items: reports,
      outOfStockItems: [],
      reservationToken,
    };

    context.metadata.stockValidationReport = validationSummary;
    if (reservationToken) {
      context.metadata.stockReservationToken = reservationToken;
    }

    await next();
  }
}