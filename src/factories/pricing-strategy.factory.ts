import {
  OrderCalculationSummary,
  OrderItem,
  PricingStrategy,
  PricingStrategyContext,
} from "../contracts/strategy.contract";
import { CompositePricingStrategy } from "../strategies/composite-pricing.strategy";
import { ExoticPetBundleDiscountStrategy } from "../strategies/exotic-pet-discount.strategy";
import { ItemDiscountPricingStrategy } from "../strategies/item-discount.strategy";
import { PaymentMethodDiscountStrategy } from "../strategies/payment-method-discount.strategy";
import { StandardPricingStrategy } from "../strategies/standard-pricing.strategy";

/**
 * Padrão GoF: Factory Method (Criacional)
 * Classe Criadora Abstrata que declara o método fábrica `createStrategy()`
 * e utiliza o produto criado para executar cálculos de pedido sem acoplar ao tipo concreto.
 */
export abstract class PricingStrategyCreator {
  public abstract createStrategy(): PricingStrategy;

  public calculateOrder(
    items: readonly OrderItem[],
    baseShipping: number,
    context?: PricingStrategyContext
  ): OrderCalculationSummary {
    const strategy = this.createStrategy();
    return strategy.calculate(items, baseShipping, context);
  }
}

/**
 * Concrete Creator 1: Cria estratégia de precificação padrão sem descontos promocionais.
 */
export class StandardPricingCreator extends PricingStrategyCreator {
  public createStrategy(): PricingStrategy {
    return new StandardPricingStrategy();
  }
}

/**
 * Concrete Creator 2: Cria estratégia voltada a combos de espécies exóticas (ex: Chinchila, Furão).
 */
export class ExoticSpeciesBundleCreator extends PricingStrategyCreator {
  constructor(
    private readonly targetSpecies: string,
    private readonly minQuantity: number = 3,
    private readonly discountPercentage: number = 0.1
  ) {
    super();
  }

  public createStrategy(): PricingStrategy {
    return new ExoticPetBundleDiscountStrategy(
      this.targetSpecies,
      this.minQuantity,
      this.discountPercentage
    );
  }
}

/**
 * Concrete Creator 3: Cria estratégia combinada (Item + PIX + Espécie opcional) para campanhas promocionais.
 */
export class PromotionalCheckoutCreator extends PricingStrategyCreator {
  constructor(
    private readonly pixDiscountRatio: number = 0.05,
    private readonly speciesPromo?: {
      readonly species: string;
      readonly minQuantity: number;
      readonly discountRatio: number;
    }
  ) {
    super();
  }

  public createStrategy(): PricingStrategy {
    const strategies: PricingStrategy[] = [
      new ItemDiscountPricingStrategy(),
      new PaymentMethodDiscountStrategy("PIX", this.pixDiscountRatio),
    ];

    if (this.speciesPromo) {
      strategies.push(
        new ExoticPetBundleDiscountStrategy(
          this.speciesPromo.species,
          this.speciesPromo.minQuantity,
          this.speciesPromo.discountRatio
        )
      );
    }

    return new CompositePricingStrategy(strategies);
  }
}

export type PricingPresetConfig =
  | { readonly type: "STANDARD" }
  | {
      readonly type: "EXOTIC_BUNDLE";
      readonly targetSpecies: string;
      readonly minQuantity?: number;
      readonly discountPercentage?: number;
    }
  | {
      readonly type: "PROMOTIONAL_COMBO";
      readonly pixDiscountRatio?: number;
      readonly speciesPromo?: {
        readonly species: string;
        readonly minQuantity: number;
        readonly discountRatio: number;
      };
    };

/**
 * Fábrica auxiliar parametrizada para instanciação rápida a partir de configurações declarativas.
 */
export class PricingStrategyFactory {
  public static createCreator(config: PricingPresetConfig): PricingStrategyCreator {
    switch (config.type) {
      case "STANDARD":
        return new StandardPricingCreator();
      case "EXOTIC_BUNDLE":
        return new ExoticSpeciesBundleCreator(
          config.targetSpecies,
          config.minQuantity ?? 3,
          config.discountPercentage ?? 0.1
        );
      case "PROMOTIONAL_COMBO":
        return new PromotionalCheckoutCreator(
          config.pixDiscountRatio ?? 0.05,
          config.speciesPromo
        );
    }
  }

  public static create(config: PricingPresetConfig): PricingStrategy {
    return this.createCreator(config).createStrategy();
  }
}
