import mongoose, { Document, Schema } from 'mongoose';

export interface IGoal extends Document<any, any, any> {
  _id: string;
  user_id: string;
  store_id: string;
  goal_type: 'daily' | 'monthly' | 'weekly' | 'yearly';
  target_amount: number;
  currency: string;
  period_start: Date;
  period_end: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const goalSchema = new Schema<IGoal>({
  user_id: {
    type: String,
    required: true,
    index: true,
  },
  store_id: {
    type: String,
    required: true,
    index: true,
  },
  goal_type: {
    type: String,
    enum: ['daily', 'monthly', 'weekly', 'yearly'],
    required: true,
  },
  target_amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    required: true,
    default: 'TRY',
  },
  period_start: {
    type: Date,
    required: true,
  },
  period_end: {
    type: Date,
    required: true,
  },
  is_active: {
    type: Boolean,
    default: true,
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
goalSchema.index({ user_id: 1, goal_type: 1, is_active: 1 });
goalSchema.index({ store_id: 1, goal_type: 1, is_active: 1 });
goalSchema.index({ period_start: 1, period_end: 1 });

// Update the updated_at field before saving
goalSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

export const Goal = mongoose.model<IGoal>('Goal', goalSchema);




