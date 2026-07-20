import {
  Request,
  Response
} from 'express';

import prisma from '../../../core/prisma';

const extractApiKey = (
  req: Request
): string => {
  const authorization =
    req.headers.authorization;

  if (
    authorization?.startsWith(
      'Bearer '
    )
  ) {
    return authorization
      .slice('Bearer '.length)
      .trim();
  }

  return String(
    req.headers['x-api-key'] ??
    ''
  ).trim();
};

const hasCatalogReadScope = (
  scopes: string[]
): boolean => {
  /*
   * Compatibilidade inicial:
   * chaves sem scopes de catálogo continuam
   * autorizadas. Quando catalog:* existir,
   * catalog:read passa a ser obrigatório.
   */
  const catalogScopes =
    scopes.filter(
      scope =>
        scope.startsWith(
          'catalog:'
        )
    );

  if (
    catalogScopes.length === 0
  ) {
    return true;
  }

  return (
    scopes.includes('*') ||
    scopes.includes(
      'catalog:read'
    )
  );
};

const getStoreContext =
  async (
    req: Request
  ) => {
    const apiKey =
      extractApiKey(req);

    if (!apiKey) {
      return {
        error: {
          status: 401,
          code:
            'API_KEY_REQUIRED',
          message:
            'API Key não fornecida.'
        }
      };
    }

    const keyRecord =
      await prisma.apiKey
        .findUnique({
          where: {
            key: apiKey
          },
          include: {
            store: true
          }
        });

    if (
      !keyRecord ||
      keyRecord.store.status !==
        'active'
    ) {
      return {
        error: {
          status: 401,
          code:
            'ACCESS_DENIED',
          message:
            'API Key inválida ou Store inativa.'
        }
      };
    }

    if (
      !hasCatalogReadScope(
        keyRecord.scopes
      )
    ) {
      return {
        error: {
          status: 403,
          code:
            'CATALOG_SCOPE_REQUIRED',
          message:
            'A API Key não possui catalog:read.'
        }
      };
    }

    return {
      keyRecord,
      store:
        keyRecord.store
    };
  };

const effectiveProduct = (
  product: any,
  storeId: string
) => {
  const override =
    (
      product.storeLinks ?? []
    ).find(
      (link: any) =>
        link.storeId ===
        storeId
    );

  const price =
    override?.price !== null &&
    override?.price !== undefined
      ? Number(
          override.price
        )
      : Number(
          product.price
        );

  const currency =
    override?.currency ??
    product.currency;

  const stock =
    override?.stock !== null &&
    override?.stock !== undefined
      ? Number(
          override.stock
        )
      : product.stock === null
        ? null
        : Number(
            product.stock
          );

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description:
      product.description,

    price,
    currency,
    stock,

    available:
      stock === null ||
      stock > 0,

    catalogScope:
      product.catalogScope,

    storeOverride:
      override
        ? {
            enabled:
              override.enabled,

            price:
              override.price ===
                null
                ? null
                : Number(
                    override.price
                  ),

            currency:
              override.currency,

            stock:
              override.stock ===
                null
                ? null
                : Number(
                    override.stock
                  )
          }
        : null,

    metadata:
      product.metadata ?? {},

    createdAt:
      product.createdAt
        .toISOString(),

    updatedAt:
      product.updatedAt
        .toISOString()
  };
};

const availabilityWhere = (
  merchantId: string,
  storeId: string
) => ({
  merchantId,
  active: true,

  publicationStatus:
    'active',

  OR: [
    {
      catalogScope:
        'selected',

      storeLinks: {
        some: {
          storeId,
          enabled: true
        }
      }
    },

    {
      catalogScope:
        'global',

      NOT: {
        storeLinks: {
          some: {
            storeId,
            enabled: false
          }
        }
      }
    }
  ]
});

export const getCatalogProducts =
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const context =
        await getStoreContext(
          req
        );

      if (context.error) {
        return res
          .status(
            context.error.status
          )
          .json({
            success: false,
            error: {
              code:
                context.error.code,
              message:
                context.error.message
            }
          });
      }

      const store =
        context.store!;

      const page =
        Math.max(
          1,
          Number(
            req.query.page ?? 1
          )
        );

      const limit =
        Math.min(
          100,
          Math.max(
            1,
            Number(
              req.query.limit ?? 50
            )
          )
        );

      const search =
        String(
          req.query.search ?? ''
        ).trim();

      const where: any =
        availabilityWhere(
          store.merchantId,
          store.id
        );

      if (search) {
        where.AND = [
          {
            OR: [
              {
                name: {
                  contains: search,
                  mode:
                    'insensitive'
                }
              },

              {
                sku: {
                  contains: search,
                  mode:
                    'insensitive'
                }
              },

              {
                description: {
                  contains: search,
                  mode:
                    'insensitive'
                }
              }
            ]
          }
        ];
      }

      const [
        products,
        total
      ] = await Promise.all([
        prisma.product.findMany({
          where,

          include: {
            storeLinks: {
              where: {
                storeId:
                  store.id
              }
            }
          },

          orderBy: {
            createdAt: 'desc'
          },

          skip:
            (page - 1) *
            limit,

          take: limit
        }),

        prisma.product.count({
          where
        })
      ]);

      return res.status(200).json({
        success: true,

        store: {
          id: store.id,
          code:
            store.storeCode,
          name: store.name,
          currency:
            store.currency
        },

        data:
          products.map(
            product =>
              effectiveProduct(
                product,
                store.id
              )
          ),

        meta: {
          page,
          limit,
          total,
          pages:
            Math.ceil(
              total / limit
            )
        }
      });
    } catch (error) {
      console.error(
        '[CATALOG_PRODUCTS_ERROR]',
        error
      );

      return res.status(500).json({
        success: false,
        error: {
          code:
            'CATALOG_PRODUCTS_ERROR',
          message:
            'Erro ao carregar catálogo.'
        }
      });
    }
  };

export const getCatalogProduct =
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const context =
        await getStoreContext(
          req
        );

      if (context.error) {
        return res
          .status(
            context.error.status
          )
          .json({
            success: false,
            error: {
              code:
                context.error.code,
              message:
                context.error.message
            }
          });
      }

      const store =
        context.store!;

      const identifier =
        String(
          req.params.identifier ??
          ''
        ).trim();

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(identifier);

      const product =
        await prisma.product
          .findFirst({
            where: {
              ...availabilityWhere(
                store.merchantId,
                store.id
              ),

              ...(isUuid
                ? {
                    id:
                      identifier
                  }
                : {
                    sku:
                      identifier
                  })
            },

            include: {
              storeLinks: {
                where: {
                  storeId:
                    store.id
                }
              }
            }
          });

      if (!product) {
        return res.status(404).json({
          success: false,
          error: {
            code:
              'PRODUCT_NOT_FOUND',
            message:
              'Produto não disponível nesta Store.'
          }
        });
      }

      return res.status(200).json({
        success: true,

        store: {
          id: store.id,
          code:
            store.storeCode,
          name: store.name
        },

        data:
          effectiveProduct(
            product,
            store.id
          )
      });
    } catch (error) {
      console.error(
        '[CATALOG_PRODUCT_ERROR]',
        error
      );

      return res.status(500).json({
        success: false,
        error: {
          code:
            'CATALOG_PRODUCT_ERROR',
          message:
            'Erro ao carregar produto.'
        }
      });
    }
  };
