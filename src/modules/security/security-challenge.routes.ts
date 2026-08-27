import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  completeEmail,
  listSecurityPurposes,
  requestChallenge,
  verifyChallenge
} from './security-challenge.controller';

const router = Router();

router.use(authMiddleware);
router.get('/purposes', listSecurityPurposes);
router.post('/challenges/request', requestChallenge);
router.post('/challenges/verify', verifyChallenge);
router.post('/email/complete', completeEmail);

export default router;
