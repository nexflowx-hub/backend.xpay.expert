import crypto from 'crypto';

import {
  Prisma
} from '@prisma/client';

import {
  Response
} from 'express';

import prisma from '../../../core/prisma';

import {
  AuthRequest
} from '../../../middleware/auth.middleware';

class ValidationError
  extends Error {}

const unauthorized = (
  res: Response
) =>
  res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message:
        'Sessão não autenticada.'
    }
  });

const getMerchantId = (
  req: AuthRequest
): string | null =>
  req.user?.id
    ? String(req.user.id)
    : null;

const getParamId = (
  value: string | string[]
): string =>
  Array.isArray(value)
    ? value[0]
    : String(value);

const normalizeCurrency = (
  value: unknown
): string => {
  const currency = String(
    value ?? 'EUR'
  )
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError(
      'Moeda inválida.'
    );
  }

  return currency;
};

const normalizeDomain = (
  value: unknown
): string | null => {
  const input = String(
    value ?? ''
  ).trim();

  if (!input) {
    return null;
  }

  const domain = input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '');

  const domainPattern =
    /^(localhost(?::\d+)?|([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d+)?$/;

  if (!domainPattern.test(domain)) {
    throw new ValidationError(
      'Domínio inválido.'
    );
  }

  return domain;
};

const createStoreCode = (
  name: string
): string => {
  const prefix = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'STORE';

  const suffix = crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase();

  return `${prefix}-${suffix}`;
};

const storeSelect = {
  id: true,
  storeCode: true,
  name: true,
  domain: true,
  status: true,
  revenue: true,
  currency: true,
  routingRules: true,
  logoUrl: true,
  theme: true,
  createdAt: true
} satisfies Prisma.StoreSelect;

export const getProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const merchant =
      await prisma.merchant.findUnique({
        where: {
          id: merchantId
        },
        select: {
          id: true,
          email: true,
          name: true,
          company: true,
          tier: true,
          status: true,
          kycStatus: true,
          riskScore: true,
          createdAt: true,
          updatedAt: true,

          stores: {
            select: storeSelect,
            orderBy: {
              createdAt: 'asc'
            }
          },

          wallets: {
            select: {
              id: true,
              currency: true,
              label: true,
              balance: true,
              available: true,
              reserved: true,
              type: true,
              cardLast4: true,
              createdAt: true
            },
            orderBy: {
              currency: 'asc'
            }
          }
        }
      });

    if (!merchant) {
      return res.status(404).json({
        success: false,
        error: {
          code:
            'MERCHANT_NOT_FOUND',
          message:
            'Conta não encontrada.'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: merchant
    });
  } catch (error) {
    console.error(
      '[MERCHANT_PROFILE_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code:
          'MERCHANT_PROFILE_ERROR',
        message:
          'Não foi possível carregar o perfil.'
      }
    });
  }
};

export const updateProfile = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const data: {
      name?: string;
      company?: string | null;
    } = {};

    if (req.body.name !== undefined) {
      const name = String(
        req.body.name
      ).trim();

      if (name.length < 2) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_NAME',
            message:
              'O nome deve possuir pelo menos 2 caracteres.'
          }
        });
      }

      data.name = name;
    }

    if (
      req.body.company !== undefined ||
      req.body.companyName !== undefined
    ) {
      const company = String(
        req.body.company ??
          req.body.companyName ??
          ''
      ).trim();

      data.company =
        company || null;
    }

    if (
      data.name === undefined &&
      data.company === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_CHANGES',
          message:
            'Nenhuma alteração foi enviada.'
        }
      });
    }

    const merchant =
      await prisma.merchant.update({
        where: {
          id: merchantId
        },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          company: true,
          tier: true,
          status: true,
          kycStatus: true,
          riskScore: true,
          createdAt: true,
          updatedAt: true
        }
      });

    return res.status(200).json({
      success: true,
      data: merchant
    });
  } catch (error) {
    console.error(
      '[MERCHANT_PROFILE_UPDATE_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code:
          'MERCHANT_PROFILE_UPDATE_ERROR',
        message:
          'Não foi possível atualizar o perfil.'
      }
    });
  }
};

export const getStores = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const stores =
      await prisma.store.findMany({
        where: {
          merchantId
        },
        select: storeSelect,
        orderBy: {
          createdAt: 'asc'
        }
      });

    return res.status(200).json({
      success: true,
      data: stores
    });
  } catch (error) {
    console.error(
      '[STORES_LIST_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'STORES_LIST_ERROR',
        message:
          'Não foi possível carregar as Stores.'
      }
    });
  }
};

