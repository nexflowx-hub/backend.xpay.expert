import {
  Router
} from 'express';

import * as catalogController
  from '../controllers/catalog.controller';

const router = Router();

router.get(
  '/products',
  catalogController.getCatalogProducts
);

router.get(
  '/products/:identifier',
  catalogController.getCatalogProduct
);

export default router;
