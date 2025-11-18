import { Router, Request, Response, NextFunction } from 'express';
import { WholesalerService } from '../services/wholesalerService';
import { WholesalerExportService } from '../services/wholesalerExportService';
import { EmailService } from '../services/emailService';
import { AuditService } from '../services/auditService';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Create a new wholesaler
 * POST /api/v1/wholesalers
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, email, address, store_id, notes } = req.body;
    const created_by = req.user?.id || req.body.created_by;

    // Validate required fields
    if (!name || !phone || !address || !store_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, phone, address, store_id'
      });
    }

    if (!created_by) {
      return res.status(400).json({
        success: false,
        message: 'created_by is required'
      });
    }

    const wholesaler = await WholesalerService.createWholesaler({
      name,
      phone,
      email,
      address,
      store_id,
      notes,
      created_by,
    });

    // Log the creation action
    await AuditService.logCreate(
      req,
      'WHOLESALER',
      (wholesaler as any)._id?.toString() || '',
      wholesaler.name
    );

    res.status(201).json({
      success: true,
      message: 'Wholesaler created successfully',
      data: WholesalerService.formatWholesalerResponse(wholesaler),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all wholesalers with filters
 * GET /api/v1/wholesalers
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      store_id,
      search,
      is_active,
      sortBy,
      sortOrder,
      page,
      limit,
    } = req.query;

    // Get store_id from authenticated user if not provided
    const finalStoreId = store_id as string || req.user?.storeId;

    const result = await WholesalerService.getWholesalers({
      store_id: finalStoreId,
      search: search as string,
      is_active: is_active ? is_active === 'true' : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json({
      success: true,
      message: 'Wholesalers retrieved successfully',
      data: {
        ...result,
        wholesalers: result.wholesalers.map(wholesaler =>
          WholesalerService.formatWholesalerResponse(wholesaler)
        ),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get wholesaler by ID
 * GET /api/v1/wholesalers/:id
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { include_products, low_stock_only } = req.query;

    const includeProducts = include_products === 'true' || include_products === '1';
    const lowStockOnly = low_stock_only === 'true' || low_stock_only === '1';

    if (includeProducts) {
      const wholesaler = await WholesalerService.getWholesalerWithProducts(
        id,
        lowStockOnly
      );

      if (!wholesaler) {
        return res.status(404).json({
          success: false,
          message: 'Wholesaler not found',
        });
      }

      return res.json({
        success: true,
        message: 'Wholesaler retrieved successfully',
        data: {
          ...WholesalerService.formatWholesalerResponse(wholesaler as any),
          products: wholesaler.products,
          product_count: wholesaler.product_count,
        },
      });
    }

    const wholesaler = await WholesalerService.getWholesalerById(id);

    if (!wholesaler) {
      return res.status(404).json({
        success: false,
        message: 'Wholesaler not found',
      });
    }

    res.json({
      success: true,
      message: 'Wholesaler retrieved successfully',
      data: WholesalerService.formatWholesalerResponse(wholesaler),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update wholesaler
 * PUT /api/v1/wholesalers/:id
 */
router.put('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Get the old wholesaler data for audit logging
    const oldWholesaler = await WholesalerService.getWholesalerById(id);

    const wholesaler = await WholesalerService.updateWholesaler(id, updateData);

    if (!wholesaler) {
      return res.status(404).json({
        success: false,
        message: 'Wholesaler not found',
      });
    }

    // Log the update action
    await AuditService.logUpdate(
      req,
      'WHOLESALER',
      (wholesaler as any)._id?.toString() || '',
      wholesaler.name,
      oldWholesaler,
      wholesaler
    );

    res.json({
      success: true,
      message: 'Wholesaler updated successfully',
      data: WholesalerService.formatWholesalerResponse(wholesaler),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete wholesaler
 * DELETE /api/v1/wholesalers/:id
 */
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Get the wholesaler data before deletion for audit logging
    const wholesaler = await WholesalerService.getWholesalerById(id);

    if (wholesaler) {
      await AuditService.logDelete(
        req,
        'WHOLESALER',
        (wholesaler as any)._id?.toString() || '',
        wholesaler.name,
        wholesaler
      );
    }

    await WholesalerService.deleteWholesaler(id);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Get low stock products for a wholesaler
 * GET /api/v1/wholesalers/:id/low-stock
 */
router.get('/:id/low-stock', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const lowStockProducts = await WholesalerService.getLowStockProducts(id);

    res.json({
      success: true,
      message: 'Low stock products retrieved successfully',
      data: {
        wholesaler_id: id,
        products: lowStockProducts,
        count: lowStockProducts.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Send low stock alert email to wholesaler
 * POST /api/v1/wholesalers/:id/send-email-alert
 */
router.post('/:id/send-email-alert', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const wholesaler = await WholesalerService.getWholesalerById(id);
    if (!wholesaler) {
      return res.status(404).json({
        success: false,
        message: 'Wholesaler not found',
      });
    }

    if (!wholesaler.email) {
      return res.status(400).json({
        success: false,
        message: 'Wholesaler does not have an email address',
      });
    }

    const lowStockProducts = await WholesalerService.getLowStockProducts(id);

    if (lowStockProducts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No low stock products found for this wholesaler',
      });
    }

    const emailSent = await EmailService.sendLowStockAlert(
      wholesaler.email,
      wholesaler.name,
      lowStockProducts.map(p => ({
        name: p.name,
        sku: p.sku,
        stock_quantity: p.stock_quantity,
        min_stock_level: p.min_stock_level,
        price: p.price,
        image_url: p.primary_image,
      }))
    );

    if (emailSent) {
      res.json({
        success: true,
        message: 'Low stock alert email sent successfully',
        data: {
          wholesaler_id: id,
          email: wholesaler.email,
          products_count: lowStockProducts.length,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send email. Please check email configuration.',
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Get WhatsApp link for low stock alert
 * GET /api/v1/wholesalers/:id/whatsapp-link
 */
router.get('/:id/whatsapp-link', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const wholesaler = await WholesalerService.getWholesalerById(id);
    if (!wholesaler) {
      return res.status(404).json({
        success: false,
        message: 'Wholesaler not found',
      });
    }

    const lowStockProducts = await WholesalerService.getLowStockProducts(id);

    if (lowStockProducts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No low stock products found for this wholesaler',
      });
    }

    // Format phone number (remove any non-digit characters except +)
    const phoneNumber = wholesaler.phone.replace(/[^\d+]/g, '');

    // Create message
    const productList = lowStockProducts
      .map((p, i) => `${i + 1}. ${p.name} (SKU: ${p.sku}) - Stock: ${p.stock_quantity}/${p.min_stock_level}`)
      .join('%0A');

    const message = `Hello ${wholesaler.name},%0A%0AWe need to restock the following products:%0A%0A${productList}%0A%0APlease contact us to arrange for restocking.%0A%0AThank you!`;

    // Generate WhatsApp link
    const whatsappLink = `https://wa.me/${phoneNumber}?text=${message}`;

    res.json({
      success: true,
      message: 'WhatsApp link generated successfully',
      data: {
        wholesaler_id: id,
        phone: wholesaler.phone,
        whatsapp_link: whatsappLink,
        products_count: lowStockProducts.length,
        products: lowStockProducts,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Export wholesalers to PDF or Excel
 * GET /api/v1/wholesalers/export?format=pdf|excel&include_products=true|false
 */
router.get('/export', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { format = 'excel', include_products = 'false' } = req.query;
    const store_id = (req.query.store_id as string) || req.user?.storeId;

    if (!store_id) {
      return res.status(400).json({
        success: false,
        message: 'store_id is required',
      });
    }

    if (format !== 'pdf' && format !== 'excel') {
      return res.status(400).json({
        success: false,
        message: 'format must be either "pdf" or "excel"',
      });
    }

    const includeProducts = include_products === 'true' || include_products === '1';
    const buffer = await WholesalerExportService.exportWholesalers(
      store_id,
      format as 'pdf' | 'excel',
      includeProducts
    );

    const filename = `wholesalers-export-${new Date().toISOString().split('T')[0]}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
    const contentType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());

    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

export default router;

