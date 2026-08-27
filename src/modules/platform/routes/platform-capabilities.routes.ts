import {
  Router
} from 'express';

import {
  authMiddleware
} from '../../../middleware/auth.middleware';

import {
  getCapabilities
} from '../controllers/platform-capabilities.controller';

const router =
  Router();

router.get(
  '/capabilities',
  authMiddleware,
  getCapabilities
);

export default router;
