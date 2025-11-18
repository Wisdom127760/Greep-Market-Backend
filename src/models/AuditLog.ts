import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document<any, any, any> {
  _id: string;
  user_id: string;
  user_email: string;
  user_role: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT';
  resource_type: 'PRODUCT' | 'TRANSACTION' | 'EXPENSE' | 'USER' | 'INVENTORY' | 'GOAL' | 'WHOLESALER';
  resource_id: string;
  resource_name?: string;
  changes?: {
    field: string;
    old_value: any;
    new_value: any;
  }[];
  metadata?: {
    ip_address?: string;
    user_agent?: string;
    store_id?: string;
    additional_info?: any;
  };
  created_at: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  user_id: {
    type: String,
    required: true,
    index: true,
  },
  user_email: {
    type: String,
    required: true,
    index: true,
  },
  user_role: {
    type: String,
    required: true,
    enum: ['admin', 'manager', 'cashier', 'system'],
  },
  action: {
    type: String,
    required: true,
    enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT'],
  },
  resource_type: {
    type: String,
    required: true,
    enum: ['PRODUCT', 'TRANSACTION', 'EXPENSE', 'USER', 'INVENTORY', 'GOAL', 'WHOLESALER'],
  },
  resource_id: {
    type: String,
    required: true,
    index: true,
  },
  resource_name: {
    type: String,
    required: false,
  },
  changes: [{
    field: {
      type: String,
      required: true,
    },
    old_value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    new_value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  }],
  metadata: {
    ip_address: {
      type: String,
      required: false,
    },
    user_agent: {
      type: String,
      required: false,
    },
    store_id: {
      type: String,
      required: false,
      index: true,
    },
    additional_info: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Compound indexes for efficient querying
auditLogSchema.index({ user_id: 1, created_at: -1 });
auditLogSchema.index({ resource_type: 1, resource_id: 1, created_at: -1 });
auditLogSchema.index({ action: 1, created_at: -1 });
auditLogSchema.index({ store_id: 1, created_at: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
