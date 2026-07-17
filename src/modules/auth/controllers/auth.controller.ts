import {
  Request,
  Response
} from 'express';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import prisma from '../../../core/prisma';

import {
  JWT_EXPIRES_IN,
  JWT_SECRET
} from '../../../core/security';

import {
  AuthRequest
} from '../../../middleware/auth.middleware';

const normalizeEmail = (
  value: unknown
): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const createToken = (
  merchantId: string
): string =>
  jwt.sign(
    {
      id: merchantId,
      role: 'merchant'
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN
    }
  );

const publicMerchant = (
  merchant: {
    id: string;
    name: string;
    email: string;
    company?: string | null;
    tier?: string;
    status?: string;
    kycStatus?: string;
  }
) => ({
  id: merchant.id,
  name: merchant.name,
  email: merchant.email,
  company: merchant.company ?? null,
  tier: merchant.tier ?? null,
  status: merchant.status ?? null,
  verificationStatus:
    merchant.kycStatus ?? null
});

export const login = async (
  req: Request,
  res: Response
) => {
  try {
    const email = normalizeEmail(
      req.body.email
    );

    const password = String(
      req.body.password ?? ''
    );

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Email e password são obrigatórios.'
        }
      });
    }

    const merchant =
      await prisma.merchant.findUnique({
        where: {
          email
        }
      });

    if (
      !merchant ||
      !(await bcrypt.compare(
        password,
        merchant.passwordHash
      ))
    ) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Credenciais inválidas.'
        }
      });
    }

    if (
      String(merchant.status).toLowerCase() ===
      'suspended'
    ) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message:
            'Esta conta encontra-se suspensa.'
        }
      });
    }

    const token = createToken(
      merchant.id
    );

    return res.status(200).json({
      success: true,
      data: {
        token,
        merchant:
          publicMerchant(merchant)
      }
    });
  } catch (error) {
    console.error(
      '[AUTH_LOGIN_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_LOGIN_ERROR',
        message:
          'Não foi possível iniciar sessão.'
      }
    });
  }
};

export const register = async (
  req: Request,
  res: Response
) => {
  try {
    const email = normalizeEmail(
      req.body.email
    );

    const password = String(
      req.body.password ?? ''
    );

    const name = String(
      req.body.name ?? ''
    ).trim();

    const companyName = String(
      req.body.companyName ?? ''
    ).trim();

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Email, password e nome são obrigatórios.'
        }
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message:
            'A password deve possuir pelo menos 8 caracteres.'
        }
      });
    }

    const existing =
      await prisma.merchant.findUnique({
        where: {
          email
        },
        select: {
          id: true
        }
      });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message:
            'Este email já está registado.'
        }
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const merchant =
      await prisma.$transaction(
        async transaction => {
          const newMerchant =
            await transaction.merchant.create({
              data: {
                email,
                name,
                company:
                  companyName || null,
                passwordHash,
                status: 'active'
              }
            });

          await transaction.wallet.create({
            data: {
              merchantId:
                newMerchant.id,
              currency: 'EUR',
              label:
                'Main Account (EUR)',
              type: 'fiat'
            }
          });

          return newMerchant;
        }
      );

    const token = createToken(
      merchant.id
    );

    return res.status(201).json({
      success: true,
      data: {
        token,
        merchant:
          publicMerchant(merchant)
      }
    });
  } catch (error) {
    console.error(
      '[AUTH_REGISTER_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_REGISTER_ERROR',
        message:
          'Não foi possível criar a conta.'
      }
    });
  }
};

export const me = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      req.user?.id;

    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message:
            'Sessão não autenticada.'
        }
      });
    }

    const merchant =
      await prisma.merchant.findUnique({
        where: {
          id: merchantId
        },
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          tier: true,
          status: true,
          kycStatus: true
        }
      });

    if (!merchant) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message:
            'Conta não encontrada.'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        merchant:
          publicMerchant(merchant)
      }
    });
  } catch (error) {
    console.error(
      '[AUTH_ME_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ME_ERROR',
        message:
          'Não foi possível carregar a sessão.'
      }
    });
  }
};

export const logout = (
  _req: Request,
  res: Response
) =>
  res.status(200).json({
    success: true,
    data: {
      message: 'Sessão terminada.'
    }
  });
