import { Wholesaler, IWholesaler } from '../models/Wholesaler';
import { Product } from '../models/Product';
import { logger } from '../utils/logger';
import { CustomError, validationError } from '../middleware/errorHandler';

export interface CreateWholesalerData {
  name: string;
  phone: string;
  email?: string;
  address: string;
  store_id: string;
  notes?: string;
  created_by: string;
}

export interface UpdateWholesalerData extends Partial<CreateWholesalerData> {
  is_active?: boolean;
}

export interface WholesalerWithProducts {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  store_id: string;
  notes?: string;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  products?: Array<{
    _id: string;
    name: string;
    sku: string;
    stock_quantity: number;
    min_stock_level: number;
    price: number;
    primary_image?: string;
    is_low_stock: boolean;
  }>;
  product_count?: number;
}

export class WholesalerService {
  /**
   * Create a new wholesaler
   */
  static async createWholesaler(wholesalerData: CreateWholesalerData): Promise<IWholesaler> {
    try {
      const wholesaler = new Wholesaler(wholesalerData);
      await wholesaler.save();

      logger.info(`Wholesaler created successfully: ${wholesaler.name}`);
      return wholesaler;
    } catch (error: any) {
      logger.error('Create wholesaler error:', error);
      if (error.code === 11000) {
        throw validationError('Wholesaler with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Get all wholesalers with optional filters
   */
  static async getWholesalers(filters: {
    store_id?: string;
    search?: string;
    is_active?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{
    wholesalers: IWholesaler[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const {
        store_id,
        search,
        is_active,
        sortBy = 'created_at',
        sortOrder = 'desc',
        page = 1,
        limit = 50,
      } = filters;

      const query: any = {};

      if (store_id) {
        query.store_id = store_id;
      }

      if (is_active !== undefined) {
        query.is_active = is_active;
      }

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
        ];
      }

      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const skip = (page - 1) * limit;

      const [wholesalers, total] = await Promise.all([
        Wholesaler.find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .lean(),
        Wholesaler.countDocuments(query),
      ]);

      return {
        wholesalers: wholesalers as unknown as IWholesaler[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Get wholesalers error:', error);
      throw error;
    }
  }

  /**
   * Get wholesaler by ID
   */
  static async getWholesalerById(id: string): Promise<IWholesaler | null> {
    try {
      const wholesaler = await Wholesaler.findById(id);
      return wholesaler;
    } catch (error) {
      logger.error('Get wholesaler by ID error:', error);
      throw error;
    }
  }

  /**
   * Get wholesaler with associated products
   */
  static async getWholesalerWithProducts(id: string, includeLowStock: boolean = false): Promise<WholesalerWithProducts | null> {
    try {
      const wholesaler = await Wholesaler.findById(id);
      if (!wholesaler) {
        return null;
      }

      const productQuery: any = { wholesaler_id: id.toString() };
      if (includeLowStock) {
        // Only get products that are low on stock
        productQuery.$expr = {
          $lte: ['$stock_quantity', '$min_stock_level']
        };
      }

      const products = await Product.find(productQuery)
        .select('name sku stock_quantity min_stock_level price images')
        .lean();

      const productsWithLowStock = products.map((product: any) => {
        const primaryImage = product.images?.find((img: any) => img.is_primary) || product.images?.[0];
        return {
          _id: product._id.toString(),
          name: product.name,
          sku: product.sku,
          stock_quantity: product.stock_quantity,
          min_stock_level: product.min_stock_level,
          price: product.price,
          primary_image: primaryImage?.url || primaryImage?.thumbnail_url,
          is_low_stock: product.stock_quantity <= product.min_stock_level,
        };
      });

      const wholesalerObj = wholesaler.toObject();
      return {
        ...wholesalerObj,
        _id: wholesalerObj._id.toString(),
        products: productsWithLowStock,
        product_count: productsWithLowStock.length,
      };
    } catch (error) {
      logger.error('Get wholesaler with products error:', error);
      throw error;
    }
  }

  /**
   * Update wholesaler
   */
  static async updateWholesaler(id: string, updateData: UpdateWholesalerData): Promise<IWholesaler | null> {
    try {
      const wholesaler = await Wholesaler.findByIdAndUpdate(
        id,
        { ...updateData, updated_at: new Date() },
        { new: true, runValidators: true }
      );

      if (!wholesaler) {
        throw validationError('Wholesaler not found');
      }

      logger.info(`Wholesaler updated successfully: ${wholesaler.name}`);
      return wholesaler;
    } catch (error: any) {
      logger.error('Update wholesaler error:', error);
      if (error.code === 11000) {
        throw validationError('Wholesaler with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Delete wholesaler
   * Automatically unlinks all associated products instead of blocking deletion
   */
  static async deleteWholesaler(id: string): Promise<void> {
    try {
      const wholesaler = await Wholesaler.findById(id);
      if (!wholesaler) {
        throw validationError('Wholesaler not found');
      }

      // Unlink all products associated with this wholesaler
      const productCount = await Product.countDocuments({ wholesaler_id: id });
      if (productCount > 0) {
        const updateResult = await Product.updateMany(
          { wholesaler_id: id },
          { $unset: { wholesaler_id: '' } }
        );
        logger.info(
          `Unlinked ${updateResult.modifiedCount} product(s) from wholesaler ${wholesaler.name} before deletion`
        );
      }

      await Wholesaler.findByIdAndDelete(id);
      logger.info(`Wholesaler deleted successfully: ${wholesaler.name} (${productCount} products unlinked)`);
    } catch (error) {
      logger.error('Delete wholesaler error:', error);
      throw error;
    }
  }

  /**
   * Get low stock products for a wholesaler
   */
  static async getLowStockProducts(wholesalerId: string): Promise<Array<{
    _id: string;
    name: string;
    sku: string;
    stock_quantity: number;
    min_stock_level: number;
    price: number;
    primary_image?: string;
    stock_percentage: number;
  }>> {
    try {
      const products = await Product.find({
        wholesaler_id: wholesalerId,
        $expr: {
          $lte: ['$stock_quantity', '$min_stock_level']
        },
      })
        .select('name sku stock_quantity min_stock_level price images')
        .lean();

      return products.map((product: any) => {
        const primaryImage = product.images?.find((img: any) => img.is_primary) || product.images?.[0];
        const stockPercentage = product.min_stock_level > 0
          ? (product.stock_quantity / product.min_stock_level) * 100
          : 0;

        return {
          _id: product._id.toString(),
          name: product.name,
          sku: product.sku,
          stock_quantity: product.stock_quantity,
          min_stock_level: product.min_stock_level,
          price: product.price,
          primary_image: primaryImage?.url || primaryImage?.thumbnail_url,
          stock_percentage: Math.round(stockPercentage),
        };
      });
    } catch (error) {
      logger.error('Get low stock products error:', error);
      throw error;
    }
  }

  /**
   * Format wholesaler response
   */
  static formatWholesalerResponse(wholesaler: IWholesaler): any {
    return {
      _id: (wholesaler as any)._id?.toString() || '',
      name: wholesaler.name,
      phone: wholesaler.phone,
      email: wholesaler.email,
      address: wholesaler.address,
      store_id: wholesaler.store_id,
      notes: wholesaler.notes,
      is_active: wholesaler.is_active,
      created_by: wholesaler.created_by,
      created_at: wholesaler.created_at,
      updated_at: wholesaler.updated_at,
    };
  }
}

