import { AuditLog, IAuditLog } from '../models/AuditLog';
import { logger } from '../utils/logger';
import { Request } from 'express';

export interface AuditLogData {
  user_id: string;
  user_email: string;
  user_role: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT';
  resource_type: 'PRODUCT' | 'TRANSACTION' | 'EXPENSE' | 'USER' | 'INVENTORY' | 'GOAL';
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
}

export class AuditService {
  /**
   * Create an audit log entry
   */
  static async createAuditLog(data: AuditLogData): Promise<IAuditLog> {
    try {
      const auditLog = new AuditLog(data);
      await auditLog.save();
      logger.info(`Audit log created: ${data.action} ${data.resource_type} by ${data.user_email}`);
      return auditLog;
    } catch (error) {
      logger.error('Error creating audit log:', error);
      throw error;
    }
  }

  /**
   * Get audit logs with filtering and pagination
   */
  static async getAuditLogs(options: {
    page?: number;
    limit?: number;
    user_id?: string;
    resource_type?: string;
    action?: string;
    store_id?: string;
    start_date?: Date;
    end_date?: Date;
    user_role?: string;
  } = {}): Promise<{
    logs: IAuditLog[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        user_id,
        resource_type,
        action,
        store_id,
        start_date,
        end_date,
        user_role,
      } = options;

      // Build query
      const query: any = {};
      
      if (user_id) query.user_id = user_id;
      if (resource_type) query.resource_type = resource_type;
      if (action) query.action = action;
      if (store_id) query['metadata.store_id'] = store_id;
      
      // Handle user_role filtering
      if (user_role) {
        if (user_role.includes(',')) {
          // Multiple roles (e.g., "manager,cashier")
          const roles = user_role.split(',').map(role => role.trim());
          query.user_role = { $in: roles };
        } else {
          // Single role
          query.user_role = user_role;
        }
      }
      
      if (start_date || end_date) {
        query.created_at = {};
        if (start_date) query.created_at.$gte = start_date;
        if (end_date) query.created_at.$lte = end_date;
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      return {
        logs: logs as unknown as IAuditLog[],
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error getting audit logs:', error);
      throw error;
    }
  }

  /**
   * Get audit trail for a specific resource
   */
  static async getResourceAuditTrail(
    resource_type: string,
    resource_id: string
  ): Promise<IAuditLog[]> {
    try {
      const logs = await AuditLog.find({
        resource_type,
        resource_id,
      })
        .sort({ created_at: -1 })
        .lean();
      
      return logs as unknown as IAuditLog[];
    } catch (error) {
      logger.error('Error getting resource audit trail:', error);
      throw error;
    }
  }

  /**
   * Get user activity summary
   */
  static async getUserActivitySummary(user_id: string, days: number = 30): Promise<{
    total_actions: number;
    actions_by_type: Record<string, number>;
    recent_activity: IAuditLog[];
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [logs, actionCounts] = await Promise.all([
        AuditLog.find({
          user_id,
          created_at: { $gte: startDate },
        })
          .sort({ created_at: -1 })
          .limit(10)
          .lean(),
        AuditLog.aggregate([
          {
            $match: {
              user_id,
              created_at: { $gte: startDate },
            },
          },
          {
            $group: {
              _id: '$action',
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const actions_by_type = actionCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {} as Record<string, number>);

      return {
        total_actions: logs.length,
        actions_by_type,
        recent_activity: logs as unknown as IAuditLog[],
      };
    } catch (error) {
      logger.error('Error getting user activity summary:', error);
      throw error;
    }
  }

  /**
   * Extract user info from request
   */
  static extractUserInfo(req: Request): {
    user_id: string;
    user_email: string;
    user_role: string;
    store_id?: string;
  } {
    const user = (req as any).user;
    if (!user) {
      // Return default values for unauthenticated requests
      return {
        user_id: 'system',
        user_email: 'system@system.com',
        user_role: 'system',
        store_id: 'default-store',
      };
    }

    return {
      user_id: user.id || user._id,
      user_email: user.email,
      user_role: user.role,
      store_id: user.store_id,
    };
  }

  /**
   * Extract metadata from request
   */
  static extractMetadata(req: Request): {
    ip_address?: string;
    user_agent?: string;
  } {
    return {
      ip_address: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] as string,
      user_agent: req.headers['user-agent'] as string,
    };
  }

  /**
   * Compare objects to find changes
   */
  static findChanges(oldObj: any, newObj: any): {
    field: string;
    old_value: any;
    new_value: any;
  }[] {
    const changes: {
      field: string;
      old_value: any;
      new_value: any;
    }[] = [];

    // Get all unique keys from both objects
    const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

    for (const key of allKeys) {
      const oldValue = oldObj?.[key];
      const newValue = newObj?.[key];

      // Skip certain fields that shouldn't be tracked
      const skipFields = ['_id', 'created_at', 'updated_at', '__v'];
      if (skipFields.includes(key)) continue;

      // Check if values are different
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field: key,
          old_value: oldValue,
          new_value: newValue,
        });
      }
    }

    return changes;
  }

  /**
   * Log a create action
   */
  static async logCreate(
    req: Request,
    resource_type: string,
    resource_id: string,
    resource_name?: string,
    additionalData?: any
  ): Promise<void> {
    try {
      const userInfo = this.extractUserInfo(req);
      const metadata = this.extractMetadata(req);

      await this.createAuditLog({
        ...userInfo,
        action: 'CREATE',
        resource_type: resource_type as any,
        resource_id,
        resource_name,
        metadata: {
          ...metadata,
          store_id: userInfo.store_id,
          additional_info: additionalData,
        },
      });
    } catch (error) {
      logger.error('Error logging create action:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  /**
   * Log an update action
   */
  static async logUpdate(
    req: Request,
    resource_type: string,
    resource_id: string,
    resource_name: string,
    oldData: any,
    newData: any,
    additionalData?: any
  ): Promise<void> {
    try {
      const userInfo = this.extractUserInfo(req);
      const metadata = this.extractMetadata(req);
      const changes = this.findChanges(oldData, newData);

      if (changes.length === 0) {
        // No actual changes, skip logging
        return;
      }

      await this.createAuditLog({
        ...userInfo,
        action: 'UPDATE',
        resource_type: resource_type as any,
        resource_id,
        resource_name,
        changes,
        metadata: {
          ...metadata,
          store_id: userInfo.store_id,
          additional_info: additionalData,
        },
      });
    } catch (error) {
      logger.error('Error logging update action:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  /**
   * Log a delete action
   */
  static async logDelete(
    req: Request,
    resource_type: string,
    resource_id: string,
    resource_name: string,
    deletedData?: any
  ): Promise<void> {
    try {
      const userInfo = this.extractUserInfo(req);
      const metadata = this.extractMetadata(req);

      await this.createAuditLog({
        ...userInfo,
        action: 'DELETE',
        resource_type: resource_type as any,
        resource_id,
        resource_name,
        metadata: {
          ...metadata,
          store_id: userInfo.store_id,
          additional_info: deletedData,
        },
      });
    } catch (error) {
      logger.error('Error logging delete action:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  /**
   * Log login/logout actions
   */
  static async logAuth(
    req: Request,
    action: 'LOGIN' | 'LOGOUT',
    user_id: string,
    user_email: string,
    user_role: string,
    store_id?: string
  ): Promise<void> {
    try {
      const metadata = this.extractMetadata(req);

      await this.createAuditLog({
        user_id,
        user_email,
        user_role,
        action,
        resource_type: 'USER',
        resource_id: user_id,
        resource_name: user_email,
        metadata: {
          ...metadata,
          store_id,
        },
      });
    } catch (error) {
      logger.error('Error logging auth action:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }
}
