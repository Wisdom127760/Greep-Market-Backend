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
  getMonthYearRange,
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
  month?: number; // Month number (1-12)
  year?: number; // Year (e.g., 2025)
}

export interface DashboardMetrics {
  totalSales: number;
  totalTransactions: number;
  averageTransactionValue: number;
  growthRate: number;
  salesVsPreviousPeriod?: number;
  expensesVsPreviousPeriod?: number;
  profitVsPreviousPeriod?: number;
  transactionsVsPreviousPeriod?: number;
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
      // Create cache key based on store and filters
      const cacheKey = cacheKeys.analytics(storeId || 'default', 'dashboard', JSON.stringify(filters || {}));
      
      // Try to get from cache first (5 minute TTL for dashboard metrics)
      try {
        const cachedMetrics = await cache.get<DashboardMetrics>(cacheKey);
        if (cachedMetrics) {
          return cachedMetrics;
        }
      } catch (cacheError) {
        // Cache read failed, proceed with database query
      }
      
      // ============================================================================
      // STEP 1: Get the PRIMARY date range - this will be used for ALL metrics
      // ============================================================================
      const storeTimezone = getStoreTimezone(storeId);
      const primaryDateFilter = this.getDateFilter(filters, storeTimezone);
      
      // Determine the primary date range (used for sales, expenses, transactions, profit)
      let primaryStartDate: Date;
      let primaryEndDate: Date;
      
      if (primaryDateFilter) {
        primaryStartDate = primaryDateFilter.$gte;
        primaryEndDate = primaryDateFilter.$lte;
      } else {
        // No date filter - use last 30 days as default
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        primaryStartDate = thirtyDaysAgo;
        primaryEndDate = new Date();
      }
      
      // ============================================================================
      // STEP 2: Build transaction filter with the PRIMARY date range
      // ============================================================================
      const productFilter = storeId ? { store_id: storeId } : {};
      let transactionFilter: any = storeId ? { store_id: storeId } : {};

      // Apply status filter
      if (filters?.status && filters.status !== 'all') {
        transactionFilter.status = filters.status;
      } else {
        transactionFilter.status = { $in: ['completed', 'pending'] };
      }

      // Apply payment method filter
      if (filters?.paymentMethod && filters.paymentMethod !== 'all') {
        transactionFilter.payment_method = filters.paymentMethod;
      }

      // Apply the PRIMARY date filter
      transactionFilter.created_at = {
        $gte: primaryStartDate,
        $lte: primaryEndDate
      };

      // ============================================================================
      // STEP 3: Get date ranges for "today" and "monthly" calculations
      // ============================================================================
      const todayRange = getTodayRange(storeTimezone);
      
      // For monthly calculations: use selected month/year OR current month
      let monthRange;
      if (filters?.month && filters?.year) {
        monthRange = getMonthYearRange(filters.month, filters.year, storeTimezone);
      } else {
        monthRange = getThisMonthRange(storeTimezone);
      }
      
      // Today filter (for todaySales metric)
      const todayFilter = {
        ...transactionFilter,
        created_at: {
          $gte: todayRange.start,
          $lte: todayRange.end
        }
      };
      
      // Monthly filter (for monthlySales metric)
      const monthlyFilter = {
        ...transactionFilter,
        created_at: {
          $gte: monthRange.start,
          $lte: monthRange.end
        }
      };

      // ============================================================================
      // STEP 4: Get expenses using the SAME PRIMARY date range
      // ============================================================================
      const expenseStats = await ExpenseService.getExpenseStats(storeId, primaryStartDate, primaryEndDate);
      const expenseSeries = await ExpenseService.getExpenseSeries(primaryStartDate, primaryEndDate, storeId);
      const monthlyExpenseStats = await ExpenseService.getExpenseStats(storeId, monthRange.start, monthRange.end);

