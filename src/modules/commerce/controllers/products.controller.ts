import {
  Response
} from 'express';

import {
  Prisma
} from '@prisma/client';

import prisma from '../../../core/prisma';

import {
  AuthRequest
} from '../../../middleware/auth.middleware';

class ProductApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type StoreLinkInput = {
  storeId: string;
  enabled: boolean;
  price: number | null;
  currency: string | null;
  stock: number | null;
  metadata: Prisma.InputJsonValue;
};

const getMerchantId = (
  req: AuthRequest
): string | null =>
  req.user?.id
    ? String(req.user.id)
    : null;

const readParam = (
  value: string | string[] | undefined
): string =>
  Array.isArray(value)
    ? String(value[0] ?? '')
    : String(value ?? '');

const normalizeCurrency = (
  value: unknown,
  fallback = 'EUR'
): string => {
  const currency = String(
    value ?? fallback
  )
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ProductApiError(
      400,
      'INVALID_CURRENCY',
      'Moeda inválida.'
    );
  }

  return currency;
};

const normalizeScope = (
  value: unknown,
  fallback = 'global'
): string => {
  const scope = String(
    value ?? fallback
  )
    .trim()
    .toLowerCase();

  if (
    ![
      'global',
      'selected'
    ].includes(scope)
  ) {
    throw new ProductApiError(
      400,
      'INVALID_CATALOG_SCOPE',
      'catalogScope deve ser global ou selected.'
    );
  }

  return scope;
};

const normalizeStatus = (
  value: unknown,
  fallback = 'active'
): string => {
  const status = String(
    value ?? fallback
  )
    .trim()
    .toLowerCase();

  if (
    ![
      'draft',
      'active',
      'archived'
    ].includes(status)
  ) {
    throw new ProductApiError(
      400,
      'INVALID_PUBLICATION_STATUS',
      'publicationStatus deve ser draft, active ou archived.'
    );
  }

  return status;
};

const normalizePrice = (
  value: unknown,
  nullable = false
): number | null => {
  if (
    nullable &&
    (
      value === null ||
      value === undefined ||
      value === ''
    )
  ) {
    return null;
  }

  const price = Number(value);

  if (
    !Number.isFinite(price) ||
    price < 0
  ) {
    throw new ProductApiError(
      400,
      'INVALID_PRICE',
      'Preço inválido.'
    );
  }

  return Number(
    price.toFixed(2)
  );
};

const normalizeStock = (
  value: unknown
): number | null => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const stock = Number(value);

  if (
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    throw new ProductApiError(
      400,
      'INVALID_STOCK',
      'Stock deve ser um inteiro igual ou superior a zero.'
    );
  }

  return stock;
};

const normalizeMetadata = (
  value: unknown
): Prisma.InputJsonValue => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    try {
      /*
       * Remove undefined, funções e outros
       * valores incompatíveis com JSON.
       */
      return JSON.parse(
        JSON.stringify(value)
      ) as Prisma.InputJsonValue;
    } catch {
      throw new ProductApiError(
        400,
        'INVALID_METADATA',
        'metadata deve conter um objeto JSON válido.'
      );
    }
  }

  return {} as Prisma.InputJsonValue;
};

const parseStoreLinks = (
  input: unknown
): StoreLinkInput[] => {
  if (input === undefined) {
    return [];
  }

  if (!Array.isArray(input)) {
    throw new ProductApiError(
      400,
      'INVALID_STORES',
      'stores deve ser um array.'
    );
  }

  const links =
    input.map(item => {
      if (
        !item ||
        typeof item !== 'object'
      ) {
        throw new ProductApiError(
          400,
          'INVALID_STORE_LINK',
          'Associação de Store inválida.'
        );
      }

      const value =
        item as Record<
          string,
          unknown
        >;

      const storeId =
        String(
          value.storeId ??
          value.store_id ??
          ''
        ).trim();

      if (!storeId) {
        throw new ProductApiError(
          400,
          'STORE_ID_REQUIRED',
          'storeId é obrigatório.'
        );
      }

      return {
        storeId,

        enabled:
          typeof value.enabled ===
            'boolean'
            ? value.enabled
            : true,

        price:
          normalizePrice(
            value.price,
            true
          ),

        currency:
          value.currency === null ||
          value.currency === undefined ||
          value.currency === ''
            ? null
            : normalizeCurrency(
                value.currency
              ),

        stock:
          normalizeStock(
            value.stock
          ),

        metadata:
          normalizeMetadata(
            value.metadata
          )
      };
    });

  const uniqueIds =
    new Set(
      links.map(
        link => link.storeId
      )
    );

  if (
    uniqueIds.size !==
    links.length
  ) {
    throw new ProductApiError(
      400,
      'DUPLICATE_STORE',
      'A mesma Store foi enviada mais de uma vez.'
    );
  }

  return links;
};

