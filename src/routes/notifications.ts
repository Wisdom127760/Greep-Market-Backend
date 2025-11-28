import { Router, Request, Response } from 'express';
import { robustAuthenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { NotificationService } from '../services/notificationService';
import { MilestoneService } from '../services/milestoneService';
import { SchedulerService } from '../services/schedulerService';
import { logger } from '../utils/logger';

const router = Router();

// All notification routes require authentication (with automatic token refresh support)
router.use(robustAuthenticate);

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const unreadOnly = req.query.unread_only === 'true';
    const type = (req.query.type as string) as any;
    const page = parseInt(req.query.page as string) || 1;

    const notifications = await NotificationService.getUserNotifications(
      userId,
      limit,
      unreadOnly,
      type,
      page
    );

    const unreadCount = await NotificationService.getUnreadCount(userId);

    res.json({
      success: true,
      data: {
        notifications,
        unread_count: unreadCount,
        total_returned: notifications.length,
        page,
        limit
      }
    });
  } catch (error) {
    logger.error('Error getting notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread-count', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const unreadCount = await NotificationService.getUnreadCount(userId);

    res.json({
      success: true,
      data: {
        unread_count: unreadCount
      }
    });
  } catch (error) {
    logger.error('Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const success = await NotificationService.markAsRead(id, userId);

    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or already read'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const updatedCount = await NotificationService.markAllAsRead(userId);

    res.json({
      success: true,
      message: `Marked ${updatedCount} notifications as read`,
      data: {
        updated_count: updatedCount
      }
    });
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   POST /api/v1/notifications/test-milestone
 * @desc    Test milestone notification (for development)
 * @access  Private
 */
router.post('/test-milestone', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req as any).user.storeId || 'default-store';
    const { milestone_type, milestone_value, goal_percentage } = req.body;

    if (!milestone_type || milestone_value === undefined) {
      return res.status(400).json({
        success: false,
        message: 'milestone_type and milestone_value are required'
      });
    }

    const notification = await NotificationService.createMilestoneNotification(
      userId,
      storeId,
      {
        milestone_type,
        milestone_value,
        goal_percentage
      }
    );

    res.json({
      success: true,
      message: 'Test milestone notification created',
      data: notification
    });
  } catch (error) {
    logger.error('Error creating test milestone notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test milestone notification',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   POST /api/v1/notifications/test-daily-summary
 * @desc    Test daily summary notification (for development)
 * @access  Private
 */
router.post('/test-daily-summary', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req as any).user.storeId || 'default-store';
    const salesData = req.body;

    const notification = await NotificationService.createDailySummaryNotification(
      userId,
      storeId,
      {
        total_sales: salesData.total_sales || 1500,
        transaction_count: salesData.transaction_count || 25,
        top_product: salesData.top_product || 'Popular Product',
        growth_percentage: salesData.growth_percentage || 15,
        daily_goal: salesData.daily_goal || 2000,
        monthly_goal: salesData.monthly_goal || 50000,
        daily_progress: salesData.daily_progress || 75,
        monthly_progress: salesData.monthly_progress || 45
      }
    );

    res.json({
      success: true,
      message: 'Test daily summary notification created',
      data: notification
    });
  } catch (error) {
    logger.error('Error creating test daily summary notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test daily summary notification',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   DELETE /api/v1/notifications/clear-all
 * @desc    Delete all notifications for the user
 * @access  Private
 */
router.delete('/clear-all', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const deletedCount = await NotificationService.deleteAllNotifications(userId);

    res.json({
      success: true,
      message: `Deleted ${deletedCount} notifications`,
      data: {
        deleted_count: deletedCount
      }
    });
  } catch (error) {
    logger.error('Error clearing all notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear notifications',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   DELETE /api/v1/notifications/clear-by-type/:type
 * @desc    Delete notifications by type for the user
 * @access  Private
 */
router.delete('/clear-by-type/:type', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { type } = req.params;

    // Validate notification type
    const validTypes = ['milestone', 'daily_summary', 'goal_reminder', 'achievement', 'system'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid notification type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const deletedCount = await NotificationService.deleteNotificationsByType(userId, type);

    res.json({
      success: true,
      message: `Deleted ${deletedCount} ${type} notifications`,
      data: {
        deleted_count: deletedCount,
        type: type
      }
    });
  } catch (error) {
    logger.error('Error clearing notifications by type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear notifications by type',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   POST /api/v1/notifications/reset-milestone-tracking
 * @desc    Reset milestone tracking data (fixes fake notifications issue)
 * @access  Private
 */
router.post('/reset-milestone-tracking', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req as any).user.storeId || 'default-store';

    await MilestoneService.resetMilestoneTracking(storeId, userId);

    res.json({
      success: true,
      message: 'Milestone tracking data reset successfully. This will prevent fake milestone notifications.',
      data: {
        store_id: storeId,
        user_id: userId
      }
    });
  } catch (error) {
    logger.error('Error resetting milestone tracking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset milestone tracking',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   GET /api/v1/notifications/milestone-tracking-status
 * @desc    Get milestone tracking status for debugging
 * @access  Private
 */
router.get('/milestone-tracking-status', asyncHandler(async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const storeId = (req as any).user.storeId || 'default-store';

    const trackingStatus = await MilestoneService.getMilestoneTrackingStatus(storeId, userId);

    res.json({
      success: true,
      data: {
        store_id: storeId,
        user_id: userId,
        tracking_records: trackingStatus
      }
    });
  } catch (error) {
    logger.error('Error getting milestone tracking status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get milestone tracking status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   POST /api/v1/notifications/disable-scheduler
 * @desc    Disable scheduler to prevent fake notifications
 * @access  Private
 */
router.post('/disable-scheduler', asyncHandler(async (req: Request, res: Response) => {
  try {
    const { disable_milestones, disable_daily_summaries } = req.body;

    if (disable_milestones) {
      SchedulerService.disableMilestoneChecks();
    }

    if (disable_daily_summaries) {
      SchedulerService.disableDailySummaries();
    }

    const status = SchedulerService.getStatus();

    res.json({
      success: true,
      message: 'Scheduler tasks disabled successfully',
      data: {
        scheduler_status: status,
        disabled_milestones: disable_milestones || false,
        disabled_daily_summaries: disable_daily_summaries || false
      }
    });
  } catch (error) {
    logger.error('Error disabling scheduler:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable scheduler',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

/**
 * @route   GET /api/v1/notifications/scheduler-status
 * @desc    Get scheduler status
 * @access  Private
 */
router.get('/scheduler-status', asyncHandler(async (req: Request, res: Response) => {
  try {
    const status = SchedulerService.getStatus();

    res.json({
      success: true,
      data: {
        scheduler_status: status,
        message: 'Check the status of each scheduled task'
      }
    });
  } catch (error) {
    logger.error('Error getting scheduler status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduler status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

export default router;
