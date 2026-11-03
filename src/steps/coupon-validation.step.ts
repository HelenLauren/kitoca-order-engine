import {
  NextFunction,
  OrderContext,
  OrderStep,
} from "../contracts/pipeline.contract";

export interface CouponRule {
  readonly code: string;
  readonly type: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
  readonly value: number;
  readonly minOrderValue?: number;
}

export interface CouponLookupService {
  findCoupon(code: string): Promise<CouponRule | null>;
}

export class CouponValidationStep implements OrderStep {
  public readonly name = "CouponValidationStep";

  constructor(private readonly couponService: CouponLookupService) {}

  public async execute(
    context: OrderContext,
    next: NextFunction
  ): Promise<void> {
    const rawCoupon = context.metadata.couponCode;
    if (!rawCoupon || typeof rawCoupon !== "string") {
      await next();
      return;
    }

    const couponCode = rawCoupon.trim().toUpperCase();
    const coupon = await this.couponService.findCoupon(couponCode);

    if (!coupon) {
      throw new Error(`[Cupom Inválido] O cupom '${couponCode}' não existe ou expirou.`);
    }

    const currentPricing = context.pricing ?? {
      subtotal: context.items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0),
      discountAmount: 0,
      shippingCost: typeof context.metadata.shippingCost === "number" ? context.metadata.shippingCost : 0,
      finalAmount: 0,
    };

    if (coupon.minOrderValue && currentPricing.subtotal < coupon.minOrderValue) {
      throw new Error(
        `[Cupom Inválido] O cupom '${couponCode}' exige valor mínimo de R$ ${coupon.minOrderValue.toFixed(2)}.`
      );
    }

    let couponDiscount = 0;
    let newShippingCost = currentPricing.shippingCost;

    if (coupon.type === "FREE_SHIPPING") {
      newShippingCost = 0;
      context.metadata.freeShippingApplied = true;
    } else if (coupon.type === "PERCENTAGE") {
      couponDiscount = (currentPricing.subtotal * coupon.value) / 100;
    } else if (coupon.type === "FIXED") {
      couponDiscount = Math.min(coupon.value, currentPricing.subtotal);
    }

    const totalDiscount = currentPricing.discountAmount + couponDiscount;
    const finalAmount = Math.max(0, currentPricing.subtotal - totalDiscount + newShippingCost);

    context.pricing = {
      subtotal: currentPricing.subtotal,
      discountAmount: totalDiscount,
      shippingCost: newShippingCost,
      finalAmount,
    };

    context.metadata.appliedCoupon = {
      code: coupon.code,
      type: coupon.type,
      discountGiven: couponDiscount,
    };

    await next();
  }
}
