import {
  Request,
  Response
} from 'express';

import {
  Prisma,
  PrismaClient
} from '@prisma/client';

const prisma =
  new PrismaClient();

function resolveMerchantId(
  req: Request
): string {
  const request =
    req as Request & {
      merchantId?: string;

      user?: {
        id?: string;
        merchantId?: string;
      };
    };

  return String(
    request.merchantId ??
    request.user?.id ??
    request.user?.merchantId ??
    ''
  ).trim();
}

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed =
    Number.parseInt(
      String(value ?? ''),
      10
    );

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      parsed
    )
  );
}

export async function getSettlementOverview(
  req: Request,
  res: Response
) {
  try {
    const merchantId =
      resolveMerchantId(req);

    const rows =
      await prisma.$queryRaw<
        Array<{
          total_batches: number;
          pending_provider_batches: number;
          pending_review_batches: number;
          held_batches: number;
          released_batches: number;
          gross_amount: number;
          provider_fee: number;
          platform_fee: number;
          merchant_net: number;
        }>
      >(Prisma.sql`
        SELECT
          COUNT(*)::integer
            AS total_batches,

          COUNT(*) FILTER (
            WHERE status =
              'pending_provider'
          )::integer
            AS pending_provider_batches,

          COUNT(*) FILTER (
            WHERE status =
              'pending_review'
          )::integer
            AS pending_review_batches,

          COUNT(*) FILTER (
            WHERE status =
              'held'
          )::integer
            AS held_batches,

          COUNT(*) FILTER (
            WHERE status =
              'released'
          )::integer
            AS released_batches,

          COALESCE(
            SUM(gross_amount),
            0
          )::double precision
            AS gross_amount,

          COALESCE(
            SUM(provider_fee),
            0
          )::double precision
            AS provider_fee,

          COALESCE(
            SUM(platform_fee),
            0
          )::double precision
            AS platform_fee,

          COALESCE(
            SUM(merchant_net),
            0
          )::double precision
            AS merchant_net

        FROM public.settlement_batches

        WHERE merchant_id =
          ${merchantId}::uuid
      `);

    return res.json({
      success: true,
      data:
        rows[0] ?? null
    });
  } catch (error) {
    console.error(
      '[SETTLEMENT_OVERVIEW_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        code:
          'SETTLEMENT_OVERVIEW_FAILED',

        message:
          'Não foi possível carregar o resumo de liquidações.'
      }
    });
  }
}

export async function listMerchantSettlementBatches(
  req: Request,
  res: Response
) {
  try {
    const merchantId =
      resolveMerchantId(req);

    const page =
      clampInteger(
        req.query.page,
        1,
        1,
        100000
      );

    const limit =
      clampInteger(
        req.query.limit,
        25,
        1,
        100
      );

    const offset =
      (page - 1) *
      limit;

    const status =
      String(
        req.query.status ??
        ''
      ).trim();

    const storeId =
      String(
        req.query.storeId ??
        ''
      ).trim();

    const rows =
      await prisma.$queryRaw<
        Array<Record<string, unknown>>
      >(Prisma.sql`
        SELECT
          batch.id,

          batch.merchant_id,

          batch.store_id,

          store.name
            AS store_name,

          store.store_code,

          batch.gateway_vault_id,

          vault.provider,

          batch.currency,

          batch.business_date,

          batch.status,

          batch.transaction_count,

          batch.gross_amount::double precision
            AS gross_amount,

          batch.provider_fee::double precision
            AS provider_fee,

          batch.platform_fee::double precision
            AS platform_fee,

          batch.merchant_net::double precision
            AS merchant_net,

          batch.provider_available_at,

          batch.ready_at,

          batch.released_at,

          batch.created_at,

          COUNT(*) OVER()::integer
            AS total_count

        FROM public.settlement_batches
          AS batch

        INNER JOIN public.stores
          AS store
          ON store.id =
            batch.store_id

        INNER JOIN public.gateway_vaults
          AS vault
          ON vault.id =
            batch.gateway_vault_id

        WHERE batch.merchant_id =
          ${merchantId}::uuid

          AND (
            ${status} = ''
            OR batch.status =
              ${status}
          )

          AND (
            ${storeId} = ''
            OR batch.store_id =
              NULLIF(
                ${storeId},
                ''
              )::uuid
          )

        ORDER BY
          batch.business_date DESC,
          batch.created_at DESC

        LIMIT ${limit}
        OFFSET ${offset}
      `);

    const total =
      Number(
        rows[0]?.total_count ??
        0
      );

    return res.json({
      success: true,

      data: {
        items:
          rows.map(row => {
            const {
              total_count: _total,
              ...item
            } = row;

            return item;
          }),

        pagination: {
          page,
          limit,
          total,

          pages:
            Math.ceil(
              total /
              limit
            )
        }
      }
    });
  } catch (error) {
    console.error(
      '[SETTLEMENT_LIST_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        code:
          'SETTLEMENT_LIST_FAILED',

        message:
          'Não foi possível carregar as liquidações.'
      }
    });
  }
}

