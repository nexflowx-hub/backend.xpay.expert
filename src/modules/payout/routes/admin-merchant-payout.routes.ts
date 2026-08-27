import {
  Router
} from 'express';

import * as controller
  from '../controllers/admin-merchant-payout.controller';

const router =
  Router();

router.get(
  '/',
  controller.list
);

router.get(
  '/:id',
  controller.getOne
);

router.post(
  '/:id/fx-quote',
  controller.quoteFx
);

router.post(
  '/:id/approve',
  controller.approve
);

router.post(
  '/:id/processing',
  controller.processing
);

router.post(
  '/:id/paid',
  controller.paid
);

router.post(
  '/:id/reject',
  controller.reject
);

export default router;
