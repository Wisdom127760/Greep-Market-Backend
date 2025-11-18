import { Product } from '../models/Product';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { ExpenseService } from './expenseService';
import { logger } from '../utils/logger';
import { cache, cacheKeys, cacheConfig } from '../config/redis';
import { 
  parseDateRange, 
  getStoreTimezone, 
  getTodayRange, 
  getThisMonthRange, 
  getLastNDaysRange,
  debugTimezoneInfo,
  formatDateForTimezone
} from '../utils/timezone';

export interface DashboardFilters {
  dateRange?: string;
  paymentMethod?: string;
  orderSource?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface DashboardMetrics {
  totalSales: number;
  totalTransactions: number;
  averageTransactionValue: number;
  growthRate: number;
  salesVsYesterday: number;
  expensesVsYesterday: number;
  profitVsYesterday: number;
  transactionsVsYesterday: number;
  totalProducts: number;
  lowStockItems: number;
  todaySales: number;
  monthlySales: number;
  totalExpenses: number;
  monthlyExpenses: number;
  netProfit: number;
  paymentMethods?: { [method: string]: number };
  orderSources?: { [source: string]: number };
  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }>;
  recentTransactions: Array<{
    id: string;
    totalAmount: number;
    paymentMethod: string;
    orderSource?: string;
    createdAt: Date;
  }>;
  salesByMonth: Array<{
    month: string;
    sales: number;
    transactions: number;
    onlineSales: number;
    inStoreSales: number;
  }>;
  salesByPeriod?: Array<{
    period: string;
    revenue: number;
    transactions: number;
  }>;
  expensesByPeriod?: Array<{
    period: string;
    amount: number;
    count: number;
  }>;
}

export interface SalesAnalytics {
  totalRevenue: number;
  totalTransactions: number;
  averageTransactionValue: number;
  salesByPeriod: Array<{
    period: string;
    revenue: number;
    transactions: number;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }>;
  paymentMethodBreakdown: Array<{
    method: string;
    count: number;
    amount: number;
  }>;
}

export interface ProductAnalytics {
  totalProducts: number;
  activeProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  topSellingProducts: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    count: number;
    totalValue: number;
  }>;
}

export interface InventoryAnalytics {
  totalInventoryValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  stockAlerts: Array<{
    productId: string;
    productName: string;
    currentStock: number;
    minStockLevel: number;
    alertType: 'low_stock' | 'out_of_stock';
  }>;
  categoryStock: Array<{
    category: string;
    totalStock: number;
    totalValue: number;
  }>;
}

