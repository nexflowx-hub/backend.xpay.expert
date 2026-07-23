import type { NextFunction, Request, Response } from 'express';
import { consumeSecurityActionToken } from '../modules/security/security-challenge.service';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    merchantId?: string;
  };
  merchantId?: string;
};

const required = (): boolean =>
  String(
    process.env.XPAY_PAYOUT_SECURITY_CHALLENGE_REQUIRED ?? 'false'
  ).toLowerCase() === 'true';

export const payoutSecurityGate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const isCreate =
    req.method === 'POST' &&
    (req.path === '/' || req.path === '');

  if (!required() || !isCreate) {
    next();
    return;
  }

  const merchantId = String(
    req.user?.id ??
    req.user?.merchantId ??
    req.merchantId ??
    ''
  ).trim();

  const token = String(req.get('X-Security-Action') ?? '');

  if (!merchantId || !token) {
    res.status(400).json({
      success: false,
      error: {
        code: 'PAYOUT_SECURITY_CHALLENGE_REQUIRED',
        message: 'A verified email security challenge is required.'
      }
    });
    return;
  }

  try {
    await consumeSecurityActionToken({
      token,
      merchantId,
      expectedPurpose: 'confirm_payout_request'
    });

    next();
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : 'PAYOUT_SECURITY_CHALLENGE_INVALID';

    res.status(400).json({
      success: false,
      error: {
        code,
        message: code
      }
    });
  }
};
