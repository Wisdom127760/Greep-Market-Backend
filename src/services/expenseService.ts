import { Expense, IExpense } from '../models/Expense';
import { logger } from '../utils/logger';
import { getStoreTimezone, formatDateForTimezone } from '../utils/timezone';
import { PriceMonitoringService, PriceChangeSuggestion } from './priceMonitoringService';

export interface CreateExpenseData {
  store_id: string;
  date: Date;
  product_name: string;
  product_id?: string; // Optional product ID to link expense to product
  unit: 'pieces' | 'kgs' | 'liters' | 'boxes' | 'packets' | 'other';
  quantity: number;
  amount: number;
  currency?: 'TRY' | 'USD' | 'NGN' | 'EUR';
  payment_method: 'cash' | 'isbank' | 'naira' | 'card' | 'transfer' | 'other';
  category?: 'food' | 'supplies' | 'utilities' | 'equipment' | 'maintenance' | 'other';
  description?: string;
  receipt_number?: string;
  vendor_name?: string;
  created_by: string;
}

export interface UpdateExpenseData {
  date?: Date;
  product_name?: string;
  product_id?: string;
  unit?: 'pieces' | 'kgs' | 'liters' | 'boxes' | 'packets' | 'other';
  quantity?: number;
  amount?: number;
  currency?: 'TRY' | 'USD' | 'NGN' | 'EUR';
  payment_method?: 'cash' | 'isbank' | 'naira' | 'card' | 'transfer' | 'other';
  category?: 'food' | 'supplies' | 'utilities' | 'equipment' | 'maintenance' | 'other';
  description?: string;
  receipt_number?: string;
  vendor_name?: string;
}

export interface ExpenseResponse {
  _id: string;
  store_id: string;
  date: Date;
  month_year: string;
  product_name: string;
  product_id?: string;
  unit: string;
  quantity: number;
  amount: number;
  cost_per_unit?: number;
  currency: string;
  payment_method: string;
  category: string;
  description?: string;
  receipt_number?: string;
  vendor_name?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseResponseWithPriceSuggestion extends ExpenseResponse {
  priceSuggestion?: PriceChangeSuggestion;
}

export interface ExpenseStats {
  totalExpenses: number;
  totalAmount: number;
  expensesByCategory: Array<{
    category: string;
    count: number;
    amount: number;
  }>;
  expensesByPaymentMethod: Array<{
    method: string;
    count: number;
    amount: number;
  }>;
  expensesByMonth: Array<{
    month: string;
    count: number;
    amount: number;
  }>;
  topExpenseItems: Array<{
    product_name: string;
    total_amount: number;
    count: number;
  }>;
}

export class ExpenseService {
  /**
   * Get expense time-series between dates
   * Returns daily buckets for ranges up to 31 days, otherwise monthly buckets
   */
  static async getExpenseSeries(
    startDate: Date,
    endDate: Date,
    storeId?: string
  ): Promise<Array<{ period: string; amount: number; count: number }>> {
    try {
      const filter: any = {
        date: { $gte: startDate, $lte: endDate }
      };
      if (storeId) {
        filter.store_id = storeId;
      }

      // Debug logging
      logger.info('ExpenseService.getExpenseSeries called with:', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        storeId,
        filter
      });

      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const isDaily = daysDiff <= 31;

      if (isDaily) {
        // Get timezone for the store to ensure correct date grouping
        const timezone = getStoreTimezone(storeId);
        
        // Daily series - use timezone-aware date formatting to group by local day
        const series = await Expense.aggregate([
          { $match: filter },
          {
            $group: {
              _id: {
                // Format date as YYYY-MM-DD in local timezone first, then use it for grouping
                dateString: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$date',
                    timezone: timezone
                  }
                }
              },
              amount: { $sum: '$amount' },
              count: { $sum: 1 }
            }
          },
          { $sort: { '_id.dateString': 1 } },
          {
            $project: {
              _id: 0,
              period: '$_id.dateString',
              amount: 1,
              count: 1
            }
          }
        ]);

