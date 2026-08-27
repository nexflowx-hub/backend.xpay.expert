import {
  Router
} from 'express';

import {
  getMerchantSettlementBatch,
  getSettlementOverview,
  listMerchantSettlementBatches
} from '../controllers/settlement.controller';

const router =
  Router();

router.get(
  '/overview',
  getSettlementOverview
);

router.get(
  '/batches',
  listMerchantSettlementBatches
);

router.get(
  '/batches/:id',
  getMerchantSettlementBatch
);

export default router;
