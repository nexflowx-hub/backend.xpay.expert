import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  cancelTransfer,
  confirmTransfer,
  createBeneficiary,
  createFxQuote,
  createTransfer,
  getBankingAccount,
  getBankingCapabilities,
  getTransfer,
  listBankingAccountTransactions,
  listBankingAccounts,
  listBeneficiaries,
  listStatements,
  listTransfers
} from './banking.controller';

const router = Router();

router.use(authMiddleware);

router.get('/capabilities', getBankingCapabilities);

router.get('/accounts', listBankingAccounts);
router.get('/accounts/:id', getBankingAccount);
router.get('/accounts/:id/transactions', listBankingAccountTransactions);

router.get('/beneficiaries', listBeneficiaries);
router.post('/beneficiaries', createBeneficiary);

router.get('/transfers', listTransfers);
router.post('/transfers', createTransfer);
router.get('/transfers/:id', getTransfer);
router.post('/transfers/:id/confirm', confirmTransfer);
router.post('/transfers/:id/cancel', cancelTransfer);

router.post('/fx-quotes', createFxQuote);
router.get('/statements', listStatements);

export default router;