        // Debug logging for series data
        logger.info('Expense series aggregation result:', {
          seriesLength: series.length,
          series: series.slice(0, 3) // Show first 3 entries
        });

        // Ensure all days exist in the range (fill gaps with 0)
        const map: Record<string, { amount: number; count: number }> = {};
        series.forEach(s => { map[s.period] = { amount: s.amount, count: s.count }; });
        const filled: Array<{ period: string; amount: number; count: number }> = [];
        
        // Create proper date range that includes all days from start to end
        // Convert to local dates to avoid timezone issues
        const startLocal = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endLocal = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        
        const cursor = new Date(startLocal);
        const end = new Date(endLocal);
        
        // Debug logging for date range
        logger.info('Expense series date range debug:', {
          originalStartDate: startDate.toISOString(),
          originalEndDate: endDate.toISOString(),
          startLocal: startLocal.toISOString(),
          endLocal: endLocal.toISOString(),
          cursorStart: cursor.toISOString(),
          cursorEnd: end.toISOString(),
          timezone: timezone,
          seriesData: series.map(s => ({ period: s.period, amount: s.amount }))
        });
        
        while (cursor <= end) {
          // Use timezone-aware date formatting to match the grouped period format
          const key = formatDateForTimezone(cursor, timezone);
          const v = map[key] || { amount: 0, count: 0 };
          filled.push({ period: key, amount: v.amount, count: v.count });
          cursor.setDate(cursor.getDate() + 1);
        }
        
        // Debug logging for final result
        logger.info('Expense series final result:', {
          filledLength: filled.length,
          filled: filled.slice(0, 3) // Show first 3 entries
        });
        
        return filled;
      }