export const createStore = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const name = String(
      req.body.name ?? ''
    ).trim();

    if (name.length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STORE_NAME',
          message:
            'O nome da Store deve possuir pelo menos 2 caracteres.'
        }
      });
    }

    const domain = normalizeDomain(
      req.body.domain
    );

    const currency =
      normalizeCurrency(
        req.body.currency
      );

    let store:
      | Prisma.StoreGetPayload<{
          select: typeof storeSelect;
        }>
      | null = null;

    for (
      let attempt = 0;
      attempt < 5;
      attempt += 1
    ) {
      try {
        store =
          await prisma.store.create({
            data: {
              merchantId,
              storeCode:
                createStoreCode(name),
              name,
              domain,
              currency,
              status: 'draft'
            },
            select: storeSelect
          });

        break;
      } catch (error) {
        if (
          error instanceof
            Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    if (!store) {
      throw new Error(
        'Não foi possível gerar um Store Code único.'
      );
    }

    return res.status(201).json({
      success: true,
      data: store
    });
  } catch (error) {
    if (
      error instanceof ValidationError
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      });
    }

    console.error(
      '[STORE_CREATE_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'STORE_CREATE_ERROR',
        message:
          'Não foi possível criar a Store.'
      }
    });
  }
};

export const getStore = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const storeId = getParamId(
      req.params.id
    );

    const store =
      await prisma.store.findFirst({
        where: {
          id: storeId,
          merchantId
        },
        select: {
          ...storeSelect,

          apiKeys: {
            select: {
              id: true,
              name: true,
              scopes: true,
              environment: true,
              lastUsedAt: true,
              createdAt: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          },

          webhooks: {
            select: {
              id: true,
              url: true,
              events: true,
              status: true,
              successRate: true,
              lastDeliveryAt: true,
              createdAt: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          },

          gatewayVaults: {
            select: {
              id: true,
              provider: true,
              isActive: true,
              createdAt: true
            },
            orderBy: {
              createdAt: 'desc'
            }
          }
        }
      });

    if (!store) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STORE_NOT_FOUND',
          message:
            'Store não encontrada.'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: store
    });
  } catch (error) {
    console.error(
      '[STORE_DETAIL_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'STORE_DETAIL_ERROR',
        message:
          'Não foi possível carregar a Store.'
      }
    });
  }
};

export const updateStore = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const merchantId =
      getMerchantId(req);

    if (!merchantId) {
      return unauthorized(res);
    }

    const storeId = getParamId(
      req.params.id
    );

    const existing =
      await prisma.store.findFirst({
        where: {
          id: storeId,
          merchantId
        },
        select: {
          id: true
        }
      });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STORE_NOT_FOUND',
          message:
            'Store não encontrada.'
        }
      });
    }

    const data: {
      name?: string;
      domain?: string | null;
      currency?: string;
      logoUrl?: string | null;
      theme?: string;
    } = {};

    if (req.body.name !== undefined) {
      const name = String(
        req.body.name
      ).trim();

      if (name.length < 2) {
        return res.status(400).json({
          success: false,
          error: {
            code:
              'INVALID_STORE_NAME',
            message:
              'O nome da Store deve possuir pelo menos 2 caracteres.'
          }
        });
      }

      data.name = name;
    }

    if (
      req.body.domain !== undefined
    ) {
      data.domain =
        normalizeDomain(
          req.body.domain
        );
    }

    if (
      req.body.currency !== undefined
    ) {
      data.currency =
        normalizeCurrency(
          req.body.currency
        );
    }

    if (
      req.body.logoUrl !== undefined
    ) {
      const logoUrl = String(
        req.body.logoUrl ?? ''
      ).trim();

      if (logoUrl) {
        try {
          new URL(logoUrl);
        } catch {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_LOGO_URL',
              message:
                'URL do logótipo inválida.'
            }
          });
        }
      }

      data.logoUrl =
        logoUrl || null;
    }

    if (
      req.body.theme !== undefined
    ) {
      const theme = String(
        req.body.theme
      )
        .trim()
        .toLowerCase();

      if (
        ![
          'light',
          'dark',
          'system'
        ].includes(theme)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_THEME',
            message:
              'Tema inválido.'
          }
        });
      }

      data.theme = theme;
    }

    if (
      Object.keys(data).length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_CHANGES',
          message:
            'Nenhuma alteração foi enviada.'
        }
      });
    }

    const store =
      await prisma.store.update({
        where: {
          id: storeId
        },
        data,
        select: storeSelect
      });

    return res.status(200).json({
      success: true,
      data: store
    });
  } catch (error) {
    if (
      error instanceof ValidationError
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      });
    }

    console.error(
      '[STORE_UPDATE_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'STORE_UPDATE_ERROR',
        message:
          'Não foi possível atualizar a Store.'
      }
    });
  }
};
