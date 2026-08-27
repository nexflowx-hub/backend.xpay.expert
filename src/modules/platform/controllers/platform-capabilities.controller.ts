import type {
  Request,
  Response
} from 'express';

import {
  getPlatformCapabilities
} from '../services/platform-capabilities.service';

interface AuthenticatedIdentity {
  id?: string;
  merchantId?: string;
  email?: string;
  role?: string;
}

type AuthenticatedRequest =
  Request & {
    user?: AuthenticatedIdentity;
    merchantId?: string;
  };

export const getCapabilities =
  async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> => {
    const merchantId =
      String(
        req.user?.id ??
        req.user?.merchantId ??
        req.merchantId ??
        ''
      ).trim();

    if (!merchantId) {
      return res
        .status(401)
        .json({
          success: false,
          error: {
            code:
              'UNAUTHORIZED',
            message:
              'Sessão não autenticada.'
          }
        });
    }

    const capabilities =
      getPlatformCapabilities({
        id:
          merchantId,
        email:
          req.user?.email ??
          null,
        role:
          req.user?.role ??
          null
      });

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate'
    );

    return res.json({
      success: true,
      data:
        capabilities
    });
  };
