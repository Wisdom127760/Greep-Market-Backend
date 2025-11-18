import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { StoreService } from '../services/storeService';
import { logger } from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/stores
 * @desc    Get all stores
 * @access  Private
 */
router.get('/', asyncHandler(async (req, res) => {
  logger.info('Getting all stores');
  
  try {
    const stores = await StoreService.getAllStores();
    
    res.json({
      success: true,
      message: 'Stores retrieved successfully',
      data: stores,
    });
  } catch (error) {
    logger.error('Error getting all stores:', error);
    throw error;
  }
}));

/**
 * @route   GET /api/v1/stores/for-assignment
 * @desc    Get stores for user assignment (simplified data)
 * @access  Private
 */
router.get('/for-assignment', asyncHandler(async (req, res) => {
  logger.info('Getting stores for user assignment');
  
  try {
    const stores = await StoreService.getAllStores();
    
    // Return simplified store data for assignment dropdowns
    const assignmentStores = stores.map(store => ({
      id: (store as any)._id?.toString() || (store as any).id || '',
      name: store.name,
      address: store.address,
      is_active: store.is_active
    }));
    
    res.json({
      success: true,
      message: 'Stores for assignment retrieved successfully',
      data: assignmentStores,
    });
  } catch (error) {
    logger.error('Error getting stores for assignment:', error);
    throw error;
  }
}));

/**
 * @route   GET /api/v1/stores/settings
 * @desc    Get store settings
 * @access  Private
 */
router.get('/settings', asyncHandler(async (req, res) => {
  const { store_id } = req.query;
  
  logger.info(`Getting store settings for store ID: ${store_id}`);
  
  try {
    if (!store_id) {
      return res.status(400).json({
        success: false,
        message: 'store_id query parameter is required',
      });
    }

    // Get the store from database
    const store = await StoreService.getStoreById(store_id as string);
    
    res.json({
      success: true,
      message: 'Store settings retrieved successfully',
      data: store,
    });
  } catch (error) {
    logger.error(`Error getting store settings for ${store_id}:`, error);
    throw error;
  }
}));

/**
 * @route   GET /api/v1/stores/:id
 * @desc    Get store by ID
 * @access  Private
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  logger.info(`Getting store by ID: ${id}`);
  
  try {
    const store = await StoreService.getStoreById(id);
    
    res.json({
      success: true,
      message: 'Store retrieved successfully',
      data: store,
    });
  } catch (error) {
    logger.error(`Error getting store by ID ${id}:`, error);
    throw error;
  }
}));

/**
 * @route   POST /api/v1/stores
 * @desc    Create new store
 * @access  Private (admin/owner only)
 */
router.post('/', authorize('admin', 'owner'), asyncHandler(async (req, res) => {
  const storeData = req.body;
  
  logger.info(`Creating new store: ${storeData.name}`);
  
  try {
    const store = await StoreService.createStore(storeData);
    
    res.status(201).json({
      success: true,
      message: 'Store created successfully',
      data: store,
    });
  } catch (error) {
    logger.error('Error creating store:', error);
    throw error;
  }
}));

/**
 * @route   PUT /api/v1/stores/:id
 * @desc    Update store
 * @access  Private (admin/owner/manager only)
 */
router.put('/:id', authorize('admin', 'owner', 'manager'), asyncHandler(async (req, res) => {
  // TODO: Implement update store
  res.json({
    success: true,
    message: 'Update store endpoint - to be implemented',
    data: null,
  });
}));

/**
 * @route   DELETE /api/v1/stores/:id
 * @desc    Delete store
 * @access  Private (admin/owner only)
 */
router.delete('/:id', authorize('admin', 'owner'), asyncHandler(async (req, res) => {
  // TODO: Implement delete store
  res.json({
    success: true,
    message: 'Delete store endpoint - to be implemented',
  });
}));

/**
 * @route   PUT /api/v1/stores/:id/settings
 * @desc    Update store settings
 * @access  Private (admin/owner/manager/cashier)
 */
router.put('/:id/settings', authorize('admin', 'owner', 'manager', 'cashier'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const settings = req.body;

  logger.info(`Updating store settings for store ID: ${id}`);

  try {
    // Update the store with the new settings
    const updatedStore = await StoreService.updateStore(id, settings);

    res.json({
      success: true,
      message: 'Store settings updated successfully',
      data: updatedStore,
    });
  } catch (error) {
    logger.error(`Error updating store settings for ${id}:`, error);
    throw error;
  }
}));

export default router;
