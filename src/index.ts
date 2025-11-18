import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/app';
import { initializeDatabase, closeDatabaseConnections, getConnectionStatus } from './config/database';
// import { testRedisConnection, closeRedisConnection } from './config/redis';
import { logger, morganStream } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { databaseHealthCheck } from './middleware/databaseHealth';
// import { requestMonitoring, performanceMonitoring, errorMonitoring } from './middleware/monitoring';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import storeRoutes from './routes/stores';
import productRoutes from './routes/products';
import inventoryRoutes from './routes/inventory';
import transactionRoutes from './routes/transactions';
import customerRoutes from './routes/customers';
import analyticsRoutes from './routes/analytics';
import expenseRoutes from './routes/expenses';
import goalRoutes from './routes/goals';
import auditRoutes from './routes/audit';
import settingsRoutes from './routes/settings';
import riderRoutes from './routes/riders';
import publicCatalogRoutes from './routes/publicCatalog';
import customerOrderRoutes from './routes/customerOrders';
import autoCompleteRoutes from './routes/autoComplete';
import notificationRoutes from './routes/notifications';
import wholesalerRoutes from './routes/wholesalers';
import { CronService } from './services/cronService';
import { SchedulerService } from './services/schedulerService';
import { auditMiddleware, auditAuth } from './middleware/audit';
// import monitoringRoutes from './routes/monitoring';

class App {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow localhost on any port for development
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
        
        // Allow configured origins
        if (config.security.corsOrigin.includes(origin)) {
          return callback(null, true);
        }
        
        // Allow all origins in development
        if (config.app.env === 'development') {
          return callback(null, true);
        }
        
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression
    this.app.use(compression());

    // Request logging - only log significant requests
    this.app.use(morgan('combined', { 
      stream: morganStream,
      skip: (req, res) => {
        // Skip logging for static files and health checks
        return req.url.includes('/static') || 
               req.url.includes('/assets') || 
               req.url.includes('/favicon.ico') ||
               req.url.includes('/health') ||
               (req.method === 'GET' && !req.url.includes('/api/'));
      }
    }));

    // Audit middleware for comprehensive logging (can be disabled with DISABLE_AUDIT_MIDDLEWARE=true)
    if (process.env.DISABLE_AUDIT_MIDDLEWARE !== 'true') {
      this.app.use(auditMiddleware);
    }

    // Monitoring middleware
    // this.app.use(requestMonitoring);
    // this.app.use(performanceMonitoring);

    // Rate limiting - DISABLED
    // const limiter = rateLimit({
    //   windowMs: config.rateLimit.windowMs,
    //   max: config.rateLimit.maxRequests,
    //   message: {
    //     error: 'Too many requests from this IP, please try again later.',
    //   },
    //   standardHeaders: true,
    //   legacyHeaders: false,
    // });
    // this.app.use('/api/', limiter);

    // Handle preflight requests
    this.app.options('*', (req, res) => {
      res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.sendStatus(200);
    });

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Database health check middleware (applied to all routes except health endpoint)
    this.app.use(databaseHealthCheck);

