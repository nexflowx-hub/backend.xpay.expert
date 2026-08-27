import {
  Router
} from 'express';

import {
  listAdminSettlementBatches,
  refreshSettlementAvailability
} from '../controllers/settlement.controller';

const router =
  Router();

router.get(
  '/',
  listAdminSettlementBatches
);

router.post(
  '/refresh',
  refreshSettlementAvailability
);

export default router;
