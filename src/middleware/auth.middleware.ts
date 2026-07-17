import {
  Request,
  Response,
  NextFunction
} from 'express';

import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role?: string;
    iat?: number;
    exp?: number;
  };

  merchantId?: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 64) {
    throw new Error(
      'JWT_SECRET não configurado ou demasiado curto.'
    );
  }

  return secret;
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith('Bearer ')
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

  const token = authHeader.slice(7).trim();

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
      getJwtSecret()
    ) as AuthRequest['user'];

    if (!decoded?.id) {
      throw new Error('Token sem Merchant ID.');
    }

    (req as AuthRequest).user = decoded;
    (req as AuthRequest).merchantId = decoded.id;

    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token inválido ou expirado.'
      }
    });
  }
};
