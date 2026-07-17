import { Router } from 'express';

import {
  getBootstrap
} from '../controllers/platform.controller';

const router = Router();

router.get(
  '/bootstrap',
  getBootstrap
);

export default router;
