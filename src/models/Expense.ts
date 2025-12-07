import mongoose, { Document, Schema } from 'mongoose';

export interface IExpense extends Document<any, any, any> {
  _id: string;
  store_id: string;
  date: Date;
  month_year: string; // Format: "August - 2025"
  product_name: string;
  product_id?: string; // Reference to Product if this expense is for a product
  unit: 'pieces' | 'kgs' | 'liters' | 'boxes' | 'packets' | 'other';
  quantity: number;
  amount: number;
  cost_per_unit?: number; // Calculated cost per unit (amount / quantity)
  currency: 'TRY' | 'USD' | 'NGN' | 'EUR';
  payment_method: 'cash' | 'isbank' | 'naira' | 'card' | 'transfer' | 'other';
  category: 'food' | 'supplies' | 'utilities' | 'equipment' | 'maintenance' | 'other';
  description?: string;
  receipt_number?: string;
  vendor_name?: string;
  created_by: string; // User ID who created the expense
  created_at: Date;
  updated_at: Date;
}

const expenseSchema = new Schema<IExpense>({
  store_id: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  month_year: {
    type: String,
    required: true,
  },
  product_name: {
    type: String,
    required: true,
    trim: true,
  },
  product_id: {
    type: String,
    ref: 'Product',
    sparse: true, // Allows multiple null values but enforces uniqueness for non-null values
  },
  unit: {
    type: String,
    enum: ['pieces', 'kgs', 'liters', 'boxes', 'packets', 'other'],
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  cost_per_unit: {
    type: Number,
    required: false,
    min: 0,
  },
  currency: {
    type: String,
    enum: ['TRY', 'USD', 'NGN', 'EUR'],
    default: 'TRY',
  },
  payment_method: {
    type: String,
    enum: ['cash', 'isbank', 'naira', 'card', 'transfer', 'other'],
    required: true,
  },
  category: {
    type: String,
    enum: ['food', 'supplies', 'utilities', 'equipment', 'maintenance', 'other'],
    default: 'other',
  },
  description: {
    type: String,
    trim: true,
  },
  receipt_number: {
    type: String,
    trim: true,
  },
  vendor_name: {
    type: String,
    trim: true,
  },
  created_by: {
    type: String,
    required: true,
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
expenseSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Auto-generate month_year from date
  if (this.date) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const month = monthNames[this.date.getMonth()];
    const year = this.date.getFullYear();
    this.month_year = `${month} - ${year}`;
  }
  
  // Auto-calculate cost_per_unit if quantity and amount are present
  if (this.quantity && this.quantity > 0 && this.amount) {
    this.cost_per_unit = this.amount / this.quantity;
  }
  
  next();
});

// Create indexes for better performance
expenseSchema.index({ store_id: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ month_year: 1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ payment_method: 1 });
expenseSchema.index({ created_by: 1 });
expenseSchema.index({ product_name: 'text' }); // Text search index
expenseSchema.index({ product_id: 1 }); // Index for product lookup

// Create the model
export const Expense = mongoose.model<IExpense>('Expense', expenseSchema);
