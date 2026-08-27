import {
  Router
} from 'express';

import * as controller
  from '../controllers/merchant-payout.controller';

const router =
  Router();

router.get(
  '/options',
  controller.options
);

router.post(
  '/validate',
  controller.validate
);

router.post(
  '/',
  controller.create
);

router.get(
  '/',
  controller.list
);

router.get(
  '/:id',
  controller.getOne
);

router.post(
  '/:id/cancel',
  controller.cancel
);

export default router;