    // Health check endpoint with database status
    this.app.get('/health', (req, res) => {
      const dbStatus = getConnectionStatus();
      const isHealthy = dbStatus.isHealthy;
      
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'OK' : 'UNHEALTHY',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.app.env,
        version: config.app.version,
        database: dbStatus,
      });
    });

    // Favicon endpoint to prevent 404 errors
    this.app.get('/favicon.ico', (req, res) => {
      res.status(204).end(); // No content response
    });

    // Static files endpoint to prevent 404 errors for frontend assets
    this.app.get('/static/*', (req, res) => {
      res.status(404).json({ 
        message: 'Static files are served by the frontend development server',
        note: 'This is a backend API server. Frontend assets are served separately.'
      });
    });

    // API documentation endpoint
    this.app.get('/api/docs', (req, res) => {
      res.json({
        name: config.app.name,
        version: config.app.version,
        description: 'Market Management System API',
        endpoints: {
          auth: '/api/v1/auth',
          users: '/api/v1/users',
          stores: '/api/v1/stores',
          products: '/api/v1/products',
          inventory: '/api/v1/inventory',
          transactions: '/api/v1/transactions',
          customers: '/api/v1/customers',
          analytics: '/api/v1/analytics',
          expenses: '/api/v1/expenses',
          goals: '/api/v1/goals',
          audit: '/api/v1/audit',
          settings: '/api/v1/settings',
          riders: '/api/v1/riders',
          public_catalog: '/api/v1/public',
          customer_orders: '/api/v1/admin/customer-orders',
          auto_complete: '/api/v1/auto-complete',
          notifications: '/api/v1/notifications',
          wholesalers: '/api/v1/wholesalers',
        },
      });
    });
  }

  private initializeRoutes(): void {
    const apiPrefix = `/api/${config.app.version}`;

    // API routes
    this.app.use(`${apiPrefix}/auth`, auditAuth, authRoutes);
    this.app.use(`${apiPrefix}/users`, userRoutes);
    this.app.use(`${apiPrefix}/stores`, storeRoutes);
    this.app.use(`${apiPrefix}/products`, productRoutes);
    this.app.use(`${apiPrefix}/inventory`, inventoryRoutes);
    this.app.use(`${apiPrefix}/transactions`, transactionRoutes);
    this.app.use(`${apiPrefix}/customers`, customerRoutes);
    this.app.use(`${apiPrefix}/analytics`, analyticsRoutes);
    this.app.use(`${apiPrefix}/expenses`, expenseRoutes);
    this.app.use(`${apiPrefix}/goals`, goalRoutes);
    this.app.use(`${apiPrefix}/audit`, auditRoutes);
    this.app.use(`${apiPrefix}/settings`, settingsRoutes);
    this.app.use(`${apiPrefix}/riders`, riderRoutes);
    this.app.use(`${apiPrefix}/public`, publicCatalogRoutes);
    this.app.use(`${apiPrefix}/admin/customer-orders`, customerOrderRoutes);
    this.app.use(`${apiPrefix}/auto-complete`, autoCompleteRoutes);
    this.app.use(`${apiPrefix}/notifications`, notificationRoutes);
    this.app.use(`${apiPrefix}/wholesalers`, wholesalerRoutes);
    // this.app.use(`${apiPrefix}/monitoring`, monitoringRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Welcome to Student Delivery System API',
        version: config.app.version,
        documentation: '/api/docs',
        health: '/health',
      });
    });
  }

  private initializeErrorHandling(): void {
    // Error monitoring
    // this.app.use(errorMonitoring);

    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      logger.info('🚀 Starting server initialization...');
      
      // Initialize database with robust connection handling
      logger.info('🔄 Initializing database connection...');
      await initializeDatabase();
      logger.info('✅ Database initialization completed');

      // Test Redis connection (disabled)
      // const redisConnected = await testRedisConnection();
      // if (!redisConnected) {
      //   logger.warn('Redis connection failed - continuing without cache');
      // }

      // Start server
      this.app.listen(config.app.port, () => {
        logger.info(`🚀 Server running on port ${config.app.port}`);
        logger.info(`📚 API Documentation: http://localhost:${config.app.port}/api/docs`);
        logger.info(`🏥 Health Check: http://localhost:${config.app.port}/health`);
        logger.info(`🌍 Environment: ${config.app.env}`);
        logger.info(`💾 Database Status: ${getConnectionStatus().status}`);
        
        // Start cron jobs
        logger.info('🔄 Starting cron jobs...');
        CronService.startAllJobs();
        
        // Start notification scheduler
        logger.info('🔄 Initializing notification scheduler...');
        SchedulerService.initialize();
        
        logger.info('🎉 Server startup completed successfully!');
      });
    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      logger.error('🔄 Attempting graceful shutdown...');
      
      try {
        await closeDatabaseConnections();
      } catch (closeError) {
        logger.error('❌ Error during graceful shutdown:', closeError);
      }
      
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      // Stop cron jobs
      CronService.stopAllJobs();
      
      // Stop notification scheduler
      SchedulerService.stop();
      
      await closeDatabaseConnections();
      // await closeRedisConnection();
      logger.info('✅ Server stopped gracefully');
    } catch (error) {
      logger.error('Error stopping server:', error);
    }
  }
}

// Create and start the application
const app = new App();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
app.start().catch((error) => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});

export default app;