const assertStoresBelongToMerchant =
  async (
    merchantId: string,
    links: StoreLinkInput[]
  ) => {
    if (links.length === 0) {
      return;
    }

    const storeIds =
      links.map(
        link => link.storeId
      );

    const count =
      await prisma.store.count({
        where: {
          merchantId,
          id: {
            in: storeIds
          }
        }
      });

    if (
      count !==
      storeIds.length
    ) {
      throw new ProductApiError(
        400,
        'INVALID_STORE',
        'Uma ou mais Stores não pertencem ao Merchant.'
      );
    }
  };

const productInclude = {
  storeLinks: {
    include: {
      store: {
        select: {
          id: true,
          storeCode: true,
          name: true,
          domain: true,
          status: true,
          currency: true
        }
      }
    },
    orderBy: {
      createdAt: 'asc' as const
    }
  }
};

const serializeProduct = (
  product: any
) => ({
  id: product.id,
  merchantId: product.merchantId,
  sku: product.sku,
  name: product.name,
  description: product.description,

  price:
    Number(product.price),

  currency:
    product.currency,

  stock:
    product.stock === null
      ? null
      : Number(product.stock),

  active:
    product.active,

  catalogScope:
    product.catalogScope,

  publicationStatus:
    product.publicationStatus,

  status:
    product.publicationStatus,

  sales:
    Number(
      product.sales ?? 0
    ),

  metadata:
    product.metadata ?? {},

  stores:
    (
      product.storeLinks ?? []
    ).map((link: any) => ({
      id: link.id,
      storeId: link.storeId,
      enabled: link.enabled,

      price:
        link.price === null
          ? null
          : Number(link.price),

      currency:
        link.currency,

      stock:
        link.stock === null
          ? null
          : Number(link.stock),

      metadata:
        link.metadata ?? {},

      publishedAt:
        link.publishedAt
          ?.toISOString() ??
        null,

      store:
        link.store
    })),

  createdAt:
    product.createdAt
      .toISOString(),

  updatedAt:
    product.updatedAt
      .toISOString()
});

