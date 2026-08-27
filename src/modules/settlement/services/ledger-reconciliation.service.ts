import {
  Prisma
} from '@prisma/client';

import prisma from '../../../core/prisma';

function money(
  value: number
): number {
  return Number(
    value.toFixed(2)
  );
}

type ReconciliationRow = {
  settlement_item_id: string;
  transaction_id: string;
  merchant_id: string;
  store_id: string;
  wallet_id: string;
  currency: string;
  merchant_net: number;
  release_status: string;
};

export async function reconcileSettlementTransaction(
  transactionId: string
) {
  return prisma.$transaction(
    async tx => {
      const rows =
        await tx.$queryRaw<
          ReconciliationRow[]
        >(Prisma.sql`
          SELECT
            item.id
              AS settlement_item_id,

            item.transaction_id,

            item.merchant_id,

            item.store_id,

            COALESCE(
              item.wallet_id,
              wallet.id
            )
              AS wallet_id,

            item.currency,

            item.merchant_net::double precision
              AS merchant_net,

            item.release_status

          FROM public.settlement_items
            AS item

          LEFT JOIN public.wallets
            AS wallet
            ON wallet.merchant_id =
              item.merchant_id

            AND UPPER(wallet.currency) =
              UPPER(item.currency)

          WHERE item.transaction_id =
            ${transactionId}::uuid

          LIMIT 1
        `);

      const settlement =
        rows[0];

      if (!settlement) {
        throw new Error(
          'SETTLEMENT_ITEM_NOT_FOUND'
        );
      }

      if (!settlement.wallet_id) {
        throw new Error(
          'SETTLEMENT_WALLET_NOT_FOUND'
        );
      }

      if (
        settlement.release_status ===
          'released'
      ) {
        return {
          transactionId,
          reconciled: false,
          reason:
            'settlement_already_released'
        };
      }

      /*
       * Associar movimentos legacy à Transaction.
       */
      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.wallet_movements
            AS movement

          SET
            transaction_id =
              ${transactionId}::uuid,

            store_id =
              ${settlement.store_id}::uuid

          WHERE movement.wallet_id =
              ${settlement.wallet_id}::uuid

            AND movement.transaction_id
              IS NULL

            AND movement.reference =
              ${transactionId}
        `
      );

      /*
       * Somar o efeito financeiro já aplicado
       * à Wallet para esta Transaction.
       */
      const currentRows =
        await tx.$queryRaw<
          Array<{
            current_amount: number;
          }>
        >(Prisma.sql`
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN direction = 'in'
                    THEN amount

                  WHEN direction = 'out'
                    THEN -amount

                  ELSE 0
                END
              ),
              0
            )::double precision
              AS current_amount

          FROM public.wallet_movements

          WHERE wallet_id =
            ${settlement.wallet_id}::uuid

            AND transaction_id =
              ${transactionId}::uuid

            AND type IN (
              'payment',
              'settlement_credit',
              'settlement_reconciliation'
            )
        `);

      const currentAmount =
        money(
          Number(
            currentRows[0]
              ?.current_amount ??
            0
          )
        );

      const targetAmount =
        money(
          Number(
            settlement.merchant_net
          )
        );

      const delta =
        money(
          targetAmount -
          currentAmount
        );

      if (
        Math.abs(delta) <
        0.005
      ) {
        return {
          transactionId,
          reconciled: false,
          currentAmount,
          targetAmount,
          delta: 0,
          reason:
            'ledger_already_reconciled'
        };
      }

      const walletRows =
        await tx.$queryRaw<
          Array<{
            balance: number;
          }>
        >(Prisma.sql`
          SELECT
            balance::double precision
              AS balance

          FROM public.wallets

          WHERE id =
            ${settlement.wallet_id}::uuid

          FOR UPDATE
        `);

      const currentBalance =
        money(
          Number(
            walletRows[0]?.balance ??
            0
          )
        );

      const newBalance =
        money(
          currentBalance +
          delta
        );

      if (newBalance < 0) {
        throw new Error(
          'WALLET_BALANCE_WOULD_BECOME_NEGATIVE'
        );
      }

      const direction =
        delta >= 0
          ? 'in'
          : 'out';

      const movementAmount =
        money(
          Math.abs(delta)
        );

      const idempotencyKey =
        [
          'settlement-reconcile',
          transactionId,
          currentAmount.toFixed(2),
          targetAmount.toFixed(2)
        ].join(':');

      const inserted =
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
                transaction_id,
                store_id,
                settlement_item_id,
                bucket,
                idempotency_key
              )

            VALUES (
              ${settlement.wallet_id}::uuid,
              ${settlement.merchant_id}::uuid,
              ${settlement.currency},
              'settlement_reconciliation',
              ${direction},
              ${movementAmount},
              'applied',
              ${transactionId},
              ${JSON.stringify({
                currentAmount,
                targetAmount,
                delta,
                reason:
                  'provider_fee_reconciliation'
              })}::jsonb,
              ${transactionId}::uuid,
              ${settlement.store_id}::uuid,
              ${settlement.settlement_item_id}::uuid,
              'pending',
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

      if (inserted === 0) {
        return {
          transactionId,
          reconciled: false,
          currentAmount,
          targetAmount,
          delta,
          reason:
            'idempotency_key_already_exists'
        };
      }

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE public.wallets

          SET balance =
            balance + ${delta}

          WHERE id =
            ${settlement.wallet_id}::uuid
        `
      );

      return {
        transactionId,
        reconciled: true,
        currentAmount,
        targetAmount,
        delta,
        direction,
        movementAmount,
        previousBalance:
          currentBalance,
        newBalance
      };
    }
  );
}
