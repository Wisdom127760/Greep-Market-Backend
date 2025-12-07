import { Product, IProduct } from '../models/Product';
import { Expense, IExpense } from '../models/Expense';
import { logger } from '../utils/logger';

export interface PriceChangeSuggestion {
  hasPriceChange: boolean;
  product?: IProduct;
  currentCostPrice?: number;
  newCostPrice: number;
  currentSellingPrice?: number;
  suggestedSellingPrice?: number;
  markupPercentage?: number;
  priceChangePercentage?: number;
  message: string;
}

export interface ExpenseProductMatch {
  product: IProduct;
  matched: boolean;
  matchType: 'id' | 'name' | 'none';
}

export class PriceMonitoringService {
  /**
   * Find matching product for an expense
   * Tries to match by product_id first, then by product_name
   */
  static async findMatchingProduct(
    expense: { product_id?: string; product_name: string; store_id: string }
  ): Promise<ExpenseProductMatch | null> {
    try {
      let product: IProduct | null = null;
      let matchType: 'id' | 'name' | 'none' = 'none';

      // First, try to match by product_id if provided
      if (expense.product_id) {
        product = await Product.findOne({
          _id: expense.product_id,
          store_id: expense.store_id,
          is_active: true,
        });
        if (product) {
          matchType = 'id';
          return { product, matched: true, matchType };
        }
      }

      // If no match by ID, try to match by product name (case-insensitive)
      if (!product && expense.product_name) {
        product = await Product.findOne({
          name: { $regex: new RegExp(`^${expense.product_name.trim()}$`, 'i') },
          store_id: expense.store_id,
          is_active: true,
        });
        if (product) {
          matchType = 'name';
          return { product, matched: true, matchType };
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding matching product:', error);
      return null;
    }
  }

  /**
   * Check if there's a price change and calculate suggested selling price
   */
  static async checkPriceChange(
    expense: {
      product_id?: string;
      product_name: string;
      store_id: string;
      amount: number;
      quantity: number;
    }
  ): Promise<PriceChangeSuggestion> {
    try {
      const costPerUnit = expense.quantity > 0 ? expense.amount / expense.quantity : 0;

      if (costPerUnit <= 0) {
        return {
          hasPriceChange: false,
          newCostPrice: costPerUnit,
          message: 'Invalid cost per unit calculated from expense',
        };
      }

      // Find matching product
      const match = await this.findMatchingProduct(expense);

      if (!match || !match.matched) {
        return {
          hasPriceChange: false,
          newCostPrice: costPerUnit,
          message: `No matching product found for "${expense.product_name}". Price monitoring only works for existing products.`,
        };
      }

      const product = match.product;
      const currentCostPrice = product.cost_price || 0;

      // If product doesn't have a cost_price set yet, suggest setting it
      if (!product.cost_price || currentCostPrice === 0) {
        const markupPercentage = product.markup_percentage || 0;
        const suggestedSellingPrice = markupPercentage > 0
          ? costPerUnit * (1 + markupPercentage / 100)
          : product.price; // Use current price if no markup set

        return {
          hasPriceChange: true,
          product,
          currentCostPrice: 0,
          newCostPrice: costPerUnit,
          currentSellingPrice: product.price,
          suggestedSellingPrice,
          markupPercentage,
          message: `Product "${product.name}" doesn't have a cost price set. The new cost price is ${costPerUnit.toFixed(2)}.`,
        };
      }

      // Check if there's a significant price change (more than 1% difference)
      const priceDifference = Math.abs(costPerUnit - currentCostPrice);
      const priceChangePercentage = (priceDifference / currentCostPrice) * 100;
      const threshold = 1; // 1% threshold

      if (priceChangePercentage < threshold) {
        return {
          hasPriceChange: false,
          product,
          currentCostPrice,
          newCostPrice: costPerUnit,
          currentSellingPrice: product.price,
          priceChangePercentage,
          message: `Cost price change is minimal (${priceChangePercentage.toFixed(2)}%). No update needed.`,
        };
      }

      // Calculate suggested selling price based on markup percentage
      let suggestedSellingPrice: number | undefined;
      let markupPercentage = product.markup_percentage;

      if (markupPercentage && markupPercentage > 0) {
        suggestedSellingPrice = costPerUnit * (1 + markupPercentage / 100);
      } else {
        // If no markup is set, calculate it from current price and cost
        if (currentCostPrice > 0) {
          markupPercentage = ((product.price - currentCostPrice) / currentCostPrice) * 100;
          suggestedSellingPrice = costPerUnit * (1 + markupPercentage / 100);
        } else {
          suggestedSellingPrice = product.price; // Keep current price if can't calculate markup
        }
      }

      const isPriceIncrease = costPerUnit > currentCostPrice;
      const changeDirection = isPriceIncrease ? 'increased' : 'decreased';
      const priceChangeText = `${priceChangePercentage.toFixed(2)}% ${changeDirection}`;

      return {
        hasPriceChange: true,
        product,
        currentCostPrice,
        newCostPrice: costPerUnit,
        currentSellingPrice: product.price,
        suggestedSellingPrice,
        markupPercentage,
        priceChangePercentage,
        message: `Cost price for "${product.name}" has ${changeDirection} from ${currentCostPrice.toFixed(2)} to ${costPerUnit.toFixed(2)} (${priceChangeText}). With ${markupPercentage?.toFixed(2) || 'current'}% markup, suggested selling price is ${suggestedSellingPrice?.toFixed(2)}.`,
      };
    } catch (error) {
      logger.error('Error checking price change:', error);
      return {
        hasPriceChange: false,
        newCostPrice: expense.quantity > 0 ? expense.amount / expense.quantity : 0,
        message: 'Error checking price change. Please try again.',
      };
    }
  }

  /**
   * Update product cost price and optionally selling price
   */
  static async updateProductPricing(
    productId: string,
    newCostPrice: number,
    updateSellingPrice: boolean = false,
    suggestedSellingPrice?: number,
    changedBy?: string
  ): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw new Error('Product not found');
      }

      const updateData: any = {
        cost_price: newCostPrice,
      };

      // Update selling price if requested
      if (updateSellingPrice && suggestedSellingPrice) {
        updateData.price = suggestedSellingPrice;
        
        // Log price history if ProductPriceHistory model exists
        try {
          const { ProductPriceHistory } = await import('../models/ProductPriceHistory');
          await ProductPriceHistory.create({
            product_id: productId,
            store_id: product.store_id,
            old_price: product.price,
            new_price: suggestedSellingPrice,
            change_reason: `Automatic price update due to cost price change. New cost: ${newCostPrice.toFixed(2)}`,
            changed_by: changedBy || 'system',
          });
        } catch (historyError) {
          logger.warn('Could not log price history:', historyError);
          // Continue even if history logging fails
        }
      }

      const updatedProduct = await Product.findByIdAndUpdate(
        productId,
        updateData,
        { new: true }
      );

      if (!updatedProduct) {
        throw new Error('Failed to update product');
      }

      logger.info(`Product pricing updated for ${product.sku}: cost=${newCostPrice}, price=${updateData.price || 'unchanged'}`);
      return updatedProduct;
    } catch (error) {
      logger.error('Error updating product pricing:', error);
      throw error;
    }
  }

  /**
   * Get the latest expense for a product to track price trends
   */
  static async getLatestExpenseForProduct(
    productId: string,
    storeId: string
  ): Promise<IExpense | null> {
    try {
      const expense = await Expense.findOne({
        product_id: productId,
        store_id: storeId,
      })
        .sort({ date: -1, created_at: -1 })
        .limit(1);

      return expense;
    } catch (error) {
      logger.error('Error getting latest expense for product:', error);
      return null;
    }
  }
}


