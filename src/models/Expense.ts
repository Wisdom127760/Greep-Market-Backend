import mongoose, { Document, Schema } from 'mongoose';

export interface IExpense extends Document<any, any, any> {
  _id: string;
  store_id: string;
  date: Date;
  month_year: string; // Format: "August - 2025"
  product_name: string;
  unit: 'pieces' | 'kgs' | 'liters' | 'boxes' | 'packets' | 'other';
  quantity: number;
  amount: number;
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

// Create the model
export const Expense = mongoose.model<IExpense>('Expense', expenseSchema);
