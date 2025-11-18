import mongoose, { Document, Schema } from 'mongoose';

export interface IWholesaler extends Document {
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
}

const wholesalerSchema = new Schema<IWholesaler>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 255,
    sparse: true, // Allows multiple null values but enforces uniqueness for non-null values
  },
  address: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  store_id: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined;
      },
      message: 'Store ID is required'
    }
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  created_by: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return v !== null && v !== undefined;
      },
      message: 'Created by user ID is required'
    }
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
wholesalerSchema.index({ store_id: 1 });
wholesalerSchema.index({ name: 'text', address: 'text' });
wholesalerSchema.index({ is_active: 1 });
wholesalerSchema.index({ created_at: -1 });

// Update the updated_at field before saving
wholesalerSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Create the model
export const Wholesaler = mongoose.model<IWholesaler>('Wholesaler', wholesalerSchema);

