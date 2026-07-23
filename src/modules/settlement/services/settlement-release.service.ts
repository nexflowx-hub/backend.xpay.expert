import {
  Prisma
} from '@prisma/client';

import prisma from '../../../core/prisma';

type BatchRow = {
  id: string;
  merchant_id: string;
  store_id: string;
  wallet_id: string | null;
  currency: string;
  status: string;
  merchant_net: number;
};

export async function markBatchReadyForPilot(
  batchId: string
) {
  return prisma.$transaction(
    async tx => {
      const batches =
        await tx.$queryRaw<
          BatchRow[]
        >(Prisma.sql`
          SELECT
            batch.id,
            batch.merchant_id,
            batch.store_id,
            batch.wallet_id,
            batch.currency,
            batch.status,

            batch.merchant_net::double precision
              AS merchant_net

          FROM public.settlement_batches
            AS batch

          WHERE batch.id =
            ${batchId}::uuid

          FOR UPDATE
        `);

      const batch =
        batches[0];

      if (!batch) {
        throw new Error(
          'SETTLEMENT_BATCH_NOT_FOUND'
        );
      }

      if (
        batch.status ===
        'released'
      ) {
        throw new Error(
          'SETTLEMENT_BATCH_ALREADY_RELEASED'
        );
      }

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

          WHERE batch_id =
            ${batchId}::uuid

            AND release_status =
              'pending_provider'
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.settlement_batches

          SET
            status =
              'pending_review',

            ready_at =
              COALESCE(
                ready_at,
                CURRENT_TIMESTAMP
              ),

            updated_at =
              CURRENT_TIMESTAMP,

            metadata =
              COALESCE(
                metadata,
                '{}'::jsonb
              ) ||
              ${JSON.stringify({
                pilotOverride:
                  true
              })}::jsonb

          WHERE id =
            ${batchId}::uuid
        `
      );

      return {
        batchId,
        status:
          'pending_review',
        pilotOverride:
          true
      };
    }
  );
}

export async function releaseSettlementBatch(
  batchId: string,
  releasedBy: string
) {
  return prisma.$transaction(
    async tx => {
      const batches =
        await tx.$queryRaw<
          BatchRow[]
        >(Prisma.sql`
          SELECT
            batch.id,
            batch.merchant_id,
            batch.store_id,

            COALESCE(
              batch.wallet_id,
              wallet.id
            )
              AS wallet_id,

            batch.currency,
            batch.status,

            batch.merchant_net::double precision
              AS merchant_net

          FROM public.settlement_batches
            AS batch

          LEFT JOIN public.wallets
            AS wallet
            ON wallet.merchant_id =
              batch.merchant_id

            AND UPPER(wallet.currency) =
              UPPER(batch.currency)

          WHERE batch.id =
            ${batchId}::uuid

          FOR UPDATE OF batch
        `);

      const batch =
        batches[0];

      if (!batch) {
        throw new Error(
          'SETTLEMENT_BATCH_NOT_FOUND'
        );
      }

      if (!batch.wallet_id) {
        throw new Error(
          'SETTLEMENT_WALLET_NOT_FOUND'
        );
      }

      if (
        batch.status ===
        'released'
      ) {
        return {
          batchId,
          status:
            'released',
          alreadyReleased:
            true
        };
      }

      if (
        batch.status !==
        'pending_review'
      ) {
        throw new Error(
          `SETTLEMENT_BATCH_NOT_READY:${batch.status}`
        );
      }

      const pendingRows =
        await tx.$queryRaw<
          Array<{
            pending_count: number;
          }>
        >(Prisma.sql`
          SELECT
            COUNT(*) FILTER (
              WHERE release_status !=
                'pending_review'
            )::integer
              AS pending_count

          FROM public.settlement_items

          WHERE batch_id =
            ${batchId}::uuid
        `);

      if (
        Number(
          pendingRows[0]
            ?.pending_count ??
          0
        ) > 0
      ) {
        throw new Error(
          'SETTLEMENT_ITEMS_NOT_READY'
        );
      }

      const idempotencyKey =
        `settlement-release:${batchId}`;

      const movementInserted =
        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO
              public.wallet_movements (
                wallet_id,
                merchant_id,
                currency,
                type,
                direction,
                amount,
                status,
                reference,
                metadata,
                store_id,
                settlement_batch_id,
                bucket,
                idempotency_key
              )

            VALUES (
              ${batch.wallet_id}::uuid,
              ${batch.merchant_id}::uuid,
              ${batch.currency},
              'settlement_release',
              'internal',
              ${batch.merchant_net},
              'applied',
              ${batchId},
              ${JSON.stringify({
                fromBucket:
                  'pending',

                toBucket:
                  'available',

                releasedBy
              })}::jsonb,
              ${batch.store_id}::uuid,
              ${batchId}::uuid,
              'available',
              ${idempotencyKey}
            )

            ON CONFLICT (
              idempotency_key
            )
            WHERE idempotency_key
              IS NOT NULL

            DO NOTHING
          `
        );

      if (movementInserted === 0) {
        return {
          batchId,
          status:
            'released',
          alreadyReleased:
            true
        };
      }

      /*
       * Release muda apenas o bucket:
       * balance mantém-se;
       * available aumenta.
       */
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.wallets

          SET available =
            available +
            ${batch.merchant_net}

          WHERE id =
            ${batch.wallet_id}::uuid
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.settlement_items

          SET
            release_status =
              'released',

            released_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE batch_id =
            ${batchId}::uuid
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.settlement_batches

          SET
            status =
              'released',

            released_at =
              CURRENT_TIMESTAMP,

            released_by =
              ${releasedBy},

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id =
            ${batchId}::uuid
        `
      );

      return {
        batchId,
        walletId:
          batch.wallet_id,
        releasedAmount:
          batch.merchant_net,
        currency:
          batch.currency,
        status:
          'released',
        alreadyReleased:
          false
      };
    }
  );
}
