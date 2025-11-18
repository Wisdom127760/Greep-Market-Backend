import mongoose, { Document, Schema } from 'mongoose';

export interface IRider extends Document<any, any, any> {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  is_active: boolean;
  current_balance: number; // Amount of money the rider currently has
  total_delivered: number; // Total amount of deliveries made
  total_reconciled: number; // Total amount reconciled
  pending_reconciliation: number; // Amount pending reconciliation
  store_id: string;
  created_at: Date;
  updated_at: Date;
}

const riderSchema = new Schema<IRider>({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: /^[\+]?[1-9][\d]{0,15}$/,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  current_balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  total_delivered: {
    type: Number,
    default: 0,
    min: 0,
  },
  total_reconciled: {
    type: Number,
    default: 0,
    min: 0,
  },
  pending_reconciliation: {
    type: Number,
    default: 0,
    min: 0,
  },
  store_id: {
    type: String,
    required: true,
    trim: true,
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
});

// Indexes
riderSchema.index({ store_id: 1, is_active: 1 });
riderSchema.index({ phone: 1 });
riderSchema.index({ email: 1 });

// Ensure phone is unique per store
riderSchema.index({ phone: 1, store_id: 1 }, { unique: true });

export const Rider = mongoose.model<IRider>('Rider', riderSchema);
