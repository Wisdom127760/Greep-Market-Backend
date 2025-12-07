import { Product, IProduct } from '../models/Product';
import { ProductPriceHistory } from '../models/ProductPriceHistory';
import { CloudinaryService } from '../config/cloudinary';
import { logger } from '../utils/logger';
import { CustomError, validationError } from '../middleware/errorHandler';
import { cleanTagsForStorage } from '../utils/tagFormatter';
import multer from 'multer';

export interface CreateProductData {
  name: string;
  description: string;
  price: number;
  cost_price?: number;
  markup_percentage?: number;
  vat?: number;
  category: string;
  sku: string;
  barcode?: string;
  stock_quantity: number;
  min_stock_level?: number;
  unit?: string;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  tags?: string[];
  is_featured?: boolean;
  created_by: string;
  store_id: string;
  images?: Express.Multer.File[];
}

export interface UpdateProductData extends Partial<CreateProductData> {
  is_active?: boolean;
  priceChangeReason?: string;
  changedBy?: string;
}

export class ProductService {
  /**
   * Create a new product
   */
  static async createProduct(productData: CreateProductData): Promise<IProduct> {
    try {
      // Check if SKU already exists and generate a unique one if needed
      let finalSku = productData.sku;
      let counter = 1;
      while (await Product.findOne({ sku: finalSku })) {
        finalSku = `${productData.sku}-${counter}`;
        counter++;
      }
      
      // Update the productData with the final unique SKU
      productData.sku = finalSku;

      // Check if barcode already exists (if provided)
      if (productData.barcode) {
        const existingBarcode = await Product.findOne({ barcode: productData.barcode });
        if (existingBarcode) {
          throw validationError('Product with this barcode already exists');
        }
      }

      // Process images if provided
      let processedImages: { url: string; public_id: string; is_primary: boolean; thumbnail_url?: string }[] = [];
      
      if (productData.images && productData.images.length > 0) {
        for (let i = 0; i < productData.images.length; i++) {
          const image = productData.images[i];
          try {
            // Upload to Cloudinary
            const uploadResult = await CloudinaryService.uploadImageFromBuffer(image.buffer);
            
            processedImages.push({
              url: uploadResult.secure_url,
              public_id: uploadResult.public_id,
              is_primary: i === 0, // First image is primary
            });
          } catch (uploadError) {
            logger.error('Failed to upload image:', uploadError);
            // Continue with other images even if one fails
          }
        }
      }

      // Remove images from productData before creating the product
      const { images, ...productDataWithoutImages } = productData;
      
      // Clean tags before saving
      const cleanedProductData = {
        ...productDataWithoutImages,
        tags: productDataWithoutImages.tags ? cleanTagsForStorage(productDataWithoutImages.tags) : [],
        images: processedImages,
      };
      
      const product = new Product(cleanedProductData);
      
      await product.save();

      logger.info(`Product created successfully: ${product.sku}`);
      return product;
    } catch (error) {
      logger.error('Create product error:', error);
      throw error;
    }
  }

  /**
   * Upload and add image to product
   */
  static async addProductImage(
    productId: string,
    imageFile: Express.Multer.File,
    isPrimary: boolean = false
  ): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Upload image to Cloudinary
      const uploadResult = await CloudinaryService.uploadImageFromBuffer(
        imageFile.buffer,
        {
          folder: `student-delivery/products/${product.sku}`,
          public_id: `${product.sku}_${Date.now()}`,
          transformation: [
            {
              quality: 'auto:low',
              fetch_format: 'auto',
              width: 800,
              height: 600,
              crop: 'limit',
              flags: 'progressive',
            },
          ],
        }
      );

      // Generate thumbnail
      const thumbnailResult = await CloudinaryService.generateThumbnail(
        uploadResult.public_id,
        {
          folder: `student-delivery/products/${product.sku}/thumbnails`,
          transformation: [
            {
              quality: 'auto:low',
              fetch_format: 'auto',
              width: 200,
              height: 150,
              crop: 'limit',
            },
          ],
        }
      );

