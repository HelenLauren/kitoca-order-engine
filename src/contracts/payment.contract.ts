export type PaymentMethod = "PIX" | "CREDIT_CARD" | "BOLETO";

export interface PaymentRequest {
  readonly orderId: string;
  readonly customerId: string;
  readonly amount: number;
  readonly method?: PaymentMethod;
  readonly metadata?: Record<string, unknown>;
}

export interface PaymentResult {
  readonly success: boolean;
  readonly status: "AUTHORIZED" | "DECLINED" | "PENDING";
  readonly transactionId: string;
  readonly authorizationCode?: string;
  readonly qrCodePix?: string;
  readonly errorMessage?: string;
  readonly paidAt?: Date;
}

export interface PaymentGateway {
  processPayment(request: PaymentRequest): Promise<PaymentResult>;
}