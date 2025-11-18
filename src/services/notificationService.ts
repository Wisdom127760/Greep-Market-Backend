import { Notification, INotification } from '../models/Notification';
import { logger } from '../utils/logger';
import { getStoreTimezone } from '../utils/timezone';
import { DateTime } from 'luxon';

export interface NotificationData {
  user_id: string;
  store_id: string;
  type: 'milestone' | 'daily_summary' | 'goal_reminder' | 'achievement' | 'system';
  title: string;
  message: string;
  data?: any;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  expires_in_hours?: number;
}

export interface MilestoneData {
  milestone_type: 'daily_sales' | 'monthly_sales' | 'transaction_count' | 'customer_count';
  milestone_value: number;
  goal_percentage?: number;
  previous_value?: number;
}

export interface SalesSummaryData {
  total_sales: number;
  transaction_count: number;
  top_product?: string;
  growth_percentage?: number;
  daily_goal?: number;
  monthly_goal?: number;
  daily_progress?: number;
  monthly_progress?: number;
}

export class NotificationService {
  /**
   * Create a new notification
   */
  static async createNotification(data: NotificationData): Promise<INotification> {
    try {
      const expiresAt = data.expires_in_hours 
        ? new Date(Date.now() + data.expires_in_hours * 60 * 60 * 1000)
        : undefined;

      // Basic deduplication: avoid creating an identical high-frequency notification within 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existing = await Notification.findOne({
        user_id: data.user_id,
        store_id: data.store_id,
        type: data.type,
        title: data.title,
        message: data.message,
        created_at: { $gte: fiveMinutesAgo }
      }).lean();

      if (existing) {
        logger.info('Skipped duplicate notification within 5 minutes window', {
          user_id: data.user_id,
          store_id: data.store_id,
          type: data.type,
          title: data.title
        });
        // Return the existing one as a no-op
        return existing as any;
      }

      const notification = new Notification({
        ...data,
        expires_at: expiresAt
      });

      await notification.save();
      
      logger.info(`Notification created: ${data.type} for user ${data.user_id}`, {
        notification_id: notification._id,
        type: data.type,
        priority: data.priority || 'medium'
      });

