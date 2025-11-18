import mongoose, { Document, Schema } from 'mongoose';

export interface ITransaction extends Document<any, any, any> {
  _id: string;
  store_id: string;
  customer_id?: string;
  items: TransactionItem[];
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  payment_method: 'cash' | 'pos_isbank_transfer' | 'naira_transfer' | 'crypto_payment';
  payment_status: 'pending' | 'completed' | 'failed' | 'refunded';
  status: 'pending' | 'completed' | 'cancelled' | 'voided';
  order_source?: 'online' | 'in-store' | 'phone' | 'delivery';
  cashier_id: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount_amount?: number;
}

const transactionItemSchema = new Schema<TransactionItem>({
  product_id: {
    type: String,
    required: true,
  },
  product_name: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  unit_price: {
    type: Number,
    required: true,
    min: 0,
  },
  total_price: {
    type: Number,
    required: true,
    min: 0,
  },
  discount_amount: {
    type: Number,
    default: 0,
    min: 0,
  },
}, { _id: false });

const transactionSchema = new Schema<ITransaction>({
  store_id: {
    type: String,
    required: true,
  },
  customer_id: {
    type: String,
    default: null,
  },
  items: [transactionItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  discount_amount: {
    type: Number,
    default: 0,
    min: 0,
  },
  total_amount: {
    type: Number,
    required: true,
    min: 0,
  },
  payment_method: {
    type: String,
    enum: ['cash', 'pos_isbank_transfer', 'naira_transfer', 'crypto_payment'],
    required: true,
  },
  payment_status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled', 'voided'],
    default: 'pending',
  },
  order_source: {
    type: String,
    enum: ['online', 'in-store', 'phone', 'delivery'],
    default: 'in-store',
  },
  cashier_id: {
    type: String,
    required: true,
  },
  notes: {
    type: String,
    default: null,
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

// Update the updated_at field before saving
transactionSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Create indexes
transactionSchema.index({ store_id: 1 });
transactionSchema.index({ created_at: -1 });
transactionSchema.index({ cashier_id: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ payment_status: 1 });
transactionSchema.index({ order_source: 1 });

// Create the model
export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