export async function getMerchantSettlementBatch(
  req: Request,
  res: Response
) {
  try {
    const merchantId =
      resolveMerchantId(req);

    const batchId =
      String(
        req.params.id ??
        ''
      ).trim();

    const batches =
      await prisma.$queryRaw<
        Array<Record<string, unknown>>
      >(Prisma.sql`
        SELECT
          batch.id,

          batch.merchant_id,

          batch.store_id,

          store.name
            AS store_name,

          store.store_code,

          batch.gateway_vault_id,

          vault.provider,

          batch.currency,

          batch.business_date,

          batch.status,

          batch.transaction_count,

          batch.gross_amount::double precision
            AS gross_amount,

          batch.provider_fee::double precision
            AS provider_fee,

          batch.platform_fee::double precision
            AS platform_fee,

          batch.merchant_net::double precision
            AS merchant_net,

          batch.provider_available_at,

          batch.ready_at,

          batch.released_at,

          batch.hold_reason,

          batch.metadata,

          batch.created_at,

          batch.updated_at

        FROM public.settlement_batches
          AS batch

        INNER JOIN public.stores
          AS store
          ON store.id =
            batch.store_id

        INNER JOIN public.gateway_vaults
          AS vault
          ON vault.id =
            batch.gateway_vault_id

        WHERE batch.id =
          ${batchId}::uuid

          AND batch.merchant_id =
            ${merchantId}::uuid

        LIMIT 1
      `);

    const batch =
      batches[0];

    if (!batch) {
      return res.status(404).json({
        success: false,

        error: {
          code:
            'SETTLEMENT_BATCH_NOT_FOUND',

          message:
            'Settlement Batch não encontrado.'
        }
      });
    }

    const items =
      await prisma.$queryRaw<
        Array<Record<string, unknown>>
      >(Prisma.sql`
        SELECT
          item.id,

          item.transaction_id,

          transaction.reference,

          transaction.provider_id,

          item.provider_charge_id,

          item.provider_balance_transaction_id,

          item.gross_amount::double precision
            AS gross_amount,

          item.provider_fee::double precision
            AS provider_fee,

          item.platform_fee::double precision
            AS platform_fee,

          item.merchant_net::double precision
            AS merchant_net,

          item.currency,

          item.release_status,

          item.provider_available_at,

          item.ready_at,

          item.released_at,

          item.metadata,

          item.created_at

        FROM public.settlement_items
          AS item

        INNER JOIN public.transactions
          AS transaction
          ON transaction.id =
            item.transaction_id

        WHERE item.batch_id =
          ${batchId}::uuid

        ORDER BY item.created_at ASC
      `);

    return res.json({
      success: true,

      data: {
        batch,
        items
      }
    });
  } catch (error) {
    console.error(
      '[SETTLEMENT_DETAIL_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        code:
          'SETTLEMENT_DETAIL_FAILED',

        message:
          'Não foi possível carregar o detalhe da liquidação.'
      }
    });
  }
}

