import nodemailer from 'nodemailer';
import { config } from '../config/app';
import { logger } from '../utils/logger';

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;

  /**
   * Initialize email transporter
   */
  static initialize(): void {
    if (config.email.user && config.email.pass) {
      this.transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: {
          user: config.email.user,
          pass: config.email.pass,
        },
      });

      logger.info('Email service initialized');
    } else {
      logger.warn('Email service not configured - EMAIL_USER and EMAIL_PASSWORD not set');
    }
  }

  /**
   * Send email
   */
  static async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    if (!this.transporter) {
      logger.warn('Email service not initialized - email not sent');
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: `"${config.email.fromName}" <${config.email.fromEmail || config.email.user}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      logger.info(`Email sent successfully to ${options.to}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  /**
   * Send low stock alert email to wholesaler
   */
  static async sendLowStockAlert(
    wholesalerEmail: string,
    wholesalerName: string,
    products: Array<{
      name: string;
      sku: string;
      stock_quantity: number;
      min_stock_level: number;
      price: number;
      image_url?: string;
    }>
  ): Promise<boolean> {
    const productListHtml = products
      .map(
        (product, index) => `
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;">${index + 1}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">
          ${product.image_url ? `<img src="${product.image_url}" alt="${product.name}" style="max-width: 100px; max-height: 100px;" />` : 'No image'}
        </td>
        <td style="padding: 10px; border: 1px solid #ddd;">${product.name}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">${product.sku}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">${product.stock_quantity}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">${product.min_stock_level}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">$${product.price.toFixed(2)}</td>
      </tr>
    `
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 800px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background-color: #4CAF50; color: white; padding: 10px; text-align: left; }
            .footer { text-align: center; padding: 20px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Low Stock Alert</h1>
            </div>
            <div class="content">
              <p>Dear ${wholesalerName},</p>
              <p>We need to restock the following products that are running low:</p>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Image</th>
                    <th>Product Name</th>
                    <th>SKU</th>
                    <th>Current Stock</th>
                    <th>Min Stock Level</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${productListHtml}
                </tbody>
              </table>
              <p>Please contact us to arrange for restocking these items.</p>
              <p>Thank you for your continued partnership.</p>
            </div>
            <div class="footer">
              <p>This is an automated message from Market Management System</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
Low Stock Alert

Dear ${wholesalerName},

We need to restock the following products that are running low:

${products
  .map(
    (p, i) => `${i + 1}. ${p.name} (SKU: ${p.sku}) - Current: ${p.stock_quantity}, Min: ${p.min_stock_level}, Price: $${p.price.toFixed(2)}`
  )
  .join('\n')}

Please contact us to arrange for restocking these items.

Thank you for your continued partnership.
    `;

    return await this.sendEmail({
      to: wholesalerEmail,
      subject: 'Low Stock Alert - Restock Required',
      html,
      text,
    });
  }
}

// Initialize email service on module load
EmailService.initialize();

