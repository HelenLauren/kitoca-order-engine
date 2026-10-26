import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";

export interface StockInventoryGateway {
  getAvailableStock(productId: string): Promise<number>;
}

export class StockValidationStep implements OrderStep {
  public readonly name = "StockValidationStep";

  constructor(private readonly inventoryService: StockInventoryGateway) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    for (const item of context.items) {
      const stock = await this.inventoryService.getAvailableStock(item.id);
      if (stock < item.quantity) {
        throw new Error(
          `[Estoque Insuficiente] O item '${item.name}' possui apenas ${stock} un.`
        );
      }
    }
    await next();
  }
}