      // Calculate expense totals (needed for vsPreviousPeriodMetrics calculation)
      const totalExpenses = expenseStats.totalAmount;

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
              // Total filtered transactions - SIMPLIFIED AND FIXED
              totalStats: [
                { $match: transactionFilter },
                {
                  $group: {
                    _id: null,
                    totalSales: { 
                      $sum: {
                        $cond: [
                          { $and: [
                            { $ne: ['$total_amount', null] },
                            { $ne: ['$total_amount', undefined] }
                          ]},
                          { $toDouble: '$total_amount' },
                          0
                        ]
                      }
                    },
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
                    todaySales: { 
                      $sum: {
                        $cond: [
                          { $and: [
                            { $ne: ['$total_amount', null] },
                            { $ne: ['$total_amount', undefined] }
                          ]},
                          { $toDouble: '$total_amount' },
                          0
                        ]
                      }
                    },
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
                    monthlySales: { 
                      $sum: {
                        $cond: [
                          { $and: [
                            { $ne: ['$total_amount', null] },
                            { $ne: ['$total_amount', undefined] }
                          ]},
                          { $toDouble: '$total_amount' },
                          0
                        ]
                      }
                    },
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
      
      // Safely extract results with defaults
      const totalSales = transactionData?.totalStats?.[0] || { totalSales: 0, totalTransactions: 0 };
      const todaySales = transactionData?.todayStats?.[0] || { todaySales: 0, todayTransactions: 0 };
      const monthlySales = transactionData?.monthlyStats?.[0] || { monthlySales: 0, monthlyTransactions: 0 };
      
      // Ensure values are numbers
      totalSales.totalSales = Number(totalSales.totalSales) || 0;
      totalSales.totalTransactions = Number(totalSales.totalTransactions) || 0;
      todaySales.todaySales = Number(todaySales.todaySales) || 0;
      todaySales.todayTransactions = Number(todaySales.todayTransactions) || 0;
      monthlySales.monthlySales = Number(monthlySales.monthlySales) || 0;
      monthlySales.monthlyTransactions = Number(monthlySales.monthlyTransactions) || 0;
      
      // Critical check: If we have transactions but no sales, something is wrong
      if (totalSales.totalTransactions > 0 && totalSales.totalSales === 0) {
        logger.error('CRITICAL ERROR: Transactions found but sales = 0!', {
          transactionCount: totalSales.totalTransactions,
          totalSales: totalSales.totalSales,
          filter: JSON.stringify(transactionFilter),
          dateRange: {
            start: primaryStartDate.toISOString(),
            end: primaryEndDate.toISOString()
          }
        });
        
        // Query sample transactions to debug
        try {
          const sampleTransactions = await Transaction.find(transactionFilter)
            .select('_id total_amount created_at status')
            .limit(5)
            .lean();
          logger.error('Sample transactions:', {
            count: sampleTransactions.length,
            samples: sampleTransactions.map(t => ({
              id: t._id,
              total_amount: t.total_amount,
              total_amount_type: typeof t.total_amount,
              created_at: t.created_at
            }))
          });
        } catch (sampleError) {
          logger.error('Error fetching sample transactions:', sampleError);
        }
      }
      
      const averageTransactionValue = totalSales.totalTransactions > 0 
        ? totalSales.totalSales / totalSales.totalTransactions 
        : 0;

      // Calculate growth rate (current period vs previous period)
      const growthRate = await this.calculateGrowthRate(storeId, filters);
      
      // Calculate vs previous period metrics for all metrics
      const vsPreviousPeriodMetrics = await this.calculateVsPreviousPeriodMetrics(storeId, filters, totalSales.totalSales, totalSales.totalTransactions, totalExpenses);
      
      // Calculate vs yesterday metrics
      const vsYesterdayMetrics = await this.calculateVsYesterdayMetrics(storeId, filters);

      // Get sales data based on the filter period
      // USE THE PRIMARY DATE RANGE for consistency
      let salesByPeriodData;
      
      // If we have a primary date range (from month/year or custom dates), use it
      if (primaryDateFilter) {
        // Use the PRIMARY date range for salesByPeriod to ensure consistency
        const salesAnalytics = await this.getSalesAnalyticsByDateRange(storeId, primaryStartDate, primaryEndDate);
        salesByPeriodData = salesAnalytics.salesByPeriod;
        
      } else if (filters && filters.dateRange) {
        // Use the appropriate period-based sales data for predefined periods
        salesByPeriodData = await this.getSalesByPeriod(storeId, filters.dateRange);
      } else {
        // Default to monthly data for unfiltered dashboard
        salesByPeriodData = null; // Will use salesByMonth instead
      }

      // Calculate monthly expense total
      const monthlyExpenses = monthlyExpenseStats.totalAmount;

      // Get proper sales by month data with online/in-store breakdown
      const salesByMonthData = await this.getSalesByMonth(storeId, filters);

      // Calculate payment methods breakdown from filtered transactions
      const paymentMethodsAggregation = await Transaction.aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: '$payment_method',
            totalAmount: { 
              $sum: {
                $cond: [
                  { $and: [
                    { $ne: ['$total_amount', null] },
                    { $ne: ['$total_amount', undefined] }
                  ]},
                  { $toDouble: '$total_amount' },
                  0
                ]
              }
            }
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
            totalAmount: { 
              $sum: {
                $cond: [
                  { $and: [
                    { $ne: ['$total_amount', null] },
                    { $ne: ['$total_amount', undefined] }
                  ]},
                  { $toDouble: '$total_amount' },
                  0
                ]
              }
            }
          }
        }
      ]);
      
      const orderSourcesData: { [source: string]: number } = {};
      orderSourcesAggregation.forEach(item => {
        const source = item._id || 'in-store'; // Default to 'in-store' if null/undefined
        orderSourcesData[source] = item.totalAmount;
      });

      // Build optimized result - ENSURE ALL VALUES ARE NUMBERS
      const dashboardMetrics: DashboardMetrics = {
        totalSales: Number(totalSales.totalSales) || 0,
        totalTransactions: Number(totalSales.totalTransactions) || 0,
        averageTransactionValue: Number(averageTransactionValue) || 0,
        growthRate: Number(growthRate) || 0,
        salesVsPreviousPeriod: vsPreviousPeriodMetrics.salesVsPreviousPeriod,
        expensesVsPreviousPeriod: vsPreviousPeriodMetrics.expensesVsPreviousPeriod,
        profitVsPreviousPeriod: vsPreviousPeriodMetrics.profitVsPreviousPeriod,
        transactionsVsPreviousPeriod: vsPreviousPeriodMetrics.transactionsVsPreviousPeriod,
        salesVsYesterday: vsYesterdayMetrics.salesVsYesterday,
        expensesVsYesterday: vsYesterdayMetrics.expensesVsYesterday,
        profitVsYesterday: vsYesterdayMetrics.profitVsYesterday,
        transactionsVsYesterday: vsYesterdayMetrics.transactionsVsYesterday,
        totalProducts: productData.totalProducts,
        lowStockItems: productData.lowStockProducts,
        todaySales: todaySales.todaySales,
        monthlySales: monthlySales.monthlySales,
        totalExpenses: Number(totalExpenses) || 0,
        monthlyExpenses: Number(monthlyExpenses) || 0,
        netProfit: Number(totalSales.totalSales) - Number(totalExpenses),
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
        // Expose sales by period (daily/weekly) for charts - uses PRIMARY date range
        salesByPeriod: salesByPeriodData || undefined,
        // Expose expense series for charts expecting daily values - uses PRIMARY date range
        expensesByPeriod: expenseSeries,
        // DEBUG: Include the date range used for transparency
        _filterInfo: {
          dateRange: {
            start: primaryStartDate.toISOString(),
            end: primaryEndDate.toISOString()
          },
          filters: {
            month: filters?.month,
            year: filters?.year,
            dateRange: filters?.dateRange
          }
        }
      };

      // Cache the result (5 minute TTL for dashboard metrics)
      try {
        await cache.set(cacheKey, dashboardMetrics, 300); // 5 minutes
      } catch (cacheError) {
        // Failed to cache, continue without caching
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

    // If month and year are provided, use them to create a date range
    // This takes priority over dateRange but can be overridden by explicit startDate/endDate
    if (filters.month && filters.year && !filters.startDate && !filters.endDate) {
      try {
        const monthYearRange = getMonthYearRange(filters.month, filters.year, timezone);
        return {
          $gte: monthYearRange.start,
          $lte: monthYearRange.end
        };
      } catch (error) {
        logger.error('Error creating month/year range:', error);
        // Fall through to other filter options
      }
    }

    // If date range is provided, prioritize it over custom dates (unless month/year was used)
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
      let currentPeriodEnd: Date;
      let previousPeriodStart: Date;
      let previousPeriodEnd: Date;

      // Determine period based on filters
      if (filters?.startDate && filters?.endDate) {
        // Custom date range provided - calculate previous period of same duration
        currentPeriodStart = filters.startDate instanceof Date ? filters.startDate : new Date(filters.startDate);
        currentPeriodEnd = filters.endDate instanceof Date ? filters.endDate : new Date(filters.endDate);
        
        // Calculate the duration of the current period
        const periodDurationMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
        
        // Calculate previous period (same duration, ending just before current period starts)
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
        previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodDurationMs);
      } else if (filters?.dateRange) {
        // Predefined date range (7d, 30d, etc.)
        const days = this.getDaysFromDateRange(filters.dateRange);
        const currentRange = getLastNDaysRange(days, timezone);
        const previousRange = getLastNDaysRange(days * 2, timezone);
        
        currentPeriodStart = currentRange.start;
        currentPeriodEnd = currentRange.end;
        previousPeriodStart = previousRange.start;
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
      } else {
        // Default to monthly comparison
        const monthRange = getThisMonthRange(timezone);
        const lastMonth = new Date(monthRange.start);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthEnd = new Date(monthRange.start.getTime() - 1);
        
        currentPeriodStart = monthRange.start;
        currentPeriodEnd = monthRange.end;
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
        baseFilter.status = { $in: ['completed', 'pending'] }; // Default to both completed and pending
      }

      const [currentPeriodSales, previousPeriodSales] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: currentPeriodStart, $lte: currentPeriodEnd } } },
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
   * Calculate vs previous period metrics for all metrics (sales, expenses, profit, transactions)
   */
  private static async calculateVsPreviousPeriodMetrics(
    storeId?: string,
    filters?: DashboardFilters,
    currentSales: number = 0,
    currentTransactions: number = 0,
    currentExpenses: number = 0
  ): Promise<{
    salesVsPreviousPeriod: number;
    expensesVsPreviousPeriod: number;
    profitVsPreviousPeriod: number;
    transactionsVsPreviousPeriod: number;
  }> {
    try {
      const timezone = getStoreTimezone(storeId);
      let currentPeriodStart: Date;
      let currentPeriodEnd: Date;
      let previousPeriodStart: Date;
      let previousPeriodEnd: Date;

      // Determine period based on filters (same logic as calculateGrowthRate)
      if (filters?.month && filters?.year) {
        // Month/year filter - compare to previous month
        const currentMonthRange = getMonthYearRange(filters.month, filters.year, timezone);
        currentPeriodStart = currentMonthRange.start;
        currentPeriodEnd = currentMonthRange.end;
        
        // Calculate previous month
        let previousMonth = filters.month - 1;
        let previousYear = filters.year;
        
        // Handle January (month 1) - go to December of previous year
        if (previousMonth < 1) {
          previousMonth = 12;
          previousYear = filters.year - 1;
        }
        
        const previousMonthRange = getMonthYearRange(previousMonth, previousYear, timezone);
        previousPeriodStart = previousMonthRange.start;
        previousPeriodEnd = previousMonthRange.end;
      } else {
            start: currentPeriodStart.toISOString(),
            end: currentPeriodEnd.toISOString()
          },
          previousPeriod: {
            start: previousPeriodStart.toISOString(),
            end: previousPeriodEnd.toISOString()
          }
        });
      } else if (filters?.startDate && filters?.endDate) {
        // Custom date range provided - calculate previous period of same duration
        currentPeriodStart = filters.startDate instanceof Date ? filters.startDate : new Date(filters.startDate);
        currentPeriodEnd = filters.endDate instanceof Date ? filters.endDate : new Date(filters.endDate);
        
        // Calculate the duration of the current period
        const periodDurationMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
        
        // Calculate previous period (same duration, ending just before current period starts)
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
        previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodDurationMs);
      } else if (filters?.dateRange) {
        // Predefined date range (7d, 30d, etc.)
        const days = this.getDaysFromDateRange(filters.dateRange);
        const currentRange = getLastNDaysRange(days, timezone);
        const previousRange = getLastNDaysRange(days * 2, timezone);
        
        currentPeriodStart = currentRange.start;
        currentPeriodEnd = currentRange.end;
        previousPeriodStart = previousRange.start;
        previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1);
      } else {
        // Default to monthly comparison
        const monthRange = getThisMonthRange(timezone);
        const lastMonth = new Date(monthRange.start);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthEnd = new Date(monthRange.start.getTime() - 1);
        
        currentPeriodStart = monthRange.start;
        currentPeriodEnd = monthRange.end;
        previousPeriodStart = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
        previousPeriodEnd = lastMonthEnd;
      }

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
        baseFilter.status = { $in: ['completed', 'pending'] };
      }

      // Get previous period data for transactions and expenses
      const [previousPeriodTransactions, previousPeriodExpenses] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...baseFilter, created_at: { $gte: previousPeriodStart, $lte: previousPeriodEnd } } },
          {
            $group: {
              _id: null,
              totalSales: { $sum: '$total_amount' },
              totalTransactions: { $sum: 1 }
            }
          }
        ]),
        ExpenseService.getExpenseStats(storeId, previousPeriodStart, previousPeriodEnd)
      ]);

      const previousSales = previousPeriodTransactions[0]?.totalSales || 0;
      const previousTransactions = previousPeriodTransactions[0]?.totalTransactions || 0;
      const previousExpenses = previousPeriodExpenses.totalAmount || 0;
      const previousProfit = previousSales - previousExpenses;
      const currentProfit = currentSales - currentExpenses;

      // Calculate percentage changes
      const salesVsPreviousPeriod = this.calculatePercentageChange(previousSales, currentSales);
      const expensesVsPreviousPeriod = this.calculatePercentageChange(previousExpenses, currentExpenses);
      const profitVsPreviousPeriod = this.calculatePercentageChange(previousProfit, currentProfit);
      const transactionsVsPreviousPeriod = this.calculatePercentageChange(previousTransactions, currentTransactions);

      return {
        salesVsPreviousPeriod,
        expensesVsPreviousPeriod,
        profitVsPreviousPeriod,
        transactionsVsPreviousPeriod
      };
    } catch (error) {
      logger.error('Error calculating vs previous period metrics:', error);
      return {
        salesVsPreviousPeriod: 0,
        expensesVsPreviousPeriod: 0,
        profitVsPreviousPeriod: 0,
        transactionsVsPreviousPeriod: 0
      };
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

  /**
   * Get sales by day of week
   */
  static async getSalesByDayOfWeek(storeId?: string, startDate?: Date, endDate?: Date): Promise<Array<{
    day: string;
    revenue: number;
    transactions: number;
  }>> {
    try {
      const timezone = getStoreTimezone(storeId);
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      const aggregation = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $dayOfWeek: {
                date: '$created_at',
                timezone: timezone
              }
            },
            revenue: { $sum: '$total_amount' },
            transactions: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Create a map for quick lookup
      const salesMap = new Map<number, { revenue: number; transactions: number }>();
      aggregation.forEach(item => {
        // MongoDB dayOfWeek returns 1-7 (Sunday=1, Monday=2, etc.)
        salesMap.set(item._id, { revenue: item.revenue, transactions: item.transactions });
      });

      // Return all days of week, filling in zeros for days without sales
      return dayNames.map((day, index) => {
        const dayOfWeek = index + 1; // Sunday = 1, Monday = 2, etc.
        const data = salesMap.get(dayOfWeek) || { revenue: 0, transactions: 0 };
        return {
          day,
          revenue: data.revenue,
          transactions: data.transactions
        };
      });
    } catch (error) {
      logger.error('Error getting sales by day of week:', error);
      return [];
    }
  }

  /**
   * Get sales by hour of day
   */
  static async getSalesByHourOfDay(storeId?: string, startDate?: Date, endDate?: Date): Promise<Array<{
    hour: number;
    revenue: number;
    transactions: number;
  }>> {
    try {
      const timezone = getStoreTimezone(storeId);
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      const aggregation = await Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $hour: {
                date: '$created_at',
                timezone: timezone
              }
            },
            revenue: { $sum: '$total_amount' },
            transactions: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Create a map for quick lookup
      const salesMap = new Map<number, { revenue: number; transactions: number }>();
      aggregation.forEach(item => {
        salesMap.set(item._id, { revenue: item.revenue, transactions: item.transactions });
      });

      // Return all 24 hours, filling in zeros for hours without sales
      return Array.from({ length: 24 }, (_, hour) => {
        const data = salesMap.get(hour) || { revenue: 0, transactions: 0 };
        return {
          hour,
          revenue: data.revenue,
          transactions: data.transactions
        };
      });
    } catch (error) {
      logger.error('Error getting sales by hour of day:', error);
      return [];
    }
  }

  /**
   * Get sales by category
   */
  static async getSalesByCategory(storeId?: string, startDate?: Date, endDate?: Date): Promise<Array<{
    category: string;
    revenue: number;
    quantity: number;
    transactions: number;
    percentage: number;
  }>> {
    try {
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      // First, get total revenue for percentage calculation
      const totalRevenueResult = await Transaction.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$total_amount' } } }
      ]);
      const totalRevenue = totalRevenueResult[0]?.total || 0;

      // Get sales by category by joining with products
      const categorySales = await Transaction.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            let: { productId: '$items.product_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: '$_id' }, '$$productId']
                  }
                }
              }
            ],
            as: 'product'
          }
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              $cond: {
                if: { $and: [{ $ne: ['$product', null] }, { $ne: ['$product.category', null] }, { $ne: ['$product.category', ''] }] },
                then: '$product.category',
                else: 'Uncategorized'
              }
            },
            revenue: { $sum: '$items.total_price' },
            quantity: { $sum: '$items.quantity' },
            transactions: { $addToSet: '$_id' }
          }
        },
        {
          $project: {
            category: '$_id',
            revenue: 1,
            quantity: 1,
            transactions: { $size: '$transactions' },
            _id: 0
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      // Calculate percentage for each category
      return categorySales.map(category => ({
        ...category,
        percentage: totalRevenue > 0 ? (category.revenue / totalRevenue) * 100 : 0
      }));
    } catch (error) {
      logger.error('Error getting sales by category:', error);
      return [];
    }
  }

  /**
   * Get most profitable products by margin
   */
  static async getMostProfitableProducts(
    storeId?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10
  ): Promise<Array<{
    productId: string;
    productName: string;
    revenue: number;
    profitMargin: number;
    avgPricePerSale: number;
    transactions: number;
    quantitySold: number;
  }>> {
    try {
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      const profitableProducts = await Transaction.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product_id',
            productName: { $first: '$items.product_name' },
            revenue: { $sum: '$items.total_price' },
            quantitySold: { $sum: '$items.quantity' },
            transactions: { $addToSet: '$_id' },
            avgUnitPrice: { $avg: '$items.unit_price' }
          }
        },
        {
          $addFields: {
            avgPricePerSale: {
              $cond: {
                if: { $gt: ['$quantitySold', 0] },
                then: { $divide: ['$revenue', '$quantitySold'] },
                else: 0
              }
            },
            profitMargin: {
              // Calculate margin as (revenue per unit / avg unit price) * 100
              // This gives a percentage indicating how much revenue is generated per unit price
              $cond: {
                if: { $and: [{ $gt: ['$quantitySold', 0] }, { $gt: ['$avgUnitPrice', 0] }] },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        { $divide: ['$revenue', '$quantitySold'] },
                        '$avgUnitPrice'
                      ]
                    },
                    100
                  ]
                },
                else: 0
              }
            }
          }
        },
        { $sort: { profitMargin: -1 } },
        { $limit: limit },
        {
          $project: {
            productId: '$_id',
            productName: 1,
            revenue: 1,
            profitMargin: { $round: ['$profitMargin', 2] },
            avgPricePerSale: { $round: ['$avgPricePerSale', 2] },
            transactions: { $size: '$transactions' },
            quantitySold: 1,
            _id: 0
          }
        }
      ]);

      return profitableProducts;
    } catch (error) {
      logger.error('Error getting most profitable products:', error);
      return [];
    }
  }

  /**
   * Get worst performers (products with stock but no sales)
   */
  static async getWorstPerformers(
    storeId?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 20
  ): Promise<Array<{
    productId: string;
    productName: string;
    category: string;
    stockQuantity: number;
    price: number;
    stockValue: number;
    lastSaleDate?: Date;
  }>> {
    try {
      const productFilter: any = {
        store_id: storeId,
        stock_quantity: { $gt: 0 },
        is_active: true
      };

      const transactionQuery: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        transactionQuery.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        transactionQuery.created_at = { $gte: defaultStart };
      }

      // Get all products with stock
      const productsWithStock = await Product.find(productFilter)
        .select('_id name category stock_quantity price')
        .lean();

      // Get products that have sales
      const productsWithSales = await Transaction.aggregate([
        { $match: transactionQuery },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product_id',
            lastSaleDate: { $max: '$created_at' }
          }
        }
      ]);

      const salesMap = new Map<string, Date>();
      productsWithSales.forEach(item => {
        salesMap.set(item._id.toString(), item.lastSaleDate);
      });

      // Filter products with no sales
      const worstPerformers = productsWithStock
        .filter(product => !salesMap.has(product._id.toString()))
        .map(product => ({
          productId: product._id.toString(),
          productName: product.name,
          category: product.category || 'Uncategorized',
          stockQuantity: product.stock_quantity,
          price: product.price,
          stockValue: product.price * product.stock_quantity,
          lastSaleDate: salesMap.get(product._id.toString())
        }))
        .sort((a, b) => b.stockValue - a.stockValue)
        .slice(0, limit);

      return worstPerformers;
    } catch (error) {
      logger.error('Error getting worst performers:', error);
      return [];
    }
  }

  /**
   * Get category performance with detailed metrics
   */
  static async getCategoryPerformance(
    storeId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{
    category: string;
    products: number;
    totalRevenue: number;
    quantitySold: number;
    avgRevenuePerProduct: number;
    stockValue: number;
  }>> {
    try {
      const transactionQuery: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        transactionQuery.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        transactionQuery.created_at = { $gte: defaultStart };
      }

      // Get sales by category
      const salesByCategory = await Transaction.aggregate([
        { $match: transactionQuery },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            let: { productId: '$items.product_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toString: '$_id' }, '$$productId']
                  }
                }
              }
            ],
            as: 'product'
          }
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              $cond: {
                if: { $and: [{ $ne: ['$product', null] }, { $ne: ['$product.category', null] }, { $ne: ['$product.category', ''] }] },
                then: '$product.category',
                else: 'Uncategorized'
              }
            },
            totalRevenue: { $sum: '$items.total_price' },
            quantitySold: { $sum: '$items.quantity' }
          }
        }
      ]);

      // Get product counts and stock value by category
      const productStats = await Product.aggregate([
        { $match: { store_id: storeId } },
        {
          $group: {
            _id: '$category',
            products: { $sum: 1 },
            stockValue: { $sum: { $multiply: ['$price', '$stock_quantity'] } }
          }
        }
      ]);

      const productStatsMap = new Map<string, { products: number; stockValue: number }>();
      productStats.forEach(stat => {
        productStatsMap.set(stat._id || 'Uncategorized', {
          products: stat.products,
          stockValue: stat.stockValue
        });
      });

      // Combine sales and product data
      return salesByCategory.map(sales => {
        const stats = productStatsMap.get(sales._id) || { products: 0, stockValue: 0 };
        return {
          category: sales._id,
          products: stats.products,
          totalRevenue: sales.totalRevenue,
          quantitySold: sales.quantitySold,
          avgRevenuePerProduct: stats.products > 0 ? sales.totalRevenue / stats.products : 0,
          stockValue: stats.stockValue
        };
      }).sort((a, b) => b.totalRevenue - a.totalRevenue);
    } catch (error) {
      logger.error('Error getting category performance:', error);
      return [];
    }
  }

  /**
   * Get fastest moving products (high turnover rate)
   */
  static async getFastestMovingProducts(
    storeId?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10
  ): Promise<Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
    turnoverRate: number;
    avgDailySales: number;
  }>> {
    try {
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      const daysDiff = startDate && endDate
        ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        : 30;

      const fastestMoving = await Transaction.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product_id',
            productName: { $first: '$items.product_name' },
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.total_price' }
          }
        },
        {
          $addFields: {
            avgDailySales: {
              $divide: ['$quantitySold', daysDiff]
            },
            turnoverRate: {
              $multiply: [
                {
                  $divide: ['$quantitySold', daysDiff]
                },
                100
              ]
            }
          }
        },
        { $sort: { turnoverRate: -1 } },
        { $limit: limit },
        {
          $project: {
            productId: '$_id',
            productName: 1,
            quantitySold: 1,
            revenue: 1,
            turnoverRate: { $round: ['$turnoverRate', 2] },
            avgDailySales: { $round: ['$avgDailySales', 2] },
            _id: 0
          }
        }
      ]);

      return fastestMoving;
    } catch (error) {
      logger.error('Error getting fastest moving products:', error);
      return [];
    }
  }

  /**
   * Get best performers (top revenue products)
   */
  static async getBestPerformers(
    storeId?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10
  ): Promise<Array<{
    productId: string;
    productName: string;
    revenue: number;
    quantitySold: number;
    transactions: number;
  }>> {
    try {
      const query: any = {
        store_id: storeId,
        status: { $in: ['completed', 'pending'] }
      };

      if (startDate && endDate) {
        query.created_at = { $gte: startDate, $lte: endDate };
      } else {
        // Default to last 30 days
        const defaultStart = new Date();
        defaultStart.setDate(defaultStart.getDate() - 30);
        query.created_at = { $gte: defaultStart };
      }

      const bestPerformers = await Transaction.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product_id',
            productName: { $first: '$items.product_name' },
            revenue: { $sum: '$items.total_price' },
            quantitySold: { $sum: '$items.quantity' },
            transactions: { $addToSet: '$_id' }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: limit },
        {
          $project: {
            productId: '$_id',
            productName: 1,
            revenue: 1,
            quantitySold: 1,
            transactions: { $size: '$transactions' },
            _id: 0
          }
        }
      ]);

      return bestPerformers;
    } catch (error) {
      logger.error('Error getting best performers:', error);
      return [];
    }
  }
}
