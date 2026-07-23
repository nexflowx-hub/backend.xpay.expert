import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  createApiKeyV2,
  listApiKeysV2,
  revokeApiKeyV2,
  rotateApiKeyV2
} from './developer-api-key.controller';

const router = Router();

router.use(authMiddleware);

router.get('/', listApiKeysV2);
router.post('/', createApiKeyV2);
router.post('/:id/rotate', rotateApiKeyV2);
router.post('/:id/revoke', revokeApiKeyV2);

export default router;