      // Monthly series - use timezone-aware date formatting
      const timezone = getStoreTimezone(storeId);
      const series = await Expense.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              // Format date as YYYY-MM in local timezone
              monthString: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$date',
                  timezone: timezone
                }
              }
            },
            amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.monthString': 1 } },
        {
          $project: {
            _id: 0,
            period: '$_id.monthString',
            amount: 1,
            count: 1
          }
        }
      ]);
      
      // Debug logging for monthly series
      logger.info('Expense monthly series result:', {
        seriesLength: series.length,
        series: series.slice(0, 3) // Show first 3 entries
      });
      
      return series;
    } catch (error) {
      logger.error('Error getting expense series:', error);
      return [];
    }
  }
  /**
   * Create a new expense
   */
  static async createExpense(expenseData: CreateExpenseData): Promise<ExpenseResponse> {
    try {
      // Generate month_year from the date
      const date = new Date(expenseData.date);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const monthYear = `${monthNames[date.getMonth()]} - ${date.getFullYear()}`;

      // Try to find and link product if not already linked
      let productId = expenseData.product_id;
      if (!productId) {
        const match = await PriceMonitoringService.findMatchingProduct({
          product_name: expenseData.product_name,
          store_id: expenseData.store_id,
        });
        if (match && match.matched) {
          productId = match.product._id.toString();
        }
      }

      const expense = new Expense({
        ...expenseData,
        product_id: productId,
        month_year: monthYear,
        currency: expenseData.currency || 'TRY',
        category: expenseData.category || 'other',
      });

      await expense.save();
      return this.formatExpenseResponse(expense);
    } catch (error) {
      logger.error('Error creating expense:', error);
      throw error;
    }
  }

  /**
   * Create a new expense with price monitoring
   * Returns expense along with price change suggestions
   */
  static async createExpenseWithPriceMonitoring(
    expenseData: CreateExpenseData
  ): Promise<ExpenseResponseWithPriceSuggestion> {
    try {
      // Create the expense first
      const expense = await this.createExpense(expenseData);

      // Check for price changes and get suggestions
      const priceSuggestion = await PriceMonitoringService.checkPriceChange({
        product_id: expense.product_id,
        product_name: expenseData.product_name,
        store_id: expenseData.store_id,
        amount: expenseData.amount,
        quantity: expenseData.quantity,
      });

      return {
        ...expense,
        priceSuggestion,
      };
    } catch (error) {
      logger.error('Error creating expense with price monitoring:', error);
      throw error;
    }
  }

  /**
   * Get expenses with pagination and filtering
   */
  static async getExpenses(
    page: number = 1,
    limit: number = 20,
    storeId?: string,
    category?: string,
    paymentMethod?: string,
    startDate?: Date,
    endDate?: Date,
    search?: string
  ): Promise<{
    expenses: ExpenseResponse[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const query: any = {};
      
      if (storeId) {
        query.store_id = storeId;
      }
      
      if (category) {
        query.category = category;
      }
      
      if (paymentMethod) {
        query.payment_method = paymentMethod;
      }
      
      if (startDate || endDate) {
        query.date = {};
        if (startDate) query.date.$gte = startDate;
        if (endDate) query.date.$lte = endDate;
      }
      
      if (search) {
        query.$or = [
          { product_name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { vendor_name: { $regex: search, $options: 'i' } },
        ];
      }

      const skip = (page - 1) * limit;

      const [expenses, total] = await Promise.all([
        Expense.find(query)
          .sort({ date: -1 })
          .skip(skip)
          .limit(limit),
        Expense.countDocuments(query),
      ]);

      return {
        expenses: expenses.map(e => this.formatExpenseResponse(e)),
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error getting expenses:', error);
      throw error;
    }
  }

  /**
   * Get expense by ID
   */
  static async getExpenseById(expenseId: string): Promise<ExpenseResponse | null> {
    try {
      const expense = await Expense.findById(expenseId);
      if (!expense) {
        return null;
      }

      return this.formatExpenseResponse(expense);
    } catch (error) {
      logger.error('Error getting expense by ID:', error);
      throw error;
    }
  }

  /**
   * Update expense
   */
  static async updateExpense(
    expenseId: string, 
    updateData: UpdateExpenseData
  ): Promise<ExpenseResponse> {
    try {
      const expense = await Expense.findByIdAndUpdate(
        expenseId,
        updateData,
        { new: true }
      );

      if (!expense) {
        throw new Error('Expense not found');
      }

      return this.formatExpenseResponse(expense);
    } catch (error) {
      logger.error('Error updating expense:', error);
      throw error;
    }
  }

  /**
   * Delete expense
   */
  static async deleteExpense(expenseId: string): Promise<void> {
    try {
      const expense = await Expense.findByIdAndDelete(expenseId);
      if (!expense) {
        throw new Error('Expense not found');
      }
    } catch (error) {
      logger.error('Error deleting expense:', error);
      throw error;
    }
  }

  /**
   * Get expense statistics
   */
  static async getExpenseStats(
    storeId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<ExpenseStats> {
    try {
      const filter: any = {};
      
      if (storeId) {
        filter.store_id = storeId;
      }
      
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = startDate;
        if (endDate) filter.date.$lte = endDate;
      }

      const [
        totalExpenses,
        totalAmountResult,
        categoryStats,
        paymentMethodStats,
        monthlyStats,
        topItems
      ] = await Promise.all([
        Expense.countDocuments(filter),
        Expense.aggregate([
          { $match: filter },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { 
            _id: '$category', 
            count: { $sum: 1 }, 
            amount: { $sum: '$amount' }
          }},
          { $project: { category: '$_id', count: 1, amount: 1, _id: 0 } }
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { 
            _id: '$payment_method', 
            count: { $sum: 1 }, 
            amount: { $sum: '$amount' }
          }},
          { $project: { method: '$_id', count: 1, amount: 1, _id: 0 } }
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { 
            _id: '$month_year', 
            count: { $sum: 1 }, 
            amount: { $sum: '$amount' }
          }},
          { $sort: { '_id': -1 } },
          { $limit: 12 },
          { $project: { month: '$_id', count: 1, amount: 1, _id: 0 } }
        ]),
        Expense.aggregate([
          { $match: filter },
          { $group: { 
            _id: '$product_name', 
            total_amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }},
          { $sort: { total_amount: -1 } },
          { $limit: 10 },
          { $project: { 
            product_name: '$_id', 
            total_amount: 1, 
            count: 1, 
            _id: 0 
          }}
        ])
      ]);

      return {
        totalExpenses,
        totalAmount: totalAmountResult[0]?.total || 0,
        expensesByCategory: categoryStats,
        expensesByPaymentMethod: paymentMethodStats,
        expensesByMonth: monthlyStats,
        topExpenseItems: topItems
      };
    } catch (error) {
      logger.error('Error getting expense stats:', error);
      throw error;
    }
  }

  /**
   * Get expenses by date range
   */
  static async getExpensesByDateRange(
    startDate: Date,
    endDate: Date,
    storeId?: string
  ): Promise<ExpenseResponse[]> {
    try {
      const filter: any = {
        date: { $gte: startDate, $lte: endDate }
      };
      
      if (storeId) {
        filter.store_id = storeId;
      }

      const expenses = await Expense.find(filter).sort({ date: -1 });
      return expenses.map(e => this.formatExpenseResponse(e));
    } catch (error) {
      logger.error('Error getting expenses by date range:', error);
      throw error;
    }
  }

  /**
   * Get monthly expense summary
   */
  static async getMonthlyExpenseSummary(
    year: number,
    storeId?: string
  ): Promise<Array<{
    month: string;
    total_amount: number;
    expense_count: number;
    categories: Array<{
      category: string;
      amount: number;
    }>;
  }>> {
    try {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      
      const filter: any = {
        date: { $gte: startDate, $lte: endDate }
      };
      
      if (storeId) {
        filter.store_id = storeId;
      }

      // Get timezone for the store to ensure correct date grouping
      const timezone = getStoreTimezone(storeId);

      const monthlyData = await Expense.aggregate([
        { $match: filter },
        { $group: { 
          _id: { 
            // Format date as YYYY-MM in local timezone first
            monthString: {
              $dateToString: {
                format: '%Y-%m',
                date: '$date',
                timezone: timezone
              }
            }
          }, 
          total_amount: { $sum: '$amount' },
          expense_count: { $sum: 1 },
          categories: { $push: { category: '$category', amount: '$amount' } }
        }},
        { $sort: { '_id.monthString': 1 } },
        { $project: { 
          month: { 
            $dateToString: { 
              format: '%B', 
              date: {
                $dateFromString: {
                  dateString: { $concat: ['$_id.monthString', '-01T00:00:00'] },
                  timezone: timezone
                }
              },
              timezone: timezone
            }
          },
          total_amount: 1,
          expense_count: 1,
          categories: 1,
          _id: 0
        }}
      ]);

      // Process categories for each month
      return monthlyData.map(month => ({
        month: month.month,
        total_amount: month.total_amount,
        expense_count: month.expense_count,
        categories: month.categories.reduce((acc: any[], curr: any) => {
          const existing = acc.find(c => c.category === curr.category);
          if (existing) {
            existing.amount += curr.amount;
          } else {
            acc.push({ category: curr.category, amount: curr.amount });
          }
          return acc;
        }, [])
      }));
    } catch (error) {
      logger.error('Error getting monthly expense summary:', error);
      throw error;
    }
  }

  /**
   * Format expense response
   */
  private static formatExpenseResponse(expense: IExpense): ExpenseResponse {
    return {
      _id: expense._id.toString(),
      store_id: expense.store_id,
      date: expense.date,
      month_year: expense.month_year,
      product_name: expense.product_name,
      product_id: expense.product_id,
      unit: expense.unit,
      quantity: expense.quantity,
      amount: expense.amount,
      cost_per_unit: expense.cost_per_unit,
      currency: expense.currency,
      payment_method: expense.payment_method,
      category: expense.category,
      description: expense.description,
      receipt_number: expense.receipt_number,
      vendor_name: expense.vendor_name,
      created_by: expense.created_by,
      created_at: expense.created_at,
      updated_at: expense.updated_at,
    };
  }
}
