import {
  Router
} from 'express';

import * as merchant from '../controllers/merchant.controller';

const router = Router();

router.get(
  '/profile',
  merchant.getProfile
);

router.patch(
  '/profile',
  merchant.updateProfile
);

router.get(
  '/stores',
  merchant.getStores
);

router.post(
  '/stores',
  merchant.createStore
);

router.get(
  '/stores/:id',
  merchant.getStore
);

router.patch(
  '/stores/:id',
  merchant.updateStore
);

export default router;
