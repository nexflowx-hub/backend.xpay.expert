import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cron from 'node-cron';

import authRoutes from '../modules/auth/routes/auth.routes';
import checkoutRoutes from '../modules/checkout/routes/checkout.routes';
import paymentRoutes from '../modules/payments/routes/payments.routes';
import catalogRoutes from '../modules/catalog/routes/catalog.routes';
import * as stripeWebhook from '../modules/payments/controllers/stripe.webhook';
import analyticsRoutes from '../modules/analytics/routes/analytics.routes';
import walletRoutes from '../modules/wallet/routes/wallet.routes';
import transactionRoutes from '../modules/transactions/routes/transactions.routes';
import treasuryRoutes from '../modules/treasury/routes/treasury.routes';
import riskRoutes from '../modules/risk/routes/risk.routes';
import merchantRoutes from '../modules/merchant/routes/merchant.routes';
import gatewayRoutes from '../modules/gateway/routes/gateway.routes';
import commerceRoutes from '../modules/commerce/routes/commerce.routes';
import developerRoutes from '../modules/developer/routes/developer.routes';
import adminRoutes from '../modules/admin/routes/admin.routes';
import aiRoutes from '../modules/ai/routes/ai.routes';

import platformRoutes from '../modules/platform/routes/platform.routes';

import settlementRoutes from '../modules/settlement/routes/settlement.routes';
import adminSettlementRoutes from '../modules/settlement/routes/admin-settlement.routes';
import adminSettlementOperationsRoutes from '../modules/settlement/routes/admin-settlement-operations.routes';
import { requirePlatformAdmin } from '../middleware/platform-admin.middleware';
import merchantPayoutRoutes from '../modules/payout/routes/merchant-payout.routes';
import adminMerchantPayoutRoutes from '../modules/payout/routes/admin-merchant-payout.routes';

import { authMiddleware } from '../middleware/auth.middleware';
import { processSettlements } from './jobs/settlement.job';

import platformCapabilitiesRoutes from '../modules/platform/routes/platform-capabilities.routes';

import securityChallengeRoutes from '../modules/security/security-challenge.routes';
import developerApiKeyV2Routes from '../modules/security/developer-api-key.routes';
import bankingRoutes from '../modules/banking/banking.routes';
import { s2sIdempotencyMiddleware } from '../middleware/s2s-idempotency.middleware';
import { payoutSecurityGate } from '../middleware/payout-security-gate.middleware';
const app = express();

const PORT = Number(process.env.PORT || 8085);
const APP_NAME = process.env.APP_NAME || 'XPAY.Expert';
const APP_VERSION = process.env.APP_VERSION || '4.0.0-lab';

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'https://xpay.expert,https://www.xpay.expert,http://localhost:3000'
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error(`Origin não permitida pelo CORS: ${origin}`)
      );
    },
    credentials: true,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'x-api-key',
      'Accept'
    ]
  })
);

/*
|--------------------------------------------------------------------------
| STRIPE RAW WEBHOOK
|--------------------------------------------------------------------------
|
| Esta rota precisa do corpo bruto para validar Stripe-Signature.
| Deve obrigatoriamente ser montada antes de express.json().
|
*/

app.post(
  '/api/v1/payments/webhooks/stripe/:gatewayVaultId',
  express.raw({
    type: 'application/json',
    limit: '2mb'
  }),
  stripeWebhook.handleStripeWebhook
);

app.post(
  '/api/v1/payments/webhooks/stripe',
  express.raw({
    type: 'application/json',
    limit: '2mb'
  }),
  stripeWebhook.handleStripeWebhook
);

app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
  );

  next();
});

/*
|--------------------------------------------------------------------------
| CRON JOBS
|--------------------------------------------------------------------------
*/

cron.schedule(
  '0 0 * * *',
  () => {
    console.log(
      '⏰ [CRON] Iniciando liquidação diária do XPAY.Expert...'
    );

    processSettlements().catch(error => {
      console.error(
        '❌ [CRON] Falha na liquidação:',
        error
      );
    });
  },
  {
    timezone: 'UTC'
  }
);

console.log(
  String(
    process.env
      .XPAY_LEGACY_SETTLEMENT_CRON_ENABLED ??
    'false'
  )
    .trim()
    .toLowerCase() === 'true'
    ? '✅ [CRON] Liquidação automática legada do XPAY.Expert iniciada.'
    : '⏸️ [CRON] Liquidação automática legada desativada; Settlement Ledger autoritativo ativo.'
);

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    version: APP_VERSION,
    engine: APP_NAME,
    environment: process.env.APP_ENV || 'lab',
    status: 'ONLINE',
    timestamp: new Date().toISOString()
  });
});

/*
|--------------------------------------------------------------------------
| PUBLIC API
|--------------------------------------------------------------------------
*/

app.use('/api/v1/merchant/payouts', payoutSecurityGate);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/banking', bankingRoutes);
app.use('/api/v1/developer/api-keys', developerApiKeyV2Routes);
app.use('/api/v1/security', securityChallengeRoutes);
app.use('/api/v1/platform', platformCapabilitiesRoutes);
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/payments/charge', s2sIdempotencyMiddleware);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/catalog', catalogRoutes);
app.use('/api/v1/ai', aiRoutes);

/*
|--------------------------------------------------------------------------
| PRIVATE API
|--------------------------------------------------------------------------
*/

const api = express.Router();

api.use(authMiddleware);

api.use('/platform', platformRoutes);


api.use('/settlements', settlementRoutes);
api.use('/merchant/payouts', merchantPayoutRoutes);

api.use(
  '/admin/settlements',
  requirePlatformAdmin,
  adminSettlementRoutes
);

api.use(
  '/admin/settlements',
  requirePlatformAdmin,
  adminSettlementOperationsRoutes
);
api.use(
  '/admin/merchant-payouts',
  requirePlatformAdmin,
  adminMerchantPayoutRoutes
);


api.use('/merchant', merchantRoutes);
api.use('/gateway-vault', gatewayRoutes);
api.use('/transactions', transactionRoutes);
api.use('/wallets', walletRoutes);
api.use('/analytics', analyticsRoutes);
api.use('/risk', riskRoutes);
api.use('/treasury', treasuryRoutes);
api.use('/', commerceRoutes);
api.use('/', developerRoutes);
api.use('/', adminRoutes);

app.use('/api/v1', api);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint não encontrado.'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `🚀 ${APP_NAME} ${APP_VERSION} listening on ${PORT}`
  );
});