export async function listAdminSettlementBatches(
  req: Request,
  res: Response
) {
  try {
    const page =
      clampInteger(
        req.query.page,
        1,
        1,
        100000
      );

    const limit =
      clampInteger(
        req.query.limit,
        50,
        1,
        100
      );

    const offset =
      (page - 1) *
      limit;

    const status =
      String(
        req.query.status ??
        ''
      ).trim();

    const rows =
      await prisma.$queryRaw<
        Array<Record<string, unknown>>
      >(Prisma.sql`
        SELECT
          batch.id,

          batch.merchant_id,

          merchant.name
            AS merchant_name,

          merchant.company
            AS merchant_company,

          batch.store_id,

          store.name
            AS store_name,

          store.store_code,

          batch.gateway_vault_id,

          vault.provider,

          batch.currency,

          batch.business_date,

          batch.status,

          batch.transaction_count,

          batch.gross_amount::double precision
            AS gross_amount,

          batch.provider_fee::double precision
            AS provider_fee,

          batch.platform_fee::double precision
            AS platform_fee,

          batch.merchant_net::double precision
            AS merchant_net,

          batch.provider_available_at,

          batch.ready_at,

          batch.released_at,

          batch.created_at,

          COUNT(*) OVER()::integer
            AS total_count

        FROM public.settlement_batches
          AS batch

        INNER JOIN public.merchants
          AS merchant
          ON merchant.id =
            batch.merchant_id

        INNER JOIN public.stores
          AS store
          ON store.id =
            batch.store_id

        INNER JOIN public.gateway_vaults
          AS vault
          ON vault.id =
            batch.gateway_vault_id

        WHERE (
          ${status} = ''
          OR batch.status =
            ${status}
        )

        ORDER BY
          batch.business_date DESC,
          batch.created_at DESC

        LIMIT ${limit}
        OFFSET ${offset}
      `);

    const total =
      Number(
        rows[0]?.total_count ??
        0
      );

    return res.json({
      success: true,

      data: {
        items:
          rows.map(row => {
            const {
              total_count: _total,
              ...item
            } = row;

            return item;
          }),

        pagination: {
          page,
          limit,
          total,

          pages:
            Math.ceil(
              total /
              limit
            )
        }
      }
    });
  } catch (error) {
    console.error(
      '[ADMIN_SETTLEMENT_LIST_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        code:
          'ADMIN_SETTLEMENT_LIST_FAILED',

        message:
          'Não foi possível carregar as liquidações da plataforma.'
      }
    });
  }
}

export async function refreshSettlementAvailability(
  _req: Request,
  res: Response
) {
  try {
    const result =
      await prisma.$transaction(
        async tx => {
          const itemsUpdated =
            await tx.$executeRaw(
              Prisma.sql`
                UPDATE public.settlement_items

                SET
                  release_status =
                    'pending_review',

                  ready_at =
                    COALESCE(
                      ready_at,
                      CURRENT_TIMESTAMP
                    ),

                  updated_at =
                    CURRENT_TIMESTAMP

                WHERE release_status =
                  'pending_provider'

                  AND provider_available_at
                    IS NOT NULL

                  AND provider_available_at <=
                    CURRENT_TIMESTAMP
              `
            );

          const batchesUpdated =
            await tx.$executeRaw(
              Prisma.sql`
                UPDATE public.settlement_batches
                  AS batch

                SET
                  status =
                    'pending_review',

                  ready_at =
                    COALESCE(
                      batch.ready_at,
                      CURRENT_TIMESTAMP
                    ),

                  updated_at =
                    CURRENT_TIMESTAMP

                WHERE batch.status =
                  'pending_provider'

                  AND NOT EXISTS (
                    SELECT 1

                    FROM public.settlement_items
                      AS item

                    WHERE item.batch_id =
                      batch.id

                      AND item.release_status =
                        'pending_provider'
                  )

                  AND EXISTS (
                    SELECT 1

                    FROM public.settlement_items
                      AS item

                    WHERE item.batch_id =
                      batch.id
                  )
              `
            );

          return {
            itemsUpdated,
            batchesUpdated
          };
        }
      );

    console.log(
      '[SETTLEMENT_AVAILABILITY_REFRESHED]',
      result
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error(
      '[SETTLEMENT_REFRESH_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        code:
          'SETTLEMENT_REFRESH_FAILED',

        message:
          'Não foi possível atualizar a disponibilidade das liquidações.'
      }
    });
  }
}
