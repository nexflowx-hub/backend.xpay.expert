import {
  Router
} from 'express';

import * as ctrl
  from '../controllers/commerce.controller';

import * as products
  from '../controllers/products.controller';

const router = Router();

router.get(
  '/transactions',
  ctrl.getTransactions
);

router.get(
  '/stores',
  ctrl.getStores
);

/*
|--------------------------------------------------------------------------
| PRODUCT CATALOG MANAGEMENT
|--------------------------------------------------------------------------
|
| Rotas privadas, protegidas por JWT no app.ts.
|
*/

router.get(
  '/products',
  products.getProducts
);

router.post(
  '/products',
  products.createProduct
);

router.get(
  '/products/:id',
  products.getProduct
);

router.patch(
  '/products/:id',
  products.updateProduct
);

router.delete(
  '/products/:id',
  products.archiveProduct
);

router.get(
  '/products/:id/stores',
  products.getProductStores
);

router.put(
  '/products/:id/stores',
  products.replaceProductStores
);

router.get(
  '/customers',
  ctrl.getCustomers
);

router.get(
  '/payment-links',
  ctrl.getPaymentLinks
);

router.get(
  '/invoices',
  ctrl.getInvoices
);

router.get(
  '/subscriptions',
  ctrl.getSubscriptions
);

export default router;
