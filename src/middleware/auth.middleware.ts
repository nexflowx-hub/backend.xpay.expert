import {
  Request,
  Response,
  NextFunction
} from 'express';

import jwt, {
  JwtPayload
} from 'jsonwebtoken';

import {
  JWT_SECRET
} from '../core/security';

export interface AuthUser
  extends JwtPayload {
  id: string;
  role: string;
}

export interface AuthRequest
  extends Request {
  user?: AuthUser;
  merchantId?: string;
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authorization =
    req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message:
          'Token não fornecido ou formato inválido.'
      }
    });
  }

  const token = authorization
    .slice('Bearer '.length)
    .trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token não fornecido.'
      }
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    if (
      typeof decoded === 'string' ||
      !decoded.id
    ) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token inválido.'
        }
      });
    }

    const user: AuthUser = {
      ...decoded,
      id: String(decoded.id),
      role: String(
        decoded.role || 'merchant'
      )
    };

    req.user = user;
    req.merchantId = user.id;

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED_OR_INVALID',
        message:
          'Token inválido ou expirado.'
      }
    });
  }
};