      return notification;
    } catch (error) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create milestone achievement notification
   */
  static async createMilestoneNotification(
    userId: string,
    storeId: string,
    milestoneData: MilestoneData
  ): Promise<INotification> {
    const { milestone_type, milestone_value, goal_percentage, previous_value } = milestoneData;
    
    let title = '';
    let message = '';
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'high';

    switch (milestone_type) {
      case 'daily_sales':
        title = '🎉 Daily Sales Milestone Reached!';
        message = `Congratulations! You've hit ₺${milestone_value.toLocaleString()} in daily sales${goal_percentage ? ` (${goal_percentage}% of your goal)` : ''}!`;
        if (goal_percentage && goal_percentage >= 100) {
          title = '🏆 Daily Goal CRUSHED!';
          message = `Amazing! You've exceeded your daily sales goal by ${goal_percentage - 100}%! Total: ₺${milestone_value.toLocaleString()}`;
          priority = 'urgent';
        }
        break;

      case 'monthly_sales':
        title = '🚀 Monthly Sales Milestone!';
        message = `Outstanding! You've reached ₺${milestone_value.toLocaleString()} in monthly sales${goal_percentage ? ` (${goal_percentage}% of monthly goal)` : ''}!`;
        if (goal_percentage && goal_percentage >= 100) {
          title = '👑 Monthly Goal ACHIEVED!';
          message = `Incredible! You've surpassed your monthly sales goal by ${goal_percentage - 100}%! Total: ₺${milestone_value.toLocaleString()}`;
          priority = 'urgent';
        }
        break;

      case 'transaction_count':
        title = '💳 Transaction Milestone!';
        message = `Great job! You've processed ${milestone_value} transactions today${goal_percentage ? ` (${goal_percentage}% of daily goal)` : ''}!`;
        if (milestone_value >= 100) {
          title = '🎯 100+ Transactions!';
          message = `Fantastic! You've processed over 100 transactions today! Keep up the excellent work!`;
          priority = 'urgent';
        }
        break;

      case 'customer_count':
        title = '👥 Customer Milestone!';
        message = `Awesome! You've served ${milestone_value} customers today${goal_percentage ? ` (${goal_percentage}% of daily goal)` : ''}!`;
        break;
    }

    // Add motivational message based on growth
    if (previous_value && milestone_value > previous_value) {
      const growth = ((milestone_value - previous_value) / previous_value) * 100;
      if (growth >= 50) {
        message += ` 📈 That's a ${growth.toFixed(0)}% increase from yesterday! You're on fire!`;
        priority = 'urgent';
      } else if (growth >= 20) {
        message += ` 📊 Great ${growth.toFixed(0)}% growth! Keep it up!`;
      }
    }

    return this.createNotification({
      user_id: userId,
      store_id: storeId,
      type: 'milestone',
      title,
      message,
      data: milestoneData,
      priority,
      expires_in_hours: 24 // Milestone notifications expire in 24 hours
    });
  }

  /**
   * Create daily summary notification
   */
  static async createDailySummaryNotification(
    userId: string,
    storeId: string,
    salesData: SalesSummaryData
  ): Promise<INotification> {
    const {
      total_sales,
      transaction_count,
      top_product,
      growth_percentage,
      daily_goal,
      monthly_goal,
      daily_progress,
      monthly_progress
    } = salesData;

    const timezone = getStoreTimezone(storeId);
    const now = DateTime.now().setZone(timezone);
    const isEvening = now.hour >= 18;

    let title = '';
    let message = '';
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

    if (isEvening) {
      title = '📊 End of Day Summary';
      message = `Great work today! You processed ${transaction_count} transactions and made ₺${total_sales.toLocaleString()} in sales.`;
    } else {
      title = '📈 Midday Progress Update';
      message = `Keep going! You've made ₺${total_sales.toLocaleString()} so far today with ${transaction_count} transactions.`;
    }

    // Add goal progress
    if (daily_progress !== undefined) {
      if (daily_progress >= 100) {
        message += ` 🎉 You've already exceeded your daily goal!`;
        priority = 'high';
      } else if (daily_progress >= 80) {
        message += ` 🔥 You're ${daily_progress}% to your daily goal! Almost there!`;
        priority = 'high';
      } else if (daily_progress >= 50) {
        message += ` 📊 You're ${daily_progress}% to your daily goal. Keep pushing!`;
      } else {
        message += ` 💪 You're ${daily_progress}% to your daily goal. Let's pick up the pace!`;
        priority = 'high';
      }
    }

    // Add monthly progress
    if (monthly_progress !== undefined) {
      message += ` Monthly progress: ${monthly_progress}%`;
      if (monthly_progress >= 90) {
        message += ` 🏆 Monthly goal is within reach!`;
        priority = 'high';
      }
    }

    // Add top product
    if (top_product) {
      message += ` Top seller: ${top_product}`;
    }

    // Add growth message
    if (growth_percentage !== undefined) {
      if (growth_percentage > 0) {
        message += ` 📈 ${growth_percentage.toFixed(1)}% growth from yesterday!`;
        if (growth_percentage >= 20) {
          message += ` 🚀 You're crushing it!`;
          priority = 'high';
        }
      } else if (growth_percentage < -10) {
        message += ` 📉 ${Math.abs(growth_percentage).toFixed(1)}% down from yesterday. Let's turn it around!`;
        priority = 'high';
      }
    }

    // Add motivational closing
    const motivationalMessages = [
      "You've got this! 💪",
      "Every sale counts! 🎯",
      "Keep up the momentum! ⚡",
      "You're doing amazing! 🌟",
      "Success is in your hands! 🤝",
      "Believe in yourself! ✨",
      "Today's success starts now! 🚀",
      "You're unstoppable! 💫"
    ];
    
    const randomMessage = motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)];
    message += ` ${randomMessage}`;

    return this.createNotification({
      user_id: userId,
      store_id: storeId,
      type: 'daily_summary',
      title,
      message,
      data: salesData,
      priority,
      expires_in_hours: 48 // Daily summaries expire in 48 hours
    });
  }

  /**
   * Create goal reminder notification
   */
  static async createGoalReminderNotification(
    userId: string,
    storeId: string,
    goalType: 'daily' | 'monthly',
    currentValue: number,
    goalValue: number
  ): Promise<INotification> {
    const progress = (currentValue / goalValue) * 100;
    const remaining = goalValue - currentValue;

    let title = '';
    let message = '';
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

    if (goalType === 'daily') {
      title = '🎯 Daily Goal Reminder';
      message = `You're ${progress.toFixed(0)}% to your daily goal!`;
      
      if (remaining > 0) {
        message += ` Just ₺${remaining.toLocaleString()} more to reach ₺${goalValue.toLocaleString()}!`;
      }

      if (progress < 30) {
        message += ` Let's kick it into high gear! 🚀`;
        priority = 'high';
      } else if (progress < 60) {
        message += ` You're making good progress! 💪`;
      } else {
        message += ` You're so close! Keep pushing! 🔥`;
        priority = 'high';
      }
    } else {
      title = '📅 Monthly Goal Check-in';
      message = `Monthly progress: ${progress.toFixed(0)}% (₺${currentValue.toLocaleString()} of ₺${goalValue.toLocaleString()})`;
      
      if (progress < 50) {
        message += ` Let's ramp up this month! 📈`;
        priority = 'high';
      } else if (progress < 80) {
        message += ` Great momentum! Keep it going! ⚡`;
      } else {
        message += ` Almost there! Finish strong! 🏆`;
        priority = 'high';
      }
    }

    return this.createNotification({
      user_id: userId,
      store_id: storeId,
      type: 'goal_reminder',
      title,
      message,
      data: {
        goal_type: goalType,
        current_value: currentValue,
        goal_value: goalValue,
        progress_percentage: progress,
        remaining_value: remaining
      },
      priority,
      expires_in_hours: 12
    });
  }

  /**
   * Create achievement notification
   */
  static async createAchievementNotification(
    userId: string,
    storeId: string,
    achievementType: 'first_sale' | 'big_sale' | 'streak' | 'goal_reached',
    data: any
  ): Promise<INotification> {
    let title = '';
    let message = '';

    switch (achievementType) {
      case 'first_sale':
        title = '🎊 First Sale Complete!';
        message = `Congratulations on your first sale! Welcome to the world of success! 🚀`;
        break;

      case 'big_sale':
        title = '💰 Big Sale Achievement!';
        message = `Wow! You just made a ₺${data.sale_amount?.toLocaleString()} sale! That's incredible! 🌟`;
        break;

      case 'streak':
        title = `🔥 ${data.streak_days} Day Streak!`;
        message = `Amazing! You've hit your daily goals for ${data.streak_days} days in a row! You're unstoppable! 🏆`;
        break;

      case 'goal_reached':
        title = '🎯 Goal Achieved!';
        message = `Fantastic! You've reached your ${data.goal_type} goal! Time to celebrate and set new targets! 🎉`;
        break;
    }

    return this.createNotification({
      user_id: userId,
      store_id: storeId,
      type: 'achievement',
      title,
      message,
      data: {
        achievement_type: achievementType,
        ...data
      },
      priority: 'urgent',
      expires_in_hours: 72 // Achievements last longer
    });
  }

  /**
   * Get notifications for a user
   */
  static async getUserNotifications(
    userId: string,
    limit: number = 20,
    unreadOnly: boolean = false,
    type?: 'milestone' | 'daily_summary' | 'goal_reminder' | 'achievement' | 'system',
    page: number = 1
  ): Promise<INotification[]> {
    try {
      const query: any = { user_id: userId };
      
      if (unreadOnly) {
        query.is_read = false;
      }

      if (type) {
        query.type = type;
      }

      const skip = (page - 1) * limit;
      const notifications = await Notification.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return notifications as unknown as INotification[];
    } catch (error) {
      logger.error('Error getting user notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    try {
      const result = await Notification.updateOne(
        { _id: notificationId, user_id: userId },
        { $set: { is_read: true, updated_at: new Date() } }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string): Promise<number> {
    try {
      const result = await Notification.updateMany(
        { user_id: userId, is_read: false },
        { $set: { is_read: true, updated_at: new Date() } }
      );

      logger.info(`Marked ${result.modifiedCount} notifications as read for user ${userId}`);
      return result.modifiedCount;
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count
   */
  static async getUnreadCount(userId: string): Promise<number> {
    try {
      return await Notification.countDocuments({ 
        user_id: userId, 
        is_read: false 
      });
    } catch (error) {
      logger.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Delete old notifications
   */
  static async deleteOldNotifications(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      
      const result = await Notification.deleteMany({
        created_at: { $lt: cutoffDate }
      });

      logger.info(`Deleted ${result.deletedCount} old notifications`);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting old notifications:', error);
      throw error;
    }
  }

  /**
   * Clean up expired notifications
   */
  static async cleanupExpiredNotifications(): Promise<number> {
    try {
      const result = await Notification.deleteMany({
        expires_at: { $lt: new Date() }
      });

      logger.info(`Cleaned up ${result.deletedCount} expired notifications`);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error cleaning up expired notifications:', error);
      throw error;
    }
  }

  /**
   * Delete all notifications for a user
   */
  static async deleteAllNotifications(userId: string): Promise<number> {
    try {
      const result = await Notification.deleteMany({
        user_id: userId
      });

      logger.info(`Deleted ${result.deletedCount} notifications for user ${userId}`);
      return result.deletedCount;
    } catch (error) {
      logger.error('Error deleting all notifications:', error);
      throw error;
    }
  }

  /**
   * Delete notifications by type for a user
   */
  static async deleteNotificationsByType(userId: string, type: string): Promise<number> {
    try {
      const result = await Notification.deleteMany({
        user_id: userId,
        type: type
      });

      logger.info(`Deleted ${result.deletedCount} ${type} notifications for user ${userId}`);
      return result.deletedCount;
    } catch (error) {
      logger.error(`Error deleting ${type} notifications:`, error);
      throw error;
    }
  }
}