export class AnalyticsService {
  private static normalizePaymentMethod(method?: string): string {
    const key = (method || 'unknown').toString().trim().toLowerCase();
    switch (key) {
      case 'card':
      case 'pos':
      case 'bank_card':
      case 'debit_card':
      case 'credit_card':
        return 'pos';
      case 'transfer':
      case 'naira_transfer':
      case 'bank_transfer':
        return 'naira_transfer';
      case 'crypto':
      case 'crypto_payment':
        return 'crypto_payment';
      case 'cash_on_delivery':
      case 'cod':
      case 'cash':
        return 'cash';
      default:
        return key || 'unknown';
    }
  }
  /**
   * Get dashboard metrics with filtering support
   */
  static async getDashboardMetrics(storeId?: string, filters?: DashboardFilters): Promise<DashboardMetrics> {
    try {
      // Debug logging
      logger.info('Dashboard metrics request:', { storeId, filters });
      
      // Create cache key based on store and filters
      const cacheKey = cacheKeys.analytics(storeId || 'default', 'dashboard', JSON.stringify(filters || {}));
      
      // Try to get from cache first (5 minute TTL for dashboard metrics)
      try {
        const cachedMetrics = await cache.get<DashboardMetrics>(cacheKey);
        if (cachedMetrics) {
          logger.info('Dashboard metrics served from cache');
          return cachedMetrics;
        }
      } catch (cacheError) {
        logger.warn('Cache read failed, proceeding with database query:', cacheError);
      }
      
      // Log the date filter that will be applied
      const storeTimezone = getStoreTimezone(storeId);
      const dateFilter = this.getDateFilter(filters, storeTimezone);
      logger.info('Date filter applied:', { dateFilter, filters, timezone: storeTimezone });
      
      // Build base query filters
      const productFilter = storeId ? { store_id: storeId } : {};
      let transactionFilter: any = storeId ? { store_id: storeId } : {};

      // Apply filters
      if (filters) {
        // Apply status filter
        if (filters.status && filters.status !== 'all') {
          transactionFilter.status = filters.status;
        } else {
          transactionFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending
        }

        // Apply payment method filter
        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          transactionFilter.payment_method = filters.paymentMethod;
        }

        // Note: order_source filter is not available in current Transaction model
        // This can be added later if needed

        // Apply date range filter
        const dateFilter = this.getDateFilter(filters, storeTimezone);
        if (dateFilter) {
          transactionFilter.created_at = dateFilter;
          logger.info('Applied timezone-aware date filter:', { dateFilter, transactionFilter, timezone: storeTimezone });
        }
      } else {
        transactionFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending
      }

      // Get timezone-aware date ranges for today/monthly calculations
      const todayRange = getTodayRange(storeTimezone);
      const monthRange = getThisMonthRange(storeTimezone);

      // Create separate filters for today and monthly calculations
      // Today filter: use the applied date filter (for "today" this will be today's range)
      // Monthly filter: always use the full month range for monthly calculations
      const todayFilter = transactionFilter; // Use the filtered date range
      const monthlyFilter = { ...transactionFilter, created_at: { $gte: monthRange.start } }; // Always use full month for monthly data

      // Get expense data - use same date filtering as transactions
      let expenseStartDate, expenseEndDate;
      if (filters && (filters.startDate || filters.endDate)) {
        // Custom date range - use the provided dates directly
        if (filters.startDate) {
          // Parse in timezone if string, otherwise use as-is
          expenseStartDate = typeof filters.startDate === 'string'
            ? parseDateRange(filters.startDate, filters.startDate, storeTimezone)?.start || new Date(filters.startDate)
            : filters.startDate;
        } else {
          expenseStartDate = monthRange.start;
        }
        
        if (filters.endDate) {
          expenseEndDate = typeof filters.endDate === 'string'
            ? parseDateRange(filters.endDate, filters.endDate, storeTimezone)?.end || new Date(filters.endDate)
            : filters.endDate;
          // Ensure endDate is end of day in local timezone
          expenseEndDate.setHours(23, 59, 59, 999);
        } else {
          expenseEndDate = monthRange.end;
        }
        
        logger.info('Using custom date range for expense data:', {
          storeId,
          originalStartDate: filters.startDate,
          originalEndDate: filters.endDate,
          parsedStartDate: expenseStartDate?.toISOString(),
          parsedEndDate: expenseEndDate?.toISOString(),
          timezone: storeTimezone
        });
      } else if (filters && filters.dateRange) {
        // Predefined date range - use getDateFilter
        const dateFilter = this.getDateFilter(filters, storeTimezone);
        if (dateFilter) {
          expenseStartDate = dateFilter.$gte;
          expenseEndDate = dateFilter.$lte;
        } else {
          // Fallback to current month range to match default charts
          expenseStartDate = monthRange.start;
          expenseEndDate = monthRange.end;
        }
      } else {
        // No filter provided: use a broader range to show historical expense data
        // This ensures expense trends are visible even without specific date filters
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        expenseStartDate = thirtyDaysAgo;
        expenseEndDate = new Date();
      }
      
      // Debug logging for filters
      logger.info('Filter breakdown:', { 
        timezone: storeTimezone,
        todayFilter, 
        monthlyFilter, 
        expenseStartDate: expenseStartDate?.toISOString(), 
        expenseEndDate: expenseEndDate?.toISOString(),
        todayRange: {
          start: todayRange.start.toISOString(),
          end: todayRange.end.toISOString()
        },
        monthRange: {
          start: monthRange.start.toISOString(),
          end: monthRange.end.toISOString()
        }
      });
      
      const expenseStats = await ExpenseService.getExpenseStats(storeId, expenseStartDate, expenseEndDate);
      const expenseSeries = await ExpenseService.getExpenseSeries(expenseStartDate, expenseEndDate, storeId);
      
      // Debug logging for expense data
      logger.info('Expense data debug:', {
        expenseStartDate: expenseStartDate?.toISOString(),
        expenseEndDate: expenseEndDate?.toISOString(),
        expenseStats: {
          totalExpenses: expenseStats.totalExpenses,
          totalAmount: expenseStats.totalAmount
        },
        expenseSeriesLength: expenseSeries.length,
        expenseSeries: expenseSeries.slice(0, 5) // Show first 5 entries for debugging
      });
        
      // Monthly expenses should always use monthly date range
      const monthlyExpenseStats = await ExpenseService.getExpenseStats(storeId, monthRange.start, monthRange.end);

      // Optimized parallel queries using aggregations for better performance
      const [
        productStats,
        transactionStats,
        recentTransactions,
        topProductsData
      ] = await Promise.all([
        // Single aggregation for all product metrics
        Product.aggregate([
          { $match: productFilter },
          {
            $group: {
              _id: null,
              totalProducts: { $sum: 1 },
              lowStockProducts: {
                $sum: {
                  $cond: [
                    { $lte: ['$stock_quantity', '$min_stock_level'] },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ]),
        
        // Single aggregation for all transaction metrics
        Transaction.aggregate([
          {
            $facet: {
              // Total filtered transactions
              totalStats: [
                { $match: transactionFilter },
                {
                  $group: {
                    _id: null,
                    totalSales: { $sum: '$total_amount' },
                    totalTransactions: { $sum: 1 }
                  }
                }
              ],
              // Today's transactions
              todayStats: [
                { $match: todayFilter },
                {
                  $group: {
                    _id: null,
                    todaySales: { $sum: '$total_amount' },
                    todayTransactions: { $sum: 1 }
                  }
                }
              ],
              // Monthly transactions
              monthlyStats: [
                { $match: monthlyFilter },
                {
                  $group: {
                    _id: null,
                    monthlySales: { $sum: '$total_amount' },
                    monthlyTransactions: { $sum: 1 }
                  }
                }
              ]
            }
          }
        ]),
        
        // Recent transactions (optimized with projection)
        Transaction.find(transactionFilter)
          .select('_id total_amount payment_method created_at')
          .sort({ created_at: -1 })
          .limit(10)
          .lean(),
          
        // Top products
        this.getTopProducts(storeId, 5, filters)
      ]);

      // Extract aggregated results
      const productData = productStats[0] || { totalProducts: 0, lowStockProducts: 0 };
      const transactionData = transactionStats[0];
      
      const totalSales = transactionData.totalStats[0] || { totalSales: 0, totalTransactions: 0 };
      const todaySales = transactionData.todayStats[0] || { todaySales: 0, todayTransactions: 0 };
      const monthlySales = transactionData.monthlyStats[0] || { monthlySales: 0, monthlyTransactions: 0 };
      
      const averageTransactionValue = totalSales.totalTransactions > 0 
        ? totalSales.totalSales / totalSales.totalTransactions 
        : 0;

      // Calculate growth rate (current period vs previous period)
      const growthRate = await this.calculateGrowthRate(storeId, filters);
      
      // Calculate vs yesterday metrics
      const vsYesterdayMetrics = await this.calculateVsYesterdayMetrics(storeId, filters);

      // Get sales data based on the filter period
      // If custom date range is provided (startDate/endDate), use daily aggregation
      // Otherwise use predefined periods or monthly data
      let salesByPeriodData;
      if (filters && (filters.startDate || filters.endDate)) {
        // Custom date range - use timezone-aware date parsing
        // Parse dates in store timezone to ensure correct date range
        let startDate: Date;
        let endDate: Date;
        
        if (filters.startDate) {
          // If date string, parse in timezone; if Date object, use as-is
          startDate = typeof filters.startDate === 'string' 
            ? parseDateRange(filters.startDate, filters.startDate, storeTimezone)?.start || new Date(filters.startDate)
            : filters.startDate;
        } else {
          startDate = monthRange.start;
        }
        
        if (filters.endDate) {
          endDate = typeof filters.endDate === 'string'
            ? parseDateRange(filters.endDate, filters.endDate, storeTimezone)?.end || new Date(filters.endDate)
            : filters.endDate;
          // Ensure endDate is end of day in local timezone
          endDate.setHours(23, 59, 59, 999);
        } else {
          endDate = monthRange.end;
        }
        
        logger.info('Using custom date range for sales data:', {
          storeId,
          originalStartDate: filters.startDate,
          originalEndDate: filters.endDate,
          parsedStartDate: startDate.toISOString(),
          parsedEndDate: endDate.toISOString(),
          startDateLocal: startDate.toLocaleString(),
          endDateLocal: endDate.toLocaleString(),
          timezone: storeTimezone
        });
        
        const salesAnalytics = await this.getSalesAnalyticsByDateRange(storeId, startDate, endDate);
        salesByPeriodData = salesAnalytics.salesByPeriod;
      } else if (filters && filters.dateRange) {
        // Use the appropriate period-based sales data for predefined periods
        salesByPeriodData = await this.getSalesByPeriod(storeId, filters.dateRange);
      } else {
        // Default to monthly data for unfiltered dashboard
        salesByPeriodData = null; // Will use salesByMonth instead
      }

      // Calculate expense totals
      const totalExpenses = expenseStats.totalAmount;
      const monthlyExpenses = monthlyExpenseStats.totalAmount;

      // Get proper sales by month data with online/in-store breakdown
      const salesByMonthData = await this.getSalesByMonth(storeId, filters);

      // Calculate payment methods breakdown from ALL transactions (not just recent ones)
      const paymentMethodsAggregation = await Transaction.aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: '$payment_method',
            totalAmount: { $sum: '$total_amount' }
          }
        }
      ]);
      
      // Normalize and collapse aliases into unified buckets
      const paymentMethodsData: { [method: string]: number } = {};
      paymentMethodsAggregation.forEach(item => {
        const normalized = this.normalizePaymentMethod(item._id);
        paymentMethodsData[normalized] = (paymentMethodsData[normalized] || 0) + (item.totalAmount || 0);
      });

      // Calculate order sources breakdown from ALL transactions (not just recent ones)
      const orderSourcesAggregation = await Transaction.aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: '$order_source',
            totalAmount: { $sum: '$total_amount' }
          }
        }
      ]);
      
      const orderSourcesData: { [source: string]: number } = {};
      orderSourcesAggregation.forEach(item => {
        const source = item._id || 'in-store'; // Default to 'in-store' if null/undefined
        orderSourcesData[source] = item.totalAmount;
      });

      // Build optimized result
      const dashboardMetrics: DashboardMetrics = {
        totalSales: totalSales.totalSales,
        totalTransactions: totalSales.totalTransactions,
        averageTransactionValue,
        growthRate,
        salesVsYesterday: vsYesterdayMetrics.salesVsYesterday,
        expensesVsYesterday: vsYesterdayMetrics.expensesVsYesterday,
        profitVsYesterday: vsYesterdayMetrics.profitVsYesterday,
        transactionsVsYesterday: vsYesterdayMetrics.transactionsVsYesterday,
        totalProducts: productData.totalProducts,
        lowStockItems: productData.lowStockProducts,
        todaySales: todaySales.todaySales,
        monthlySales: monthlySales.monthlySales,
        totalExpenses,
        monthlyExpenses,
        netProfit: totalSales.totalSales - totalExpenses,
        topProducts: topProductsData,
        paymentMethods: paymentMethodsData,
        orderSources: orderSourcesData,
        recentTransactions: recentTransactions.map(t => ({
          id: t._id.toString(),
          totalAmount: t.total_amount,
          paymentMethod: t.payment_method,
          createdAt: t.created_at
        })),
        salesByMonth: salesByMonthData,
        // Expose sales by period (daily/weekly) for charts when custom date range is used
        salesByPeriod: salesByPeriodData || undefined,
        // Expose expense series for charts expecting daily values
        expensesByPeriod: expenseSeries
      };

      // Cache the result (5 minute TTL for dashboard metrics)
      try {
        await cache.set(cacheKey, dashboardMetrics, 300); // 5 minutes
        logger.info('Dashboard metrics cached successfully');
      } catch (cacheError) {
        logger.warn('Failed to cache dashboard metrics:', cacheError);
      }

      return dashboardMetrics;
    } catch (error) {
      logger.error('Error getting dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Get sales analytics for a specific date range
   */
  static async getSalesAnalyticsByDateRange(
    storeId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<SalesAnalytics> {
    try {
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] },
        created_at: {
          $gte: startDate,
          $lte: endDate
        }
      };

      const [transactions, totalRevenue, totalTransactions] = await Promise.all([
        Transaction.find(query).sort({ created_at: -1 }).lean(),
        Transaction.aggregate([
          { $match: query },
          { $group: { _id: null, total: { $sum: '$total_amount' } } }
        ]),
        Transaction.countDocuments(query)
      ]);

      const revenue = totalRevenue[0]?.total || 0;
      const transactionCount = totalTransactions || 0;
      const averageTransactionValue = transactionCount > 0 ? revenue / transactionCount : 0;

      // Get sales by period (daily for custom ranges, monthly for longer ranges)
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      let salesByPeriod: Array<{ period: string; revenue: number; transactions: number }> = [];
      
      const timezone = getStoreTimezone(storeId);

      if (daysDiff <= 31) {
        // Daily breakdown - use timezone-aware MongoDB aggregation
        const dailyAggregation = await Transaction.aggregate([
          { $match: query },
          {
            $group: {
              _id: {
                // Format date as YYYY-MM-DD in local timezone
                dateString: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$created_at',
                    timezone: timezone
                  }
                }
              },
              revenue: { $sum: '$total_amount' },
              transactions: { $sum: 1 }
            }
          },
          { $sort: { '_id.dateString': 1 } },
          {
            $project: {
              _id: 0,
              period: '$_id.dateString',
              revenue: 1,
              transactions: 1
            }
          }
        ]);

        // Create a map of actual data
        const salesMap = new Map<string, { revenue: number; transactions: number }>();
        dailyAggregation.forEach(item => {
          salesMap.set(item.period, { revenue: item.revenue, transactions: item.transactions });
        });

        // Fill in all days in the range (with zeros for days without transactions)
        // Use timezone-aware date calculations to ensure correct date boundaries
        // Convert dates to timezone-aware local dates to avoid timezone shifts
        const startInTimezone = new Date(startDate.toLocaleString('en-US', { timeZone: timezone }));
        const endInTimezone = new Date(endDate.toLocaleString('en-US', { timeZone: timezone }));
        
        const startLocal = new Date(startInTimezone.getFullYear(), startInTimezone.getMonth(), startInTimezone.getDate());
        const endLocal = new Date(endInTimezone.getFullYear(), endInTimezone.getMonth(), endInTimezone.getDate());
        const cursor = new Date(startLocal);

        while (cursor <= endLocal) {
          // Format date in timezone for period key
          const periodKey = formatDateForTimezone(cursor, timezone);
          const data = salesMap.get(periodKey) || { revenue: 0, transactions: 0 };
          
          salesByPeriod.push({
            period: periodKey,
            revenue: data.revenue,
            transactions: data.transactions
          });
          
          cursor.setDate(cursor.getDate() + 1);
        }

        logger.info('Daily sales aggregation result:', {
          storeId,
          timezone,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          daysInRange: daysDiff,
          periodsReturned: salesByPeriod.length,
          periodsWithData: salesByPeriod.filter(p => p.revenue > 0 || p.transactions > 0).length,
          samplePeriods: salesByPeriod.slice(0, 5).map(p => ({ period: p.period, revenue: p.revenue, transactions: p.transactions }))
        });
      } else {
        // Monthly breakdown - use timezone-aware MongoDB aggregation
        const monthlyAggregation = await Transaction.aggregate([
          { $match: query },
          {
            $group: {
              _id: {
                // Format date as YYYY-MM in local timezone
                monthString: {
                  $dateToString: {
                    format: '%Y-%m',
                    date: '$created_at',
                    timezone: timezone
                  }
                }
              },
              revenue: { $sum: '$total_amount' },
              transactions: { $sum: 1 }
            }
          },
          { $sort: { '_id.monthString': 1 } },
          {
            $project: {
              _id: 0,
              period: '$_id.monthString',
              revenue: 1,
              transactions: 1
            }
          }
        ]);

        // Create a map of actual data
        const salesMap = new Map<string, { revenue: number; transactions: number }>();
        monthlyAggregation.forEach(item => {
          salesMap.set(item.period, { revenue: item.revenue, transactions: item.transactions });
        });

        // Fill in all months in the range (with zeros for months without transactions)
        // Use timezone-aware date calculations
        const startInTimezone = new Date(startDate.toLocaleString('en-US', { timeZone: timezone }));
        const endInTimezone = new Date(endDate.toLocaleString('en-US', { timeZone: timezone }));
        
        const current = new Date(startInTimezone.getFullYear(), startInTimezone.getMonth(), 1);
        const endMonth = new Date(endInTimezone.getFullYear(), endInTimezone.getMonth() + 1, 0, 23, 59, 59);
        
        while (current <= endMonth) {
          const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
          const data = salesMap.get(monthKey) || { revenue: 0, transactions: 0 };
          
          salesByPeriod.push({
            period: monthKey,
            revenue: data.revenue,
            transactions: data.transactions
          });
          
          current.setMonth(current.getMonth() + 1);
        }
      }

      // Get top products for the period
      const topProducts = await Transaction.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product_id',
            productName: { $first: '$items.name' },
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 }
      ]);

      // Get payment method breakdown
      const paymentBreakdown = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: { $ifNull: ['$payment_method', 'Unknown'] },
            count: { $sum: 1 },
            totalAmount: { $sum: '$total_amount' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      return {
        totalRevenue: revenue,
        totalTransactions: transactionCount,
        averageTransactionValue,
        salesByPeriod,
        topProducts: topProducts.map(p => ({
          productId: p._id,
          productName: p.productName,
          quantitySold: p.quantitySold,
          revenue: p.revenue
        })),
        paymentMethodBreakdown: paymentBreakdown.map(p => ({
          method: p._id,
          count: p.count,
          amount: p.totalAmount
        }))
      };
    } catch (error) {
      logger.error('Error getting sales analytics by date range:', error);
      throw error;
    }
  }

  /**
   * Get sales analytics
   */
  static async getSalesAnalytics(storeId?: string, period?: string): Promise<SalesAnalytics> {
    try {
      const filter = storeId ? { store_id: storeId, status: { $in: ['completed', 'pending'] } } : { status: { $in: ['completed', 'pending'] } };

      // Get date range based on period
      let dateFilter = {};
      if (period === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        dateFilter = { created_at: { $gte: startOfDay } };
      } else if (period === 'week' || period === '7d') {
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - 7);
        dateFilter = { created_at: { $gte: startOfWeek } };
      } else if (period === 'month' || period === '30d') {
        const startOfMonth = new Date();
        startOfMonth.setDate(startOfMonth.getDate() - 30);
        dateFilter = { created_at: { $gte: startOfMonth } };
      } else if (period === '90d') {
        const startOfPeriod = new Date();
        startOfPeriod.setDate(startOfPeriod.getDate() - 90);
        dateFilter = { created_at: { $gte: startOfPeriod } };
      } else if (period === 'year') {
        const startOfYear = new Date();
        startOfYear.setFullYear(startOfYear.getFullYear() - 1);
        dateFilter = { created_at: { $gte: startOfYear } };
      }

      const transactions = await Transaction.find({ ...filter, ...dateFilter });

      const totalRevenue = transactions.reduce((sum, t) => sum + t.total_amount, 0);
      const totalTransactions = transactions.length;
      const averageTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      // Get sales by period
      const salesByPeriod = await this.getSalesByPeriod(storeId, period);

      // Get top products
      const topProducts = await this.getTopProducts(storeId, 10);

      // Get payment method breakdown
      const paymentMethodBreakdown = await Transaction.aggregate([
        { $match: { ...filter, ...dateFilter } },
        { $group: { 
          _id: { $ifNull: ['$payment_method', 'Unknown'] }, 
          count: { $sum: 1 }, 
          amount: { $sum: '$total_amount' } 
        }},
        { $project: { 
          method: '$_id', 
          count: 1, 
          amount: 1, 
          _id: 0 
        }},
        { $sort: { count: -1 } }
      ]);

      return {
        totalRevenue,
        totalTransactions,
        averageTransactionValue,
        salesByPeriod,
        topProducts,
        paymentMethodBreakdown
      };
    } catch (error) {
      logger.error('Error getting sales analytics:', error);
      throw error;
    }
  }

  /**
   * Get product analytics for a specific date range
   */
  static async getProductAnalyticsByDateRange(
    storeId: string, 
    startDate: Date, 
    endDate: Date,
    limit: number = 10
  ): Promise<ProductAnalytics> {
    try {
      const filter = { store_id: storeId };
      
      // Get products created in the date range
      const productFilter = {
        ...filter,
        created_at: {
          $gte: startDate,
          $lte: endDate
        }
      };

      const [
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        topSellingProducts,
        categoryBreakdown
      ] = await Promise.all([
        Product.countDocuments(productFilter),
        Product.countDocuments({ ...productFilter, is_active: true }),
        Product.aggregate([
          { $match: filter },
          { $addFields: {
            isLowStock: {
              $and: [
                { $lte: ['$stock_quantity', { $ifNull: ['$min_stock_level', 5] }] },
                { $gt: ['$stock_quantity', 0] }
              ]
            }
          }},
          { $match: { isLowStock: true } },
          { $count: 'count' }
        ]).then(result => result[0]?.count || 0),
        Product.find({
          ...filter,
          stock_quantity: 0
        }).countDocuments(),
        Transaction.aggregate([
          {
            $match: {
              store_id: storeId,
              status: { $in: ['completed', 'pending'] },
              created_at: { $gte: startDate, $lte: endDate }
            }
          },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product_id',
              productName: { $first: '$items.product_name' },
              quantitySold: { $sum: '$items.quantity' },
              revenue: { $sum: { $multiply: ['$items.quantity', '$items.unit_price'] } }
            }
          },
          { $sort: { revenue: -1 } },
          { $limit: limit }
        ]),
        Product.aggregate([
          { $match: productFilter },
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 },
              totalValue: { $sum: { $multiply: ['$price', '$stock_quantity'] } }
            }
          }
        ])
      ]);

      return {
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        topSellingProducts: topSellingProducts.map(p => ({
          productId: p._id,
          productName: p.productName,
          quantitySold: p.quantitySold,
          revenue: p.revenue
        })),
        categoryBreakdown: categoryBreakdown.map(c => ({
          category: c._id,
          count: c.count,
          totalValue: c.totalValue
        }))
      };
    } catch (error) {
      logger.error('Error getting product analytics by date range:', error);
      throw error;
    }
  }

  /**
   * Get product analytics
   */
  static async getProductAnalytics(storeId?: string): Promise<ProductAnalytics> {
    try {
      const filter = storeId ? { store_id: storeId } : {};

      const [
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        categoryBreakdown
      ] = await Promise.all([
        Product.countDocuments(filter),
        Product.countDocuments({ ...filter, is_active: true }),
        Product.aggregate([
          { $match: filter },
          { $addFields: {
            isLowStock: {
              $and: [
                { $lte: ['$stock_quantity', { $ifNull: ['$min_stock_level', 5] }] },
                { $gt: ['$stock_quantity', 0] }
              ]
            }
          }},
          { $match: { isLowStock: true } },
          { $count: 'count' }
        ]).then(result => result[0]?.count || 0),
        Product.countDocuments({ ...filter, stock_quantity: 0 }),
        Product.aggregate([
          { $match: filter },
          { $group: { 
            _id: '$category', 
            count: { $sum: 1 }, 
            totalValue: { $sum: { $multiply: ['$price', '$stock_quantity'] } }
          }},
          { $project: { 
            category: '$_id', 
            count: 1, 
            totalValue: 1, 
            _id: 0 
          }}
        ])
      ]);

      const topSellingProducts = await this.getTopProducts(storeId, 10);

      return {
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        topSellingProducts,
        categoryBreakdown
      };
    } catch (error) {
      logger.error('Error getting product analytics:', error);
      throw error;
    }
  }

  /**
   * Get filtered transactions for dashboard
   */
  static async getFilteredTransactions(storeId?: string, filters?: DashboardFilters, limit: number = 50): Promise<any[]> {
    try {
      let transactionFilter: any = storeId ? { store_id: storeId } : {};
      
      // Apply filters
      if (filters) {
        // Apply status filter
        if (filters.status && filters.status !== 'all') {
          transactionFilter.status = filters.status;
        } else {
          transactionFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending
        }

        // Apply payment method filter
        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          transactionFilter.payment_method = filters.paymentMethod;
        }

        // Note: order_source filter is not available in current Transaction model
        // This can be added later if needed

        // Apply date range filter
        const timezone = getStoreTimezone(storeId);
        const dateFilter = this.getDateFilter(filters, timezone);
        if (dateFilter) {
          transactionFilter.created_at = dateFilter;
        }
      } else {
        transactionFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending
      }

      const transactions = await Transaction.find(transactionFilter)
        .sort({ created_at: -1 })
        .limit(limit)
        .select('_id total_amount payment_method status created_at customer_id items')
        .lean();

      return transactions.map(t => ({
        id: t._id.toString(),
        totalAmount: t.total_amount,
        paymentMethod: t.payment_method,
        status: t.status,
        createdAt: t.created_at,
        customerId: t.customer_id,
        itemCount: t.items?.length || 0
      }));
    } catch (error) {
      logger.error('Error getting filtered transactions:', error);
      return [];
    }
  }

  /**
   * Get inventory analytics
   */
  static async getInventoryAnalytics(storeId?: string): Promise<InventoryAnalytics> {
    try {
      const filter = storeId ? { store_id: storeId } : {};

      const products = await Product.find(filter);
      
      const totalInventoryValue = products.reduce((sum, p) => sum + (p.price * p.stock_quantity), 0);
      
      const lowStockItems = products.filter(p => p.stock_quantity <= p.min_stock_level && p.stock_quantity > 0).length;
      const outOfStockItems = products.filter(p => p.stock_quantity === 0).length;

      const stockAlerts = products
        .filter(p => p.stock_quantity <= p.min_stock_level)
        .map(p => ({
          productId: p._id.toString(),
          productName: p.name,
          currentStock: p.stock_quantity,
          minStockLevel: p.min_stock_level,
          alertType: p.stock_quantity === 0 ? 'out_of_stock' as const : 'low_stock' as const
        }));

      const categoryStock = await Product.aggregate([
        { $match: filter },
        { $group: { 
          _id: '$category', 
          totalStock: { $sum: '$stock_quantity' }, 
          totalValue: { $sum: { $multiply: ['$price', '$stock_quantity'] } }
        }},
        { $project: { 
          category: '$_id', 
          totalStock: 1, 
          totalValue: 1, 
          _id: 0 
        }}
      ]);

      return {
        totalInventoryValue,
        lowStockItems,
        outOfStockItems,
        stockAlerts,
        categoryStock
      };
    } catch (error) {
      logger.error('Error getting inventory analytics:', error);
      throw error;
    }
  }

  /**
   * Get timezone-aware date filter based on filters
   */
  private static getDateFilter(filters?: DashboardFilters, timezone: string = 'Europe/Istanbul'): any {
    if (!filters) return null;

    // If date range is provided, prioritize it over custom dates
    if (filters.dateRange) {
      switch (filters.dateRange) {
        case 'today': {
          const todayRange = getTodayRange(timezone);
          return {
            $gte: todayRange.start,
            $lte: todayRange.end
          };
        }
        case 'this_month': {
          const monthRange = getThisMonthRange(timezone);
          return {
            $gte: monthRange.start,
            $lte: monthRange.end
          };
        }
        case '7d': {
          const weekRange = getLastNDaysRange(7, timezone);
          return {
            $gte: weekRange.start,
            $lte: weekRange.end
          };
        }
        case '30d': {
          const monthRange = getLastNDaysRange(30, timezone);
          return {
            $gte: monthRange.start,
            $lte: monthRange.end
          };
        }
        case '90d': {
          const quarterRange = getLastNDaysRange(90, timezone);
          return {
            $gte: quarterRange.start,
            $lte: quarterRange.end
          };
        }
        case '1y': {
          const yearRange = getLastNDaysRange(365, timezone);
          return {
            $gte: yearRange.start,
            $lte: yearRange.end
          };
        }
        default:
          return null;
      }
    }

    // If custom date range is provided, parse with timezone awareness
    if (filters.startDate && filters.endDate) {
      // Handle both Date objects and string dates
      let startDateStr: string;
      let endDateStr: string;
      
      if (filters.startDate instanceof Date) {
        startDateStr = filters.startDate.toISOString().split('T')[0];
      } else if (typeof filters.startDate === 'string') {
        startDateStr = filters.startDate;
      } else {
        return null;
      }
      
      if (filters.endDate instanceof Date) {
        endDateStr = filters.endDate.toISOString().split('T')[0];
      } else if (typeof filters.endDate === 'string') {
        endDateStr = filters.endDate;
      } else {
        return null;
      }
      
      const dateRange = parseDateRange(startDateStr, endDateStr, timezone);
      if (dateRange) {
        return {
          $gte: dateRange.start,
          $lte: dateRange.end
        };
      }
    }

    return null;
  }

  /**
   * Get top selling products
   */
  public static async getTopProducts(storeId?: string, limit: number = 10, filters?: DashboardFilters): Promise<any[]> {
    try {
      logger.info('getTopProducts called with:', { storeId, limit, filters });
      let matchFilter: any = storeId ? { store_id: storeId } : {};
      
      // Apply filters
      if (filters) {
        // Apply status filter
        if (filters.status && filters.status !== 'all') {
          matchFilter.status = filters.status;
        } else {
          matchFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending by default
        }

        // Apply payment method filter
        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          matchFilter.payment_method = filters.paymentMethod;
        }

        // Apply order source filter
        if (filters.orderSource && filters.orderSource !== 'all') {
          matchFilter.order_source = filters.orderSource;
        }

        // Apply date range filter
        const timezone = getStoreTimezone(storeId);
        const dateFilter = this.getDateFilter(filters, timezone);
        if (dateFilter) {
          matchFilter.created_at = dateFilter;
        }
      } else {
        matchFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending by default
      }
      
      logger.info('getTopProducts final matchFilter:', matchFilter);
      
      const topProducts = await Transaction.aggregate([
        { $match: matchFilter },
        { $unwind: '$items' },
        { $group: { 
          _id: '$items.product_id', 
          productName: { $first: '$items.product_name' },
          quantitySold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.quantity', '$items.unit_price'] } }
        }},
        { $sort: { revenue: -1 } },
        { $limit: limit },
        { $project: { 
          productId: '$_id', 
          productName: 1, 
          quantitySold: 1, 
          revenue: 1, 
          _id: 0 
        }}
      ]);
      
      logger.info('getTopProducts aggregation result:', { count: topProducts.length, products: topProducts });

      return topProducts;
    } catch (error) {
      logger.error('Error getting top products:', error);
      return [];
    }
  }

  /**
   * Get sales by month
   * Always returns the last 12 months for chart display, regardless of date filters
   * Date filters apply to summary metrics but not to historical chart data
   */
  private static async getSalesByMonth(storeId?: string, filters?: DashboardFilters): Promise<any[]> {
    try {
      const timezone = getStoreTimezone(storeId);
      
      // Always use last 12 months for chart display (regardless of date filters)
      // This ensures historical trends are visible even when filtering by date range
      // Use timezone-aware date calculation to ensure correct date ranges
      const now = new Date();
      const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      
      // Calculate 12 months ago in the store's timezone
      const twelveMonthsAgo = new Date(nowInTimezone);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      twelveMonthsAgo.setDate(1); // Start of that month
      twelveMonthsAgo.setHours(0, 0, 0, 0);
      
      // Ensure end date is end of today in the store's timezone
      const endDate = new Date(nowInTimezone);
      endDate.setHours(23, 59, 59, 999);
      
      let matchFilter: any = storeId ? { store_id: storeId } : {};
      
      // Always include date range for last 12 months (for chart display)
      // Use timezone-aware date ranges to ensure correct historical data
      matchFilter.created_at = {
        $gte: twelveMonthsAgo,
        $lte: endDate
      };
      
      // Apply other filters (status, payment method, order source)
      if (filters) {
        // Apply status filter
        if (filters.status && filters.status !== 'all') {
          matchFilter.status = filters.status;
        } else {
          matchFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending by default
        }

        // Apply payment method filter
        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          matchFilter.payment_method = filters.paymentMethod;
        }

        // Apply order source filter
        if (filters.orderSource && filters.orderSource !== 'all') {
          matchFilter.order_source = filters.orderSource;
        }
      } else {
        matchFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending by default
      }
      
      // Use timezone-aware date grouping (like expenses)
      const salesByMonth = await Transaction.aggregate([
        { $match: matchFilter },
        { $group: { 
          _id: { 
            // Format date as YYYY-MM in local timezone first
            monthString: {
              $dateToString: {
                format: '%Y-%m',
                date: '$created_at',
                timezone: timezone
              }
            }
          }, 
          sales: { $sum: '$total_amount' },
          transactions: { $sum: 1 },
          onlineSales: { 
            $sum: { 
              $cond: [
                { $eq: ['$order_source', 'online'] },
                '$total_amount',
                0
              ]
            }
          },
          inStoreSales: { 
            $sum: { 
              $cond: [
                { $or: [
                  { $eq: ['$order_source', 'in-store'] },
                  { $eq: ['$order_source', null] },
                  { $eq: ['$order_source', undefined] }
                ]},
                '$total_amount',
                0
              ]
            }
          }
        }},
        { $sort: { '_id.monthString': 1 } },
        { $project: { 
          month: '$_id.monthString', // Use YYYY-MM format
          sales: 1, 
          transactions: 1,
          onlineSales: 1,
          inStoreSales: 1,
          _id: 0 
        }}
      ]);

      logger.info('getSalesByMonth result:', {
        storeId,
        timezone,
        dateRange: {
          start: twelveMonthsAgo.toISOString(),
          end: endDate.toISOString()
        },
        startLocal: twelveMonthsAgo.toLocaleString('en-US', { timeZone: timezone }),
        endLocal: endDate.toLocaleString('en-US', { timeZone: timezone }),
        monthsReturned: salesByMonth.length,
        months: salesByMonth.map(m => m.month)
      });

      return salesByMonth;
    } catch (error) {
      logger.error('Error getting sales by month:', error);
      return [];
    }
  }

  /**
   * Calculate percentage change vs yesterday for each metric
   */
  private static async calculateVsYesterdayMetrics(storeId?: string, filters?: DashboardFilters): Promise<{
    salesVsYesterday: number;
    expensesVsYesterday: number;
    profitVsYesterday: number;
    transactionsVsYesterday: number;
  }> {
    try {
      const timezone = getStoreTimezone(storeId);
      
      // Get today and yesterday date ranges
      const todayRange = getTodayRange(timezone);
      const yesterday = new Date(todayRange.start);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayEnd = new Date(todayRange.end);
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

      let baseFilter: any = storeId ? { store_id: storeId } : {};
      
      // Apply filters
      if (filters) {
        if (filters.status && filters.status !== 'all') {
          baseFilter.status = filters.status;
        } else {
          baseFilter.status = { $in: ['completed', 'pending'] };
        }

        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          baseFilter.payment_method = filters.paymentMethod;
        }

        if (filters.orderSource && filters.orderSource !== 'all') {
          baseFilter.order_source = filters.orderSource;
        }
      } else {
        baseFilter.status = 'completed';
      }

      // Get today's data
      const [todaySales, todayTransactions, todayExpenses] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: todayRange.start, $lte: todayRange.end } } },
          { $group: { _id: null, total: { $sum: '$total_amount' } } }
        ]),
        Transaction.countDocuments({ ...baseFilter, created_at: { $gte: todayRange.start, $lte: todayRange.end } }),
        // Get today's expenses
        ExpenseService.getExpensesByDateRange(todayRange.start, todayRange.end, storeId)
      ]);

      // Get yesterday's data
      const [yesterdaySales, yesterdayTransactions, yesterdayExpenses] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: yesterday, $lte: yesterdayEnd } } },
          { $group: { _id: null, total: { $sum: '$total_amount' } } }
        ]),
        Transaction.countDocuments({ ...baseFilter, created_at: { $gte: yesterday, $lte: yesterdayEnd } }),
        // Get yesterday's expenses
        ExpenseService.getExpensesByDateRange(yesterday, yesterdayEnd, storeId)
      ]);

      const todaySalesTotal = todaySales[0]?.total || 0;
      const yesterdaySalesTotal = yesterdaySales[0]?.total || 0;
      const todayExpensesTotal = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const yesterdayExpensesTotal = yesterdayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const todayTransactionsCount = todayTransactions;
      const yesterdayTransactionsCount = yesterdayTransactions;
      
      const todayProfit = todaySalesTotal - todayExpensesTotal;
      const yesterdayProfit = yesterdaySalesTotal - yesterdayExpensesTotal;

      // Calculate percentage changes
      const salesVsYesterday = this.calculatePercentageChange(yesterdaySalesTotal, todaySalesTotal);
      const expensesVsYesterday = this.calculatePercentageChange(yesterdayExpensesTotal, todayExpensesTotal);
      const profitVsYesterday = this.calculatePercentageChange(yesterdayProfit, todayProfit);
      const transactionsVsYesterday = this.calculatePercentageChange(yesterdayTransactionsCount, todayTransactionsCount);

      return {
        salesVsYesterday,
        expensesVsYesterday,
        profitVsYesterday,
        transactionsVsYesterday
      };
    } catch (error) {
      logger.error('Error calculating vs yesterday metrics:', error);
      return {
        salesVsYesterday: 0,
        expensesVsYesterday: 0,
        profitVsYesterday: 0,
        transactionsVsYesterday: 0
      };
    }
  }

  /**
   * Calculate percentage change between two values
   */
  private static calculatePercentageChange(oldValue: number, newValue: number): number {
    if (oldValue === 0) {
      return newValue > 0 ? 100 : 0;
    }
    
    const percentageChange = ((newValue - oldValue) / oldValue) * 100;
    return Math.round(percentageChange * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate growth rate (current period vs previous period)
   */
  private static async calculateGrowthRate(storeId?: string, filters?: DashboardFilters): Promise<number> {
    try {
      const timezone = getStoreTimezone(storeId);
      let currentPeriodStart: Date;
      let previousPeriodStart: Date;
      let previousPeriodEnd: Date;

      // Determine period based on filters
      if (filters?.dateRange) {
        const days = this.getDaysFromDateRange(filters.dateRange);
        const currentRange = getLastNDaysRange(days, timezone);
        const previousRange = getLastNDaysRange(days * 2, timezone);
        
        currentPeriodStart = currentRange.start;
        previousPeriodStart = previousRange.start;
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
      } else {
        // Default to monthly comparison
        const monthRange = getThisMonthRange(timezone);
        const lastMonth = new Date(monthRange.start);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthEnd = new Date(monthRange.start.getTime() - 1);
        
        currentPeriodStart = monthRange.start;
        previousPeriodStart = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
        previousPeriodEnd = lastMonthEnd;
      }

      let baseFilter: any = storeId ? { store_id: storeId } : {};
      
      // Apply filters
      if (filters) {
        // Apply status filter
        if (filters.status && filters.status !== 'all') {
          baseFilter.status = filters.status;
        } else {
          baseFilter.status = { $in: ['completed', 'pending'] }; // Include both completed and pending by default
        }

        // Apply payment method filter
        if (filters.paymentMethod && filters.paymentMethod !== 'all') {
          baseFilter.payment_method = filters.paymentMethod;
        }

        // Apply order source filter
        if (filters.orderSource && filters.orderSource !== 'all') {
          baseFilter.order_source = filters.orderSource;
        }
      } else {
        baseFilter.status = 'completed'; // Default to completed
      }

      const [currentPeriodSales, previousPeriodSales] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: currentPeriodStart } } },
          { $group: { _id: null, total: { $sum: '$total_amount' } } }
        ]),
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: previousPeriodStart, $lte: previousPeriodEnd } } },
          { $group: { _id: null, total: { $sum: '$total_amount' } } }
        ])
      ]);

      const currentTotal = currentPeriodSales[0]?.total || 0;
      const previousTotal = previousPeriodSales[0]?.total || 0;

      if (previousTotal === 0) {
        return currentTotal > 0 ? 100 : 0; // 100% growth if no previous data but current exists
      }

      const growthRate = ((currentTotal - previousTotal) / previousTotal) * 100;
      return Math.round(growthRate * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      logger.error('Error calculating growth rate:', error);
      return 0;
    }
  }

  /**
   * Get number of days from date range string
   */
  private static getDaysFromDateRange(dateRange: string): number {
    switch (dateRange) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      default: return 30;
    }
  }

  /**
   * Get sales by period
   */
  private static async getSalesByPeriod(storeId?: string, period?: string): Promise<any[]> {
    try {
      const timezone = getStoreTimezone(storeId);
      let matchFilter: any = storeId ? { store_id: storeId, status: { $in: ['completed', 'pending'] } } : { status: { $in: ['completed', 'pending'] } };

      let dateFormat = '%Y-%m';
      let fillMissingDays = false;
      let dateRange: { start: Date; end: Date } | null = null;

      switch (period) {
        case 'today': {
          dateRange = getTodayRange(timezone);
          dateFormat = '%Y-%m-%d %H:00';
          break;
        }
        case 'week':
        case '7d': {
          dateRange = getLastNDaysRange(7, timezone);
          dateFormat = '%Y-%m-%d';
          fillMissingDays = true;
          break;
        }
        case 'month':
        case '30d': {
          dateRange = getLastNDaysRange(30, timezone);
          dateFormat = '%Y-%m-%d';
          fillMissingDays = true;
          break;
        }
        case '90d': {
          dateRange = getLastNDaysRange(90, timezone);
          dateFormat = '%Y-%m-%d';
          fillMissingDays = true;
          break;
        }
        case '1y': {
          dateRange = getLastNDaysRange(365, timezone);
          dateFormat = '%Y-%m';
          break;
        }
        default: {
          dateRange = getLastNDaysRange(30, timezone);
          dateFormat = '%Y-%m';
        }
      }

      if (dateRange) {
        matchFilter.created_at = {
          $gte: dateRange.start,
          $lte: dateRange.end
        };
      }

      const aggregated = await Transaction.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: {
              periodString: {
                $dateToString: {
                  format: dateFormat,
                  date: '$created_at',
                  timezone
                }
              }
            },
            revenue: { $sum: '$total_amount' },
            transactions: { $sum: 1 }
          }
        },
        { $sort: { '_id.periodString': 1 } },
        {
          $project: {
            _id: 0,
            period: '$_id.periodString',
            revenue: 1,
            transactions: 1
          }
        }
      ]);

      if (!fillMissingDays || !dateRange) {
        return aggregated;
      }

      const resultsMap = new Map(aggregated.map(item => [item.period, item]));
      const filled: Array<{ period: string; revenue: number; transactions: number }> = [];

      const startLocal = new Date(dateRange.start.getFullYear(), dateRange.start.getMonth(), dateRange.start.getDate());
      const endLocal = new Date(dateRange.end.getFullYear(), dateRange.end.getMonth(), dateRange.end.getDate());
      const cursor = new Date(startLocal);

      while (cursor <= endLocal) {
        const periodKey = formatDateForTimezone(cursor, timezone);
        const existingEntry = resultsMap.get(periodKey);
        const entry: { period: string; revenue: number; transactions: number } = existingEntry ? {
          period: existingEntry.period,
          revenue: existingEntry.revenue,
          transactions: existingEntry.transactions
        } : { period: periodKey, revenue: 0, transactions: 0 };
        filled.push(entry);
        cursor.setDate(cursor.getDate() + 1);
      }

      return filled;
    } catch (error) {
      logger.error('Error getting sales by period:', error);
      return [];
    }
  }
}
