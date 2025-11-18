import mongoose, { Document, Schema } from 'mongoose';

export interface IProductPriceHistory extends Document<any, any, any> {
  _id: string;
  product_id: string;
  store_id: string;
  old_price: number;
  new_price: number;
  change_reason: string;
  changed_by: string;
  changed_at: Date;
  created_at: Date;
}

const productPriceHistorySchema = new Schema<IProductPriceHistory>({
  product_id: {
    type: String,
    required: true,
    index: true,
  },
  store_id: {
    type: String,
    required: true,
    index: true,
  },
  old_price: {
    type: Number,
    required: true,
    min: 0,
  },
  new_price: {
    type: Number,
    required: true,
    min: 0,
  },
  change_reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  changed_by: {
    type: String,
    required: true,
  },
  changed_at: {
    type: Date,
    default: Date.now,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for better query performance
productPriceHistorySchema.index({ product_id: 1, changed_at: -1 });
productPriceHistorySchema.index({ store_id: 1, changed_at: -1 });
productPriceHistorySchema.index({ changed_by: 1 });

// Create the model
export const ProductPriceHistory = mongoose.model<IProductPriceHistory>('ProductPriceHistory', productPriceHistorySchema);




