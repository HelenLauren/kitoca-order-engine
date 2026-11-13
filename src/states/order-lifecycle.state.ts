import { OrderContext } from "../contracts/pipeline.contract";

export type OrderStateName =
  | "CREATED"
  | "STOCK_CONFIRMED"
  | "PAID"
  | "SHIPPED"
  | "CANCELLED";

/**
 * Estado do ciclo de vida de um pedido.
 */
export interface OrderLifecycleState {
  readonly name: OrderStateName;
  confirmStock(order: StatefulOrder): void;
  authorizePayment(order: StatefulOrder): void;
  shipOrder(order: StatefulOrder, trackingCode: string): void;
  cancelOrder(order: StatefulOrder, reason: string): void;
}

/**
 * Pedido que delega comportamento para estados concretos.
 */
export class StatefulOrder {
  private currentState: OrderLifecycleState;
  private readonly transitionsLog: string[] = [];

  constructor(
    public readonly context: OrderContext,
    initialState?: OrderLifecycleState
  ) {
    this.currentState = initialState ?? new CreatedOrderState();
    this.context.metadata.lifecycleState = this.currentState.name;
    this.transitionsLog.push(this.currentState.name);
  }

  public get stateName(): OrderStateName {
    return this.currentState.name;
  }

  public get history(): readonly string[] {
    return [...this.transitionsLog];
  }

  public transitionTo(newState: OrderLifecycleState): void {
    this.currentState = newState;
    this.context.metadata.lifecycleState = newState.name;
    this.transitionsLog.push(newState.name);
  }

  public confirmStock(): void {
    this.currentState.confirmStock(this);
  }

  public authorizePayment(): void {
    this.currentState.authorizePayment(this);
  }

  public shipOrder(trackingCode: string): void {
    this.currentState.shipOrder(this, trackingCode);
  }

  public cancelOrder(reason: string): void {
    this.currentState.cancelOrder(this, reason);
  }
}

export class CreatedOrderState implements OrderLifecycleState {
  public readonly name: OrderStateName = "CREATED";

  public confirmStock(order: StatefulOrder): void {
    order.transitionTo(new StockConfirmedOrderState());
  }

  public authorizePayment(_order: StatefulOrder): void {
    throw new Error(
      "[OrderState:CREATED] Não é permitido autorizar pagamento antes de confirmar o estoque."
    );
  }

  public shipOrder(_order: StatefulOrder, _trackingCode: string): void {
    throw new Error(
      "[OrderState:CREATED] Não é permitido despachar um pedido que ainda não teve estoque e pagamento confirmados."
    );
  }

  public cancelOrder(order: StatefulOrder, reason: string): void {
    order.context.metadata.cancellationReason = reason;
    order.transitionTo(new CancelledOrderState());
  }
}

export class StockConfirmedOrderState implements OrderLifecycleState {
  public readonly name: OrderStateName = "STOCK_CONFIRMED";

  public confirmStock(_order: StatefulOrder): void {
    throw new Error("[OrderState:STOCK_CONFIRMED] O estoque já foi confirmado.");
  }

  public authorizePayment(order: StatefulOrder): void {
    order.context.paymentStatus = "AUTHORIZED";
    order.transitionTo(new PaidOrderState());
  }

  public shipOrder(_order: StatefulOrder, _trackingCode: string): void {
    throw new Error(
      "[OrderState:STOCK_CONFIRMED] Não é permitido despachar o pedido antes da aprovação do pagamento."
    );
  }

  public cancelOrder(order: StatefulOrder, reason: string): void {
    order.context.metadata.cancellationReason = reason;
    order.transitionTo(new CancelledOrderState());
  }
}

export class PaidOrderState implements OrderLifecycleState {
  public readonly name: OrderStateName = "PAID";

  public confirmStock(_order: StatefulOrder): void {
    throw new Error("[OrderState:PAID] Estoque já confirmado em etapa anterior.");
  }

  public authorizePayment(_order: StatefulOrder): void {
    throw new Error("[OrderState:PAID] O pagamento deste pedido já está autorizado.");
  }

  public shipOrder(order: StatefulOrder, trackingCode: string): void {
    if (!trackingCode || !trackingCode.trim()) {
      throw new Error("[OrderState:PAID] Código de rastreio é obrigatório para envio.");
    }
    order.context.metadata.trackingCode = trackingCode.trim();
    order.transitionTo(new ShippedOrderState());
  }

  public cancelOrder(order: StatefulOrder, reason: string): void {
    order.context.metadata.cancellationReason = reason;
    order.context.metadata.refundRequired = true;
    order.transitionTo(new CancelledOrderState());
  }
}

export class ShippedOrderState implements OrderLifecycleState {
  public readonly name: OrderStateName = "SHIPPED";

  public confirmStock(_order: StatefulOrder): void {
    throw new Error("[OrderState:SHIPPED] Pedido já foi despachado.");
  }

  public authorizePayment(_order: StatefulOrder): void {
    throw new Error("[OrderState:SHIPPED] Pedido já foi pago e despachado.");
  }

  public shipOrder(_order: StatefulOrder, _trackingCode: string): void {
    throw new Error("[OrderState:SHIPPED] Pedido já se encontra em transporte.");
  }

  public cancelOrder(_order: StatefulOrder, _reason: string): void {
    throw new Error(
      "[OrderState:SHIPPED] Não é permitido cancelar um pedido de insumos exóticos já despachado."
    );
  }
}

export class CancelledOrderState implements OrderLifecycleState {
  public readonly name: OrderStateName = "CANCELLED";

  public confirmStock(_order: StatefulOrder): void {
    throw new Error("[OrderState:CANCELLED] Operação negada: o pedido está cancelado.");
  }

  public authorizePayment(_order: StatefulOrder): void {
    throw new Error("[OrderState:CANCELLED] Operação negada: o pedido está cancelado.");
  }

  public shipOrder(_order: StatefulOrder, _trackingCode: string): void {
    throw new Error("[OrderState:CANCELLED] Operação negada: o pedido está cancelado.");
  }

  public cancelOrder(_order: StatefulOrder, _reason: string): void {
    throw new Error("[OrderState:CANCELLED] O pedido já se encontra cancelado.");
  }
}