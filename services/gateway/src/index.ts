import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger, loadConfig } from '@bank/shared';
import { z } from 'zod';
import { requestIdMiddleware } from './middleware/request-id.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { generalRateLimiter } from './middleware/rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAccountsRouter } from './routes/accounts.routes.js';
import { createTransactionsRouter } from './routes/transactions.routes.js';
import { systemRouter } from './routes/system.routes.js';
import { labRouter } from './routes/lab.routes.js';
import { createDocsRouter } from './openapi/docs.routes.js';
import { concurrencyRouter } from './routes/lab-concurrency.routes.js';



const GatewayConfigSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_NODES: z
    .string()
    .default('1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051'),
  JWT_SECRET: z.string().default('dev-dbs-jwt-secret-key-change-in-prod'),
  LAB_MODE: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
});

const config = loadConfig(GatewayConfigSchema);
const logger = createLogger({ service: 'gateway' });

const app = express();

app.set('trust proxy', 1); // Trust first proxy (nginx in Docker)
app.use(helmet({ contentSecurityPolicy: false })); // Allow Swagger UI inline scripts
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

// Health check endpoint (no auth/limiter required)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'UP',
    service: 'gateway',
    timestamp: new Date().toISOString(),
  });
});

// Swagger documentation
app.use('/api/docs', createDocsRouter());

// Apply rate limiter to general API endpoints
app.use('/api', generalRateLimiter);

// Auth middleware factory
const requireAuth = createAuthMiddleware(config.JWT_SECRET);

// API Routers
app.use('/api/auth', createAuthRouter(requireAuth));
app.use('/api/accounts', createAccountsRouter(requireAuth));
app.use('/api/transactions', createTransactionsRouter(requireAuth));
// Lab mode middleware (Task 11.5)
const labModeMiddleware: express.RequestHandler = (_req, res, next) => {
  if (!config.LAB_MODE) {
    res.status(404).json({
      success: false,
      error: {
        code: 'LAB_DISABLED',
        message: 'Lab endpoints are disabled in production mode (LAB_MODE=false)',
      },
    });
    return;
  }
  next();
};

app.use('/api/system', systemRouter);
app.use('/api/lab/concurrency', labModeMiddleware, concurrencyRouter);
app.use('/api/lab', labModeMiddleware, labRouter);


import { LoadBalancer } from './loadbalancer/load-balancer.js';

// Global Error Handler
app.use(errorHandler);

const lb = LoadBalancer.getInstance({ gatewayNodes: config.GATEWAY_NODES });
lb.start();

const server = app.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`Gateway service listening on port ${config.PORT}`);
});

function shutdown() {
  logger.info('Shutting down gateway...');
  lb.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

