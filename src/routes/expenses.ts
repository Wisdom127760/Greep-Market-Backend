import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ExpenseService } from '../services/expenseService';
import { PriceMonitoringService } from '../services/priceMonitoringService';
import { AuditService } from '../services/auditService';
import { logger } from '../utils/logger';

const router = Router();

// All expense routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/expenses
 * @desc    Get expenses with pagination and filtering
 * @access  Private
 */
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('category').optional().isIn(['food', 'supplies', 'utilities', 'equipment', 'maintenance', 'other']),
  query('payment_method').optional().isIn(['cash', 'isbank', 'naira', 'card', 'transfer', 'other']),
  query('start_date').optional().isDate().withMessage('Start date must be a valid date'),
  query('end_date').optional().isDate().withMessage('End date must be a valid date'),
  query('search').optional().isString().withMessage('Search must be a string'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    // Use authenticated user's store_id instead of query parameter
    const storeId = (req as any).user.storeId || 'default-store';
    const category = req.query.category as string;
    const paymentMethod = req.query.payment_method as string;
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
    const search = req.query.search as string;

    const result = await ExpenseService.getExpenses(
      page, 
      limit, 
      storeId, 
      category, 
      paymentMethod, 
      startDate, 
      endDate, 
      search
    );
    
    res.json({
      success: true,
      data: result.expenses,
      pagination: {
        total: result.total,
        page: result.page,
        pages: result.pages,
        limit
      }
    });
  } catch (error) {
    logger.error('Error getting expenses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expenses',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   GET /api/v1/expenses/stats
 * @desc    Get expense statistics
 * @access  Private
 */
router.get('/stats', [
  query('start_date').optional().isDate().withMessage('Start date must be a valid date'),
  query('end_date').optional().isDate().withMessage('End date must be a valid date'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    // Use authenticated user's store_id instead of query parameter
    const storeId = (req as any).user.storeId || 'default-store';
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;

    const stats = await ExpenseService.getExpenseStats(storeId, startDate, endDate);
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Error getting expense stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expense statistics',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   GET /api/v1/expenses/monthly/:year
 * @desc    Get monthly expense summary for a year
 * @access  Private
 */
router.get('/monthly/:year', [
  param('year').isInt({ min: 2020, max: 2030 }).withMessage('Year must be between 2020 and 2030'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const year = parseInt(req.params.year);
    // Use authenticated user's store_id instead of query parameter
    const storeId = (req as any).user.storeId || 'default-store';

    const monthlySummary = await ExpenseService.getMonthlyExpenseSummary(year, storeId);
    
    res.json({
      success: true,
      data: monthlySummary,
    });
  } catch (error) {
    logger.error('Error getting monthly expense summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get monthly expense summary',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   GET /api/v1/expenses/:id
 * @desc    Get expense by ID
 * @access  Private
 */
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid expense ID'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const expense = await ExpenseService.getExpenseById(req.params.id);
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }
    
    res.json({
      success: true,
      data: expense,
    });
  } catch (error) {
    logger.error('Error getting expense by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get expense',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   POST /api/v1/expenses
 * @desc    Create a new expense
 * @access  Private
 */
router.post('/', [
  // Remove store_id validation since we'll set it automatically from the authenticated user
  body('date').isDate().withMessage('Date must be a valid date'),
  body('product_name').notEmpty().trim().withMessage('Product name is required'),
  body('product_id').optional().isMongoId().withMessage('Invalid product ID'),
  body('unit').isIn(['pieces', 'kgs', 'liters', 'boxes', 'packets', 'other']).withMessage('Invalid unit'),
  body('quantity').isFloat({ min: 0 }).withMessage('Quantity must be a positive number'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('currency').optional().isIn(['TRY', 'USD', 'NGN', 'EUR']),
  body('payment_method').isIn(['cash', 'isbank', 'naira', 'card', 'transfer', 'other']).withMessage('Invalid payment method'),
  body('category').optional().isIn(['food', 'supplies', 'utilities', 'equipment', 'maintenance', 'other']),
  body('description').optional().isString().trim(),
  body('receipt_number').optional().isString().trim(),
  body('vendor_name').optional().isString().trim(),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const expenseData = {
      ...req.body,
      store_id: (req as any).user.storeId || 'default-store', // Set from authenticated user
      created_by: (req as any).user.id, // From auth middleware
    };

    // Create expense with price monitoring
    const expenseResult = await ExpenseService.createExpenseWithPriceMonitoring(expenseData);
    
    // Log the expense creation
    await AuditService.logCreate(
      req,
      'EXPENSE',
      expenseResult._id,
      expenseResult.product_name
    );
    
    // Prepare response with price suggestion if available
    const response: any = {
      success: true,
      data: expenseResult,
      message: 'Expense created successfully',
    };

    // Include price suggestion if there's a price change detected
    if (expenseResult.priceSuggestion?.hasPriceChange) {
      response.priceSuggestion = {
        hasPriceChange: expenseResult.priceSuggestion.hasPriceChange,
        product: expenseResult.priceSuggestion.product ? {
          id: expenseResult.priceSuggestion.product._id,
          name: expenseResult.priceSuggestion.product.name,
          sku: expenseResult.priceSuggestion.product.sku,
        } : undefined,
        currentCostPrice: expenseResult.priceSuggestion.currentCostPrice,
        newCostPrice: expenseResult.priceSuggestion.newCostPrice,
        currentSellingPrice: expenseResult.priceSuggestion.currentSellingPrice,
        suggestedSellingPrice: expenseResult.priceSuggestion.suggestedSellingPrice,
        markupPercentage: expenseResult.priceSuggestion.markupPercentage,
        priceChangePercentage: expenseResult.priceSuggestion.priceChangePercentage,
        message: expenseResult.priceSuggestion.message,
      };
      response.message = 'Expense created successfully. Price change detected - please review suggestion.';
    }
    
    res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating expense:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create expense',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   PUT /api/v1/expenses/:id
 * @desc    Update expense
 * @access  Private
 */
router.put('/:id', [
  param('id').isMongoId().withMessage('Invalid expense ID'),
  body('date').optional().isDate().withMessage('Date must be a valid date'),
  body('product_name').optional().notEmpty().trim().withMessage('Product name cannot be empty'),
  body('product_id').optional().isMongoId().withMessage('Invalid product ID'),
  body('unit').optional().isIn(['pieces', 'kgs', 'liters', 'boxes', 'packets', 'other']).withMessage('Invalid unit'),
  body('quantity').optional().isFloat({ min: 0 }).withMessage('Quantity must be a positive number'),
  body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('currency').optional().isIn(['TRY', 'USD', 'NGN', 'EUR']),
  body('payment_method').optional().isIn(['cash', 'isbank', 'naira', 'card', 'transfer', 'other']).withMessage('Invalid payment method'),
  body('category').optional().isIn(['food', 'supplies', 'utilities', 'equipment', 'maintenance', 'other']),
  body('description').optional().isString().trim(),
  body('receipt_number').optional().isString().trim(),
  body('vendor_name').optional().isString().trim(),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    // Get the old expense data for audit logging
    const oldExpense = await ExpenseService.getExpenseById(req.params.id);
    const expense = await ExpenseService.updateExpense(req.params.id, req.body);
    
    // Log the expense update
    await AuditService.logUpdate(
      req,
      'EXPENSE',
      req.params.id,
      expense.product_name,
      oldExpense,
      expense
    );
    
    res.json({
      success: true,
      data: expense,
      message: 'Expense updated successfully',
    });
  } catch (error) {
    logger.error('Error updating expense:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update expense',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * @route   DELETE /api/v1/expenses/:id
 * @desc    Delete expense
 * @access  Private (admin/owner/manager only)
 */
router.delete('/:id', [
  param('id').isMongoId().withMessage('Invalid expense ID'),
  authorize('admin', 'owner', 'manager'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    // Get the expense data before deletion for audit logging
    const expense = await ExpenseService.getExpenseById(req.params.id);
    await ExpenseService.deleteExpense(req.params.id);
    
    // Log the expense deletion
    await AuditService.logDelete(
      req,
      'EXPENSE',
      req.params.id,
      expense?.product_name || 'Unknown Expense',
      expense
    );
    
    res.json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting expense:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete expense',
      error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }));

/**
 * @route   POST /api/v1/expenses/:expenseId/update-product-price
 * @desc    Update product price based on expense price suggestion
 * @access  Private
 */
router.post('/:expenseId/update-product-price', [
  param('expenseId').isMongoId().withMessage('Invalid expense ID'),
  body('product_id').isMongoId().withMessage('Product ID is required'),
  body('updateSellingPrice').optional().isBoolean().withMessage('updateSellingPrice must be a boolean'),
], asyncHandler(async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { expenseId } = req.params;
    const { product_id, updateSellingPrice = false } = req.body;

    // Get the expense to retrieve cost information
    const expense = await ExpenseService.getExpenseById(expenseId);
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
    }

    if (!expense.cost_per_unit) {
      return res.status(400).json({
        success: false,
        message: 'Expense does not have cost per unit calculated',
      });
    }

    // Check price change to get suggested selling price
    const priceSuggestion = await PriceMonitoringService.checkPriceChange({
      product_id,
      product_name: expense.product_name,
      store_id: expense.store_id,
      amount: expense.amount,
      quantity: expense.quantity,
    });

    if (!priceSuggestion.hasPriceChange && !priceSuggestion.product) {
      return res.status(400).json({
        success: false,
        message: priceSuggestion.message || 'No price change detected or product not found',
      });
    }

    // Update product pricing
    const updatedProduct = await PriceMonitoringService.updateProductPricing(
      product_id,
      expense.cost_per_unit,
      updateSellingPrice,
      priceSuggestion.suggestedSellingPrice,
      (req as any).user.id
    );

    // Update expense to link it to the product if not already linked
    if (!expense.product_id) {
      await ExpenseService.updateExpense(expenseId, { product_id });
    }

    res.json({
      success: true,
      message: 'Product price updated successfully',
      data: {
        product: {
          id: updatedProduct._id,
          name: updatedProduct.name,
          sku: updatedProduct.sku,
          cost_price: updatedProduct.cost_price,
          price: updatedProduct.price,
          markup_percentage: updatedProduct.markup_percentage,
        },
        updatedFields: {
          costPrice: expense.cost_per_unit,
          sellingPrice: updateSellingPrice ? priceSuggestion.suggestedSellingPrice : 'not updated',
        },
      },
    });
  } catch (error) {
    logger.error('Error updating product price:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product price',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

export default router;
