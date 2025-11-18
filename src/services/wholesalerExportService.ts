import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { WholesalerService } from './wholesalerService';
import { IWholesaler } from '../models/Wholesaler';
import { Product } from '../models/Product';
import { logger } from '../utils/logger';
import https from 'https';
import http from 'http';

export class WholesalerExportService {
  /**
   * Helper function to fetch image from URL
   */
  private static async fetchImage(url: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      try {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (response) => {
          if (response.statusCode !== 200) {
            resolve(null);
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', () => resolve(null));
        }).on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Generate PDF export for wholesalers
   */
  static async generatePDF(
    wholesalers: IWholesaler[],
    includeProducts: boolean = false
  ): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Wholesalers Directory', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Process each wholesaler
        for (let index = 0; index < wholesalers.length; index++) {
          const wholesaler = wholesalers[index];
          
          if (index > 0) {
            doc.addPage();
          }

          // Wholesaler header
          doc.fontSize(16).text(wholesaler.name, { underline: true });
          doc.moveDown(0.5);

          // Contact information
          doc.fontSize(12);
          doc.text(`Phone: ${wholesaler.phone}`);
          if (wholesaler.email) {
            doc.text(`Email: ${wholesaler.email}`);
          }
          doc.text(`Address: ${wholesaler.address}`);
          doc.moveDown();

          // Store ID
          doc.fontSize(10).fillColor('gray');
          doc.text(`Store ID: ${wholesaler.store_id}`);
          doc.fillColor('black');
          doc.moveDown();

          // Notes
          if (wholesaler.notes) {
            doc.fontSize(11).fillColor('blue');
            doc.text('Notes:', { underline: true });
            doc.fillColor('black');
            doc.text(wholesaler.notes);
            doc.moveDown();
          }

          // Status
          doc.fontSize(10);
          doc.fillColor(wholesaler.is_active ? 'green' : 'red');
          doc.text(`Status: ${wholesaler.is_active ? 'Active' : 'Inactive'}`);
          doc.fillColor('black');
          doc.moveDown();

          // Products section (if requested)
          if (includeProducts) {
            doc.fontSize(12).text('Associated Products:', { underline: true });
            doc.moveDown(0.5);

            try {
              const products = await Product.find({ wholesaler_id: (wholesaler as any)._id?.toString() || '' })
                .select('name sku stock_quantity min_stock_level price images')
                .limit(20) // Limit to 20 products per wholesaler to avoid PDF size issues
                .lean();

              if (products.length > 0) {
                for (let i = 0; i < products.length; i++) {
                  const product: any = products[i];
                  const primaryImage = product.images?.find((img: any) => img.is_primary) || product.images?.[0];
                  
                  // Check if we need a new page
                  if (doc.y > doc.page.height - 200) {
                    doc.addPage();
                  }

                  doc.fontSize(11).text(`${i + 1}. ${product.name}`, { continued: false });
                  doc.fontSize(9).fillColor('gray');
                  doc.text(`SKU: ${product.sku} | Stock: ${product.stock_quantity}/${product.min_stock_level} | Price: $${product.price.toFixed(2)}`);
                  doc.fillColor('black');

                  // Add product image if available
                  if (primaryImage?.url) {
                    try {
                      const imageBuffer = await this.fetchImage(primaryImage.url);
                      if (imageBuffer) {
                        const imageY = doc.y;
                        doc.image(imageBuffer, {
                          fit: [100, 100],
                        });
                        doc.y = imageY + 110; // Move cursor below image
                      }
                    } catch (imageError) {
                      logger.warn(`Failed to load image for product ${product.sku}:`, imageError);
                      doc.moveDown(0.5);
                    }
                  } else {
                    doc.moveDown(0.5);
                  }

                  doc.moveDown(0.3);
                }
              } else {
                doc.fontSize(10).fillColor('gray').text('No products associated with this wholesaler.');
                doc.fillColor('black');
              }
            } catch (productError) {
              logger.error('Error fetching products for PDF:', productError);
              doc.fontSize(10).fillColor('red').text('Error loading products.');
              doc.fillColor('black');
            }
          }

          // Footer
          doc.moveDown();
          doc.fontSize(8).fillColor('gray');
          doc.text(`Wholesaler ID: ${(wholesaler as any)._id?.toString() || ''}`, { align: 'right' });
          doc.fillColor('black');
        }

        // Final page footer
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
          doc.switchToPage(i);
          doc.fontSize(8).fillColor('gray');
          doc.text(
            `Page ${i + 1} of ${pageCount}`,
            doc.page.width - 100,
            doc.page.height - 50,
            { align: 'right' }
          );
          doc.fillColor('black');
        }

        doc.end();
      } catch (error) {
        logger.error('PDF generation error:', error);
        reject(error);
      }
    });
  }

  /**
   * Generate Excel export for wholesalers
   */
  static async generateExcel(
    wholesalers: IWholesaler[],
    includeProducts: boolean = false
  ): Promise<Buffer> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Wholesalers');

      // Define columns
      worksheet.columns = [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Phone', key: 'phone', width: 20 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Address', key: 'address', width: 50 },
        { header: 'Store ID', key: 'store_id', width: 20 },
        { header: 'Notes', key: 'notes', width: 40 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Created At', key: 'created_at', width: 20 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true, size: 12 };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4CAF50' },
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Add data rows
      wholesalers.forEach((wholesaler) => {
        const row = worksheet.addRow({
          name: wholesaler.name,
          phone: wholesaler.phone,
          email: wholesaler.email || '',
          address: wholesaler.address,
          store_id: wholesaler.store_id,
          notes: wholesaler.notes || '',
          status: wholesaler.is_active ? 'Active' : 'Inactive',
          created_at: new Date(wholesaler.created_at).toLocaleString(),
        });

        // Style status column
        const statusCell = row.getCell('status');
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: wholesaler.is_active ? 'FFC8E6C9' : 'FFFFCDD2' },
        };
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        if (column.header) {
          column.width = Math.max(column.width || 10, column.header.length + 2);
        }
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      logger.error('Excel generation error:', error);
      throw error;
    }
  }

  /**
   * Export all wholesalers for a store
   */
  static async exportWholesalers(
    storeId: string,
    format: 'pdf' | 'excel',
    includeProducts: boolean = false
  ): Promise<Buffer> {
    try {
      const result = await WholesalerService.getWholesalers({
        store_id: storeId,
        limit: 10000, // Get all wholesalers
      });

      if (format === 'pdf') {
        return await this.generatePDF(result.wholesalers, includeProducts);
      } else {
        return await this.generateExcel(result.wholesalers, includeProducts);
      }
    } catch (error) {
      logger.error('Export wholesalers error:', error);
      throw error;
    }
  }
}