      // Add image to product
      await product.addImage({
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        is_primary: isPrimary,
        thumbnail_url: thumbnailResult.secure_url,
      });

      logger.info(`Image added to product ${product.sku}: ${uploadResult.public_id}`);
      return product;
    } catch (error) {
      logger.error('Add product image error:', error);
      throw error;
    }
  }

  /**
   * Set primary image for product
   */
  static async setPrimaryImage(productId: string, imagePublicId: string): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Check if image exists in product
      const imageExists = product.images.some(img => img.public_id === imagePublicId);
      if (!imageExists) {
        throw validationError('Image not found in product');
      }

      await product.setPrimaryImage(imagePublicId);
      
      logger.info(`Primary image set for product ${product.sku}: ${imagePublicId}`);
      return product;
    } catch (error) {
      logger.error('Set primary image error:', error);
      throw error;
    }
  }

  /**
   * Remove image from product
   */
  static async removeProductImage(productId: string, imagePublicId: string): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Remove from Cloudinary
      await CloudinaryService.deleteImage(imagePublicId);

      // Remove from product
      await product.removeImage(imagePublicId);

      logger.info(`Image removed from product ${product.sku}: ${imagePublicId}`);
      return product;
    } catch (error) {
      logger.error('Remove product image error:', error);
      throw error;
    }
  }

  /**
   * Replace all images for a product
   */
  static async replaceProductImages(productId: string, newImages: Express.Multer.File[]): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Delete existing images from Cloudinary
      for (const existingImage of product.images) {
        try {
          await CloudinaryService.deleteImage(existingImage.public_id);
          logger.info(`Deleted old image from Cloudinary: ${existingImage.public_id}`);
        } catch (deleteError) {
          logger.warn(`Failed to delete image from Cloudinary: ${existingImage.public_id}`, deleteError);
          // Continue even if one image fails to delete
        }
      }

      // Clear images array in database
      product.images = [];
      await product.save();

      // Upload new images
      const processedImages: { url: string; public_id: string; is_primary: boolean; thumbnail_url?: string }[] = [];
      
      for (let i = 0; i < newImages.length; i++) {
        const image = newImages[i];
        try {
          // Upload to Cloudinary
          const uploadResult = await CloudinaryService.uploadImageFromBuffer(image.buffer, {
            folder: `student-delivery/products/${product.sku}`,
            public_id: `${product.sku}_${Date.now()}_${i}`,
            transformation: [
              {
                quality: 'auto:low',
                fetch_format: 'auto',
                width: 800,
                height: 600,
                crop: 'limit',
                flags: 'progressive',
              },
            ],
          });

          // Generate thumbnail
          const thumbnailResult = await CloudinaryService.generateThumbnail(
            uploadResult.public_id,
            {
              folder: `student-delivery/products/${product.sku}/thumbnails`,
              transformation: [
                {
                  quality: 'auto:low',
                  fetch_format: 'auto',
                  width: 200,
                  height: 150,
                  crop: 'limit',
                },
              ],
            }
          );

          processedImages.push({
            url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            is_primary: i === 0, // First image is primary
            thumbnail_url: thumbnailResult.secure_url,
          });

          logger.info(`Uploaded new image for product ${product.sku}: ${uploadResult.public_id}`);
        } catch (uploadError) {
          logger.error('Failed to upload image:', uploadError);
          // Continue with other images even if one fails
        }
      }

      // Update product with new images
      product.images = processedImages;
      await product.save();

      logger.info(`Replaced ${processedImages.length} images for product ${product.sku}`);
      return product;
    } catch (error) {
      logger.error('Replace product images error:', error);
      throw error;
    }
  }

  /**
   * Get product by ID
   */
  static async getProductById(productId: string): Promise<IProduct | null> {
    try {
      return await Product.findById(productId);
    } catch (error) {
      logger.error('Get product by ID error:', error);
      throw error;
    }
  }

  /**
   * Get product by SKU
   */
  static async getProductBySku(sku: string): Promise<IProduct | null> {
    try {
      return await Product.findOne({ sku: sku.toUpperCase() });
    } catch (error) {
      logger.error('Get product by SKU error:', error);
      throw error;
    }
  }

  /**
   * Get product by barcode
   */
  static async getProductByBarcode(barcode: string): Promise<IProduct | null> {
    try {
      return await Product.findOne({ barcode: barcode });
    } catch (error) {
      logger.error('Get product by barcode error:', error);
      throw error;
    }
  }

  /**
   * Format product response to ensure clean tags
   */
  static formatProductResponse(product: IProduct): any {
    const productObj = (product as any).toObject ? (product as any).toObject() : product;
    const formatted = {
      ...productObj,
      tags: product.tags ? cleanTagsForStorage(product.tags) : [],
      // Ensure VAT is included (default to 0 if not present)
      vat: productObj.vat !== undefined ? productObj.vat : 0,
    };
    
    // Debug logging to verify VAT is in response
    logger.debug('Formatted product response:', {
      sku: productObj.sku,
      hasVat: 'vat' in formatted,
      vatValue: formatted.vat,
      originalVat: productObj.vat
    });
    
    return formatted;
  }

  /**
   * Get available categories for a store
   */
  static async getCategories(storeId: string): Promise<string[]> {
    try {
      const categories = await Product.distinct('category', { 
        store_id: storeId, 
        is_active: true 
      });
      return categories.sort();
    } catch (error) {
      logger.error('Get categories error:', error);
      throw error;
    }
  }

  /**
   * Get products with filters
   */
  static async getProducts(options: {
    category?: string;
    search?: string;
    is_active?: boolean;
    is_featured?: boolean;
    store_id?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{
    products: IProduct[];
    total: number;
  }> {
    try {
      const {
        category,
        search,
        is_active,
        is_featured,
        store_id,
        sortBy = 'created_at',
        sortOrder = 'desc',
      } = options;

      // Build query
      const query: any = {};

      if (category) query.category = category;
      if (is_active !== undefined) query.is_active = is_active;
      if (is_featured !== undefined) query.is_featured = is_featured;
      if (store_id) query.store_id = store_id;

      // Text search
      if (search) {
        query.$text = { $search: search };
      }

      // Execute query - get all products without pagination
      const [products, total] = await Promise.all([
        Product.find(query)
          .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
          .exec(),
        Product.countDocuments(query),
      ]);

      return {
        products,
        total,
      };
    } catch (error) {
      logger.error('Get products error:', error);
      throw error;
    }
  }

  /**
   * Update product
   */
  static async updateProduct(
    productId: string,
    updateData: UpdateProductData
  ): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Check SKU uniqueness if updating
      if (updateData.sku && updateData.sku !== product.sku) {
        const existingProduct = await Product.findOne({ sku: updateData.sku });
        if (existingProduct) {
          throw validationError('Product with this SKU already exists');
        }
      }

      // Check barcode uniqueness if updating
      if (updateData.barcode && updateData.barcode !== product.barcode) {
        const existingBarcode = await Product.findOne({ barcode: updateData.barcode });
        if (existingBarcode) {
          throw validationError('Product with this barcode already exists');
        }
      }

      // Track price change if price is being updated
      const oldPrice = product.price;
      if (updateData.price !== undefined && updateData.price !== oldPrice) {
        await this.trackPriceChange(
          productId,
          oldPrice,
          updateData.price,
          updateData.priceChangeReason || 'Price updated',
          updateData.changedBy || 'system',
          product.store_id
        );
      }

      // Update product
      // Use Object.assign for most fields, but explicitly handle VAT to ensure it's saved
      Object.assign(product, updateData);
      
      // Explicitly set VAT if it's in the updateData to ensure it's saved (even if 0)
      if ('vat' in updateData) {
        product.vat = updateData.vat ?? 0;
        product.markModified('vat'); // Force Mongoose to save this field
      }
      
      await product.save();

      // Refresh the product to ensure all fields are loaded
      const updatedProduct = await Product.findById(productId);
      if (!updatedProduct) {
        throw validationError('Product not found after update');
      }

      logger.info(`Product updated: ${updatedProduct.sku}`, {
        vat: updatedProduct.vat,
        updateDataVat: updateData.vat,
        productVatAfterSave: (updatedProduct as any).vat,
        hasVatInUpdate: 'vat' in updateData
      });
      return updatedProduct;
    } catch (error) {
      logger.error('Update product error:', error);
      throw error;
    }
  }

  /**
   * Delete product
   */
  static async deleteProduct(productId: string): Promise<boolean> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      // Delete images from Cloudinary
      for (const image of product.images) {
        await CloudinaryService.deleteImage(image.public_id);
      }

      // Delete product
      await Product.findByIdAndDelete(productId);

      logger.info(`Product deleted: ${product.sku}`);
      return true;
    } catch (error) {
      logger.error('Delete product error:', error);
      throw error;
    }
  }

  /**
   * Delete all products for a store
   */
  static async deleteAllProducts(storeId: string): Promise<{ deletedCount: number }> {
    try {
      // Get all products for the store
      const products = await Product.find({ store_id: storeId });
      
      if (products.length === 0) {
        logger.info(`No products found for store: ${storeId}`);
        return { deletedCount: 0 };
      }

      // Delete images from Cloudinary for all products
      for (const product of products) {
        for (const image of product.images) {
          try {
            await CloudinaryService.deleteImage(image.public_id);
          } catch (error) {
            logger.warn(`Failed to delete image ${image.public_id}:`, error);
            // Continue with deletion even if image deletion fails
          }
        }
      }

      // Delete all products for the store
      const result = await Product.deleteMany({ store_id: storeId });

      logger.info(`Bulk deleted ${result.deletedCount} products for store: ${storeId}`);
      return { deletedCount: result.deletedCount };
    } catch (error) {
      logger.error('Delete all products error:', error);
      throw error;
    }
  }

  /**
   * Update stock quantity
   */
  static async updateStock(productId: string, newQuantity: number): Promise<IProduct> {
    try {
      const product = await Product.findById(productId);
      if (!product) {
        throw validationError('Product not found');
      }

      product.stock_quantity = newQuantity;
      await product.save();

      logger.info(`Stock updated for product ${product.sku}: ${newQuantity}`);
      return product;
    } catch (error) {
      logger.error('Update stock error:', error);
      throw error;
    }
  }

  /**
   * Export all products for a store
   */
  static async exportProducts(storeId: string): Promise<{
    products: any[];
    exportDate: string;
    storeId: string;
    totalProducts: number;
  }> {
    try {
      const products = await Product.find({ store_id: storeId }).sort({ created_at: -1 });
      
      const exportData = {
        products: products.map(product => ({
          ...product.toObject(),
          // Ensure all fields are included
          _id: product._id,
          name: product.name,
          description: product.description || '',
          price: product.price,
          category: product.category,
          sku: product.sku,
          barcode: product.barcode || '',
          stock_quantity: product.stock_quantity,
          min_stock_level: product.min_stock_level,
          unit: product.unit,
          weight: product.weight,
          dimensions: product.dimensions,
          tags: product.tags || [],
          images: product.images || [],
          is_active: product.is_active,
          is_featured: product.is_featured,
          created_by: product.created_by,
          store_id: product.store_id,
          created_at: product.created_at,
          updated_at: product.updated_at
        })),
        exportDate: new Date().toISOString(),
        storeId,
        totalProducts: products.length
      };

      logger.info(`Exported ${products.length} products for store: ${storeId}`);
      return exportData;
    } catch (error) {
      logger.error('Export products error:', error);
      throw error;
    }
  }

  /**
   * Import products from JSON data
   */
  static async importProducts(
    importData: any,
    storeId: string,
    createdBy: string
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: string[];
    importedProducts: IProduct[];
  }> {
    try {
      logger.info('Import data received:', { 
        hasProducts: !!importData.products, 
        isArray: Array.isArray(importData),
        hasData: !!importData.data,
        keys: Object.keys(importData || {})
      });
      
      let products;
      
      // Handle different JSON structures
      if (importData.products && Array.isArray(importData.products)) {
        // Standard export format: { products: [...], exportDate: ..., storeId: ... }
        products = importData.products;
        logger.info(`Found ${products.length} products in standard format`);
      } else if (Array.isArray(importData)) {
        // Direct array format: [...]
        products = importData;
        logger.info(`Found ${products.length} products in direct array format`);
      } else if (importData.data && Array.isArray(importData.data)) {
        // Alternative format: { data: [...] }
        products = importData.data;
        logger.info(`Found ${products.length} products in data format`);
      } else {
        logger.error('Invalid import data structure:', importData);
        throw validationError('Invalid import data: products array not found. Expected format: { products: [...] } or direct array');
      }

      const results = {
        successCount: 0,
        errorCount: 0,
        errors: [] as string[],
        importedProducts: [] as IProduct[]
      };

      for (let i = 0; i < products.length; i++) {
        try {
          const productData = products[i];
          
          // Validate required fields
          if (!productData.name || !productData.price || !productData.category) {
            results.errors.push(`Row ${i + 1}: Missing required fields (name, price, category)`);
            results.errorCount++;
            continue;
          }

          // Check if SKU already exists
          let finalSku = productData.sku || `SKU-IMPORT-${Date.now()}-${i}`;
          let counter = 1;
          while (await Product.findOne({ sku: finalSku })) {
            finalSku = `${productData.sku || `SKU-IMPORT-${Date.now()}-${i}`}-${counter}`;
            counter++;
          }

          // Create product data
          const newProductData: CreateProductData = {
            name: productData.name,
            description: productData.description || '',
            price: parseFloat(productData.price) || 0,
            category: productData.category,
            sku: finalSku,
            barcode: productData.barcode || undefined,
            stock_quantity: parseInt(productData.stock_quantity) || 0,
            min_stock_level: parseInt(productData.min_stock_level) || 5,
            unit: productData.unit || 'piece',
            weight: productData.weight,
            dimensions: productData.dimensions,
            tags: productData.tags || [],
            is_featured: productData.is_featured || false,
            created_by: createdBy,
            store_id: storeId
          };

          // Create the product
          const product = await Product.create(newProductData);
          results.importedProducts.push(product);
          results.successCount++;

          logger.info(`Imported product: ${product.sku}`);
        } catch (error: any) {
          results.errors.push(`Row ${i + 1}: ${error.message || 'Import failed'}`);
          results.errorCount++;
          logger.error(`Failed to import product at row ${i + 1}:`, error);
        }
      }

      logger.info(`Import completed: ${results.successCount} successful, ${results.errorCount} failed`);
      return results;
    } catch (error) {
      logger.error('Import products error:', error);
      throw error;
    }
  }

  /**
   * Get price history for a product
   */
  static async getProductPriceHistory(
    productId: string,
    limit: number = 50
  ): Promise<any[]> {
    try {
      const priceHistory = await ProductPriceHistory.find({ product_id: productId })
        .sort({ changed_at: -1 })
        .limit(limit)
        .lean();

      return priceHistory;
    } catch (error) {
      logger.error('Get product price history error:', error);
      throw error;
    }
  }

  /**
   * Track price change when updating a product
   */
  static async trackPriceChange(
    productId: string,
    oldPrice: number,
    newPrice: number,
    changeReason: string,
    changedBy: string,
    storeId: string
  ): Promise<void> {
    try {
      // Only track if price actually changed
      if (oldPrice !== newPrice) {
        await ProductPriceHistory.create({
          product_id: productId,
          store_id: storeId,
          old_price: oldPrice,
          new_price: newPrice,
          change_reason: changeReason,
          changed_by: changedBy,
          changed_at: new Date(),
        });

        logger.info(`Price change tracked for product ${productId}: ${oldPrice} -> ${newPrice}`);
      }
    } catch (error) {
      logger.error('Track price change error:', error);
      // Don't throw error here as it shouldn't break the main product update
    }
  }
}

export const productService = new ProductService();