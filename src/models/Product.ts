import mongoose, { Document, Schema } from 'mongoose';
import { cleanTagsForStorage } from '../utils/tagFormatter';

export interface IProduct extends Document {
  name: string;
  description: string;
  price: number;
  vat?: number; // VAT percentage
  category: string;
  sku: string;
  barcode?: string;
  stock_quantity: number;
  min_stock_level: number;
  unit: string;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  images: {
    url: string;
    public_id: string;
    is_primary: boolean;
    thumbnail_url?: string;
  }[];
  tags: string[];
  is_active: boolean;
  is_featured: boolean;
  created_by: string; // User ID who created the product
  store_id: string;
  wholesaler_id?: string; // Wholesaler ID who supplies this product
  created_at: Date;
  updated_at: Date;
  
  // Methods
  addImage(imageData: {
    url: string;
    public_id: string;
    is_primary?: boolean;
    thumbnail_url?: string;
  }): Promise<IProduct>;
  setPrimaryImage(imageId: string): Promise<IProduct>;
  removeImage(publicId: string): Promise<IProduct>;
}

const productSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined; // Allow empty strings but not null/undefined
      },
      message: 'Product name is required'
    }
  },
  description: {
    type: String,
    required: false, // Changed to false to allow empty descriptions
    trim: true,
    maxlength: 1000,
    default: '' // Provide default empty string
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  vat: {
    type: Number,
    required: false,
    min: 0,
    max: 100,
    default: 0,
  },
  category: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined; // Allow empty strings but not null/undefined
      },
      message: 'Product category is required'
    }
  },
  sku: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined; // Allow empty strings but not null/undefined
      },
      message: 'Product SKU is required'
    }
  },
  barcode: {
    type: String,
    trim: true,
    sparse: true, // Allows multiple null values but enforces uniqueness for non-null values
  },
  stock_quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  min_stock_level: {
    type: Number,
    required: true,
    min: 0,
    default: 5,
  },
  unit: {
    type: String,
    required: true,
    trim: true,
    default: 'piece',
  },
  weight: {
    type: Number,
    min: 0,
  },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
  },
  images: [{
    url: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
      required: true,
    },
    is_primary: {
      type: Boolean,
      default: false,
    },
    thumbnail_url: {
      type: String,
    },
  }],
  tags: [{
    type: String,
    trim: true,
  }],
  is_active: {
    type: Boolean,
    default: true,
  },
  is_featured: {
    type: Boolean,
    default: false,
  },
  created_by: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined; // Allow empty strings but not null/undefined
      },
      message: 'Created by user ID is required'
    }
  },
  store_id: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined; // Allow empty strings but not null/undefined
      },
      message: 'Store ID is required'
    }
  },
  wholesaler_id: {
    type: String,
    ref: 'Wholesaler',
    sparse: true, // Allows multiple null values but enforces uniqueness for non-null values
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for better query performance
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
// Note: sku and barcode indexes are automatically created by unique: true
productSchema.index({ category: 1 });
productSchema.index({ store_id: 1 });
// Note: wholesaler_id index is automatically created by Mongoose when using ref + sparse
productSchema.index({ is_active: 1 });
productSchema.index({ is_featured: 1 });
productSchema.index({ created_at: -1 });

// Update the updated_at field and normalize tags before saving
productSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Clean and normalize tags to prevent JSON array issues
  if (this.tags && Array.isArray(this.tags)) {
    this.tags = cleanTagsForStorage(this.tags);
  }
  
  next();
});

// Pre-update middleware to clean and normalize tags in bulk operations
productSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function(next) {
  const update = this.getUpdate() as any;
  if (update && update.tags && Array.isArray(update.tags)) {
    update.tags = cleanTagsForStorage(update.tags);
  }
  if (update && update.$set && update.$set.tags && Array.isArray(update.$set.tags)) {
    update.$set.tags = cleanTagsForStorage(update.$set.tags);
  }
  next();
});

// Virtual for primary image
productSchema.virtual('primary_image').get(function() {
  return this.images?.find(img => img.is_primary) || this.images?.[0];
});

// Virtual for thumbnail
productSchema.virtual('thumbnail').get(function() {
  const primaryImage = this.images?.find(img => img.is_primary) || this.images?.[0];
  return primaryImage?.thumbnail_url || primaryImage?.url;
});

// Method to add image
productSchema.methods.addImage = function(imageData: {
  url: string;
  public_id: string;
  is_primary?: boolean;
  thumbnail_url?: string;
}) {
  // If this is set as primary, unset other primary images
  if (imageData.is_primary) {
    this.images.forEach((img: any) => {
      img.is_primary = false;
    });
  }
  
  this.images.push(imageData);
  return this.save();
};

// Method to set primary image
productSchema.methods.setPrimaryImage = function(imageId: string) {
  this.images.forEach((img: any) => {
    img.is_primary = img.public_id === imageId;
  });
  return this.save();
};

// Method to remove image
productSchema.methods.removeImage = function(publicId: string) {
  const imageIndex = this.images.findIndex((img: any) => img.public_id === publicId);
  if (imageIndex !== -1) {
    this.images.splice(imageIndex, 1);
    return this.save();
  }
  return Promise.resolve(this);
};

// Create the model
export const Product = mongoose.model<IProduct>('Product', productSchema);
