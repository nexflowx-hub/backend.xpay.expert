import type { Request, Response } from 'express';
import {
  SECURITY_PURPOSES,
  requestSecurityChallenge,
  verifySecurityChallenge,
  completeEmailVerification,
  type SecurityPurpose
} from './security-challenge.service';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    merchantId?: string;
    email?: string;
  };
  merchantId?: string;
};

const identity = (req: AuthenticatedRequest) => ({
  merchantId: String(
    req.user?.id ??
    req.user?.merchantId ??
    req.merchantId ??
    ''
  ).trim(),
  email: String(req.user?.email ?? '').trim()
});

const sendError = (res: Response, error: unknown): Response => {
  const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  const status =
    code.includes('RATE_LIMITED') ? 429 :
    code.includes('NOT_FOUND') ? 404 :
    code.includes('INVALID') ||
    code.includes('EXPIRED') ||
    code.includes('LOCKED') ? 400 :
    500;

  return res.status(status).json({
    success: false,
    error: {
      code,
      message: code
    }
  });
};

export const listSecurityPurposes = async (
  _req: AuthenticatedRequest,
  res: Response
): Promise<Response> =>
  res.json({
    success: true,
    data: {
      purposes: SECURITY_PURPOSES
    }
  });

export const requestChallenge = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const current = identity(req);
    const purpose = String(req.body?.purpose ?? '') as SecurityPurpose;

    if (!current.merchantId || !current.email) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authenticated Merchant identity is required.'
        }
      });
    }

    if (!SECURITY_PURPOSES.includes(purpose)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SECURITY_PURPOSE',
          message: 'Unsupported security challenge purpose.'
        }
      });
    }

    const data = await requestSecurityChallenge({
      merchantId: current.merchantId,
      email: current.email,
      purpose,
      resourceType: req.body?.resourceType ?? null,
      resourceId: req.body?.resourceId ?? null,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null
    });

    return res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const verifyChallenge = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const current = identity(req);

    if (!current.merchantId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authenticated Merchant identity is required.'
        }
      });
    }

    const data = await verifySecurityChallenge({
      merchantId: current.merchantId,
      challengeId: String(req.body?.challengeId ?? ''),
      code: String(req.body?.code ?? '')
    });

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return sendError(res, error);
  }
};


export const completeEmail = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const current = identity(req);
    const actionToken = String(req.get('X-Security-Action') ?? '');

    if (!current.merchantId || !actionToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SECURITY_ACTION_TOKEN_REQUIRED',
          message: 'A verified email security action is required.'
        }
      });
    }

    await completeEmailVerification({
      token: actionToken,
      merchantId: current.merchantId
    });

    return res.json({
      success: true,
      data: {
        emailVerified: true
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
};