const handleError = (
  error: unknown,
  res: Response,
  fallbackCode: string,
  fallbackMessage: string
) => {
  if (
    error instanceof
    ProductApiError
  ) {
    return res
      .status(error.statusCode)
      .json({
        success: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
  }

  console.error(
    `[${fallbackCode}]`,
    error
  );

  return res.status(500).json({
    success: false,
    error: {
      code: fallbackCode,
      message: fallbackMessage
    }
  });
};

export const getProducts =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

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

      const requestedStatus =
        String(
          req.query.status ?? ''
        )
          .trim()
          .toLowerCase();

      const requestedScope =
        String(
          req.query.scope ?? ''
        )
          .trim()
          .toLowerCase();

      const storeId =
        String(
          req.query.storeId ?? ''
        ).trim();

      const where: any = {
        merchantId
      };

      if (
        requestedStatus &&
        requestedStatus !== 'all'
      ) {
        where.publicationStatus =
          normalizeStatus(
            requestedStatus
          );
      } else if (
        requestedStatus !== 'all'
      ) {
        where.publicationStatus = {
          not: 'archived'
        };
      }

      if (requestedScope) {
        where.catalogScope =
          normalizeScope(
            requestedScope
          );
      }

      if (search) {
        where.OR = [
          {
            name: {
              contains: search,
              mode: 'insensitive'
            }
          },
          {
            sku: {
              contains: search,
              mode: 'insensitive'
            }
          },
          {
            description: {
              contains: search,
              mode: 'insensitive'
            }
          }
        ];
      }

      if (storeId) {
        where.AND = [
          {
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
                  'global'
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
          include:
            productInclude,
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

        data:
          products.map(
            serializeProduct
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
      return handleError(
        error,
        res,
        'PRODUCTS_ERROR',
        'Erro ao carregar produtos.'
      );
    }
  };

export const getProduct =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

      const id =
        readParam(req.params.id);

      const product =
        await prisma.product
          .findFirst({
            where: {
              id,
              merchantId
            },
            include:
              productInclude
          });

      if (!product) {
        throw new ProductApiError(
          404,
          'PRODUCT_NOT_FOUND',
          'Produto não encontrado.'
        );
      }

      return res.status(200).json({
        success: true,
        data:
          serializeProduct(
            product
          )
      });
    } catch (error) {
      return handleError(
        error,
        res,
        'PRODUCT_ERROR',
        'Erro ao carregar produto.'
      );
    }
  };

export const createProduct =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

      const body =
        req.body ?? {};

      const name =
        String(
          body.name ?? ''
        ).trim();

      if (!name) {
        throw new ProductApiError(
          400,
          'NAME_REQUIRED',
          'Nome do produto é obrigatório.'
        );
      }

      const price =
        normalizePrice(
          body.price
        ) as number;

      const currency =
        normalizeCurrency(
          body.currency
        );

      const catalogScope =
        normalizeScope(
          body.catalogScope ??
          body.catalog_scope
        );

      const publicationStatus =
        normalizeStatus(
          body.publicationStatus ??
          body.publication_status ??
          body.status ??
          (
            body.active === false
              ? 'archived'
              : 'active'
          )
        );

      const links =
        parseStoreLinks(
          body.stores
        );

      await assertStoresBelongToMerchant(
        merchantId,
        links
      );

      if (
        catalogScope ===
          'selected' &&
        publicationStatus ===
          'active' &&
        !links.some(
          link => link.enabled
        )
      ) {
        throw new ProductApiError(
          400,
          'SELECTED_STORE_REQUIRED',
          'Um produto selected e ativo deve estar publicado em pelo menos uma Store.'
        );
      }

      const sku =
        body.sku
          ? String(
              body.sku
            ).trim()
          : null;

      const product =
        await prisma
          .$transaction(
            async tx => {
              const created =
                await tx.product
                  .create({
                    data: {
                      merchantId,
                      sku:
                        sku || null,
                      name,

                      description:
                        body.description
                          ? String(
                              body.description
                            ).trim()
                          : null,

                      price,
                      currency,

                      stock:
                        normalizeStock(
                          body.stock
                        ),

                      active:
                        publicationStatus !==
                          'archived',

                      catalogScope,

                      publicationStatus,

                      metadata:
                        normalizeMetadata(
                          body.metadata
                        )
                    }
                  });

              if (
                links.length > 0
              ) {
                await tx.productStore
                  .createMany({
                    data:
                      links.map(
                        link => ({
                          merchantId,
                          productId:
                            created.id,
                          storeId:
                            link.storeId,
                          enabled:
                            link.enabled,
                          price:
                            link.price,
                          currency:
                            link.currency,
                          stock:
                            link.stock,
                          metadata:
                            link.metadata,
                          publishedAt:
                            link.enabled
                              ? new Date()
                              : null
                        })
                      )
                  });
              }

              return tx.product
                .findUniqueOrThrow({
                  where: {
                    id: created.id
                  },
                  include:
                    productInclude
                });
            }
          );

      return res.status(201).json({
        success: true,
        data:
          serializeProduct(
            product
          )
      });
    } catch (error: any) {
      if (
        error?.code === 'P2002'
      ) {
        return res.status(409).json({
          success: false,
          error: {
            code:
              'SKU_ALREADY_EXISTS',
            message:
              'Já existe um produto com este SKU.'
          }
        });
      }

      return handleError(
        error,
        res,
        'PRODUCT_CREATE_ERROR',
        'Erro ao criar produto.'
      );
    }
  };

