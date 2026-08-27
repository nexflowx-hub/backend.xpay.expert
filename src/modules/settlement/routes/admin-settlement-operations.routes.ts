import {
  Router
} from 'express';

import {
  pilotMarkReady,
  releaseBatch
} from '../controllers/settlement-operations.controller';

const router =
  Router();

router.post(
  '/:id/pilot-ready',
  pilotMarkReady
);

router.post(
  '/:id/release',
  releaseBatch
);

export default router;
