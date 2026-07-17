import { Response } from 'express';

import prisma from '../../../core/prisma';
import { AuthRequest } from '../../../middleware/auth.middleware';

function getMerchantId(
  req: AuthRequest,
  res: Response
): string | null {
  const merchantId = req.user?.id;

  if (!merchantId) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Merchant não autenticado.'
      }
    });

    return null;
  }

  return merchantId;
}

export const listGateways = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = getMerchantId(req, res);

  if (!merchantId) {
    return;
  }

  try {
    const gateways = await prisma.gatewayVault.findMany({
      where: {
        merchantId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json({
      success: true,
      data: gateways
    });
  } catch (error) {
    console.error('[GATEWAYS_LIST]', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'GATEWAY_LIST_ERROR',
        message: 'Erro ao carregar gateways.'
      }
    });
  }
};

export const getGateway = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = getMerchantId(req, res);

  if (!merchantId) {
    return;
  }

  try {
    const gateway = await prisma.gatewayVault.findFirst({
      where: {
        id: String(req.params.id),
        merchantId
      }
    });

    if (!gateway) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GATEWAY_NOT_FOUND',
          message: 'Gateway não encontrado.'
        }
      });
    }

    return res.json({
      success: true,
      data: gateway
    });
  } catch (error) {
    console.error('[GATEWAY_GET]', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'GATEWAY_GET_ERROR',
        message: 'Erro ao carregar gateway.'
      }
    });
  }
};

export const createGateway = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = getMerchantId(req, res);

  if (!merchantId) {
    return;
  }

  try {
    const {
      storeId,
      provider,
      credentials,
      isActive
    } = req.body;

    if (
      !provider ||
      typeof provider !== 'string' ||
      !provider.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PROVIDER',
          message: 'O provider é obrigatório.'
        }
      });
    }

    if (
      !credentials ||
      typeof credentials !== 'object' ||
      Array.isArray(credentials)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'As credenciais do provider são obrigatórias.'
        }
      });
    }

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: {
          id: String(storeId),
          merchantId
        },
        select: {
          id: true
        }
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'STORE_NOT_FOUND',
            message:
              'A Store não existe ou não pertence ao Merchant.'
          }
        });
      }
    }

    const gateway = await prisma.gatewayVault.create({
      data: {
        merchantId,
        storeId: storeId ? String(storeId) : null,
        provider: provider.trim(),
        credentials,
        isActive: isActive ?? true
      }
    });

    return res.status(201).json({
      success: true,
      data: gateway
    });
  } catch (error) {
    console.error('[GATEWAY_CREATE]', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'GATEWAY_CREATE_ERROR',
        message: 'Erro ao criar gateway.'
      }
    });
  }
};

export const updateGateway = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = getMerchantId(req, res);

  if (!merchantId) {
    return;
  }

  try {
    const gatewayId = String(req.params.id);

    const existing = await prisma.gatewayVault.findFirst({
      where: {
        id: gatewayId,
        merchantId
      }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GATEWAY_NOT_FOUND',
          message: 'Gateway não encontrado.'
        }
      });
    }

    const {
      storeId,
      provider,
      credentials,
      isActive
    } = req.body;

    if (storeId !== undefined && storeId !== null) {
      const store = await prisma.store.findFirst({
        where: {
          id: String(storeId),
          merchantId
        },
        select: {
          id: true
        }
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'STORE_NOT_FOUND',
            message:
              'A Store não existe ou não pertence ao Merchant.'
          }
        });
      }
    }

    const gateway = await prisma.gatewayVault.update({
      where: {
        id: gatewayId
      },
      data: {
        ...(storeId !== undefined
          ? {
              storeId: storeId
                ? String(storeId)
                : null
            }
          : {}),
        ...(provider !== undefined
          ? {
              provider: String(provider).trim()
            }
          : {}),
        ...(credentials !== undefined
          ? {
              credentials
            }
          : {}),
        ...(isActive !== undefined
          ? {
              isActive: Boolean(isActive)
            }
          : {})
      }
    });

    return res.json({
      success: true,
      data: gateway
    });
  } catch (error) {
    console.error('[GATEWAY_UPDATE]', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'GATEWAY_UPDATE_ERROR',
        message: 'Erro ao atualizar gateway.'
      }
    });
  }
};

export const deleteGateway = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = getMerchantId(req, res);

  if (!merchantId) {
    return;
  }

  try {
    const gatewayId = String(req.params.id);

    const existing = await prisma.gatewayVault.findFirst({
      where: {
        id: gatewayId,
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
          code: 'GATEWAY_NOT_FOUND',
          message: 'Gateway não encontrado.'
        }
      });
    }

    await prisma.gatewayVault.delete({
      where: {
        id: gatewayId
      }
    });

    return res.json({
      success: true,
      data: {
        id: gatewayId,
        deleted: true
      }
    });
  } catch (error) {
    console.error('[GATEWAY_DELETE]', error);

    return res.status(500).json({
      success: false,
      error: {
        code: 'GATEWAY_DELETE_ERROR',
        message: 'Erro ao eliminar gateway.'
      }
    });
  }
};