export const updateProduct =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

      const id =
        readParam(req.params.id);

      const existing =
        await prisma.product
          .findFirst({
            where: {
              id,
              merchantId
            },
            include: {
              storeLinks: true
            }
          });

      if (!existing) {
        throw new ProductApiError(
          404,
          'PRODUCT_NOT_FOUND',
          'Produto não encontrado.'
        );
      }

      const body =
        req.body ?? {};

      const catalogScope =
        body.catalogScope !==
          undefined ||
        body.catalog_scope !==
          undefined
          ? normalizeScope(
              body.catalogScope ??
              body.catalog_scope
            )
          : existing.catalogScope;

      const publicationStatus =
        body.publicationStatus !==
          undefined ||
        body.publication_status !==
          undefined ||
        body.status !== undefined
          ? normalizeStatus(
              body.publicationStatus ??
              body.publication_status ??
              body.status
            )
          : existing
              .publicationStatus;

      const replacingStores =
        body.stores !==
        undefined;

      const links =
        replacingStores
          ? parseStoreLinks(
              body.stores
            )
          : [];

      if (replacingStores) {
        await assertStoresBelongToMerchant(
          merchantId,
          links
        );
      }

      const enabledStoreCount =
        replacingStores
          ? links.filter(
              link =>
                link.enabled
            ).length
          : existing.storeLinks
              .filter(
                link =>
                  link.enabled
              ).length;

      if (
        catalogScope ===
          'selected' &&
        publicationStatus ===
          'active' &&
        enabledStoreCount === 0
      ) {
        throw new ProductApiError(
          400,
          'SELECTED_STORE_REQUIRED',
          'Um produto selected e ativo deve estar publicado em pelo menos uma Store.'
        );
      }

      const product =
        await prisma
          .$transaction(
            async tx => {
              await tx.product
                .update({
                  where: {
                    id: existing.id
                  },

                  data: {
                    ...(body.sku !==
                    undefined
                      ? {
                          sku:
                            body.sku
                              ? String(
                                  body.sku
                                ).trim()
                              : null
                        }
                      : {}),

                    ...(body.name !==
                    undefined
                      ? {
                          name:
                            String(
                              body.name
                            ).trim()
                        }
                      : {}),

                    ...(body.description !==
                    undefined
                      ? {
                          description:
                            body.description
                              ? String(
                                  body.description
                                ).trim()
                              : null
                        }
                      : {}),

                    ...(body.price !==
                    undefined
                      ? {
                          price:
                            normalizePrice(
                              body.price
                            ) as number
                        }
                      : {}),

                    ...(body.currency !==
                    undefined
                      ? {
                          currency:
                            normalizeCurrency(
                              body.currency
                            )
                        }
                      : {}),

                    ...(body.stock !==
                    undefined
                      ? {
                          stock:
                            normalizeStock(
                              body.stock
                            )
                        }
                      : {}),

                    ...(body.metadata !==
                    undefined
                      ? {
                          metadata:
                            normalizeMetadata(
                              body.metadata
                            )
                        }
                      : {}),

                    catalogScope,
                    publicationStatus,

                    active:
                      publicationStatus !==
                        'archived'
                  }
                });

              if (replacingStores) {
                await tx.productStore
                  .deleteMany({
                    where: {
                      productId:
                        existing.id
                    }
                  });

                if (
                  links.length > 0
                ) {
                  await tx.productStore
                    .createMany({
                      data:
                        links.map(
                          link => ({
                            merchantId,
                            productId:
                              existing.id,
                            storeId:
                              link.storeId,
                            enabled:
                              link.enabled,
                            price:
                              link.price,
                            currency:
                              link.currency,
                            stock:
                              link.stock,
                            metadata:
                              link.metadata,
                            publishedAt:
                              link.enabled
                                ? new Date()
                                : null
                          })
                        )
                    });
                }
              }

              return tx.product
                .findUniqueOrThrow({
                  where: {
                    id:
                      existing.id
                  },
                  include:
                    productInclude
                });
            }
          );

      return res.status(200).json({
        success: true,
        data:
          serializeProduct(
            product
          )
      });
    } catch (error: any) {
      if (
        error?.code === 'P2002'
      ) {
        return res.status(409).json({
          success: false,
          error: {
            code:
              'SKU_ALREADY_EXISTS',
            message:
              'Já existe um produto com este SKU.'
          }
        });
      }

      return handleError(
        error,
        res,
        'PRODUCT_UPDATE_ERROR',
        'Erro ao atualizar produto.'
      );
    }
  };

export const archiveProduct =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

      const id =
        readParam(req.params.id);

      const result =
        await prisma.product
          .updateMany({
            where: {
              id,
              merchantId
            },

            data: {
              active: false,

              publicationStatus:
                'archived'
            }
          });

      if (
        result.count === 0
      ) {
        throw new ProductApiError(
          404,
          'PRODUCT_NOT_FOUND',
          'Produto não encontrado.'
        );
      }

      return res.status(200).json({
        success: true,
        data: {
          id,
          archived: true,
          deleted: true
        },
        message:
          'Produto arquivado com sucesso.'
      });
    } catch (error) {
      return handleError(
        error,
        res,
        'PRODUCT_ARCHIVE_ERROR',
        'Erro ao arquivar produto.'
      );
    }
  };

export const getProductStores =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        getMerchantId(req);

      if (!merchantId) {
        throw new ProductApiError(
          401,
          'UNAUTHORIZED',
          'Merchant não autenticado.'
        );
      }

      const id =
        readParam(req.params.id);

      const product =
        await prisma.product
          .findFirst({
            where: {
              id,
              merchantId
            },
            include:
              productInclude
          });

      if (!product) {
        throw new ProductApiError(
          404,
          'PRODUCT_NOT_FOUND',
          'Produto não encontrado.'
        );
      }

      return res.status(200).json({
        success: true,
        data:
          serializeProduct(
            product
          ).stores
      });
    } catch (error) {
      return handleError(
        error,
        res,
        'PRODUCT_STORES_ERROR',
        'Erro ao carregar Stores do produto.'
      );
    }
  };

export const replaceProductStores =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    req.body = {
      stores:
        req.body?.stores ?? []
    };

    return updateProduct(
      req,
      res
    );
  };
