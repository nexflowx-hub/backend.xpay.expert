import {
  Prisma,
  PrismaClient
} from '@prisma/client';

import {
  recordStripeSettlementAndReconcile
} from '../src/modules/settlement/services/settlement-ledger.service';

const prisma =
  new PrismaClient();

async function main() {
  const transactions =
    await prisma.$queryRaw<
      Array<{
        id: string;
        provider_id: string;
        gateway_vault_id: string;
        credentials: unknown;
      }>
    >(Prisma.sql`
      SELECT
        transaction.id,
        transaction.provider_id,
        transaction.gateway_vault_id,
        vault.credentials

      FROM public.transactions
        AS transaction

      INNER JOIN public.gateway_vaults
        AS vault
        ON vault.id =
          transaction.gateway_vault_id

      LEFT JOIN public.settlement_items
        AS item
        ON item.transaction_id =
          transaction.id

      WHERE transaction.status =
          'succeeded'

        AND transaction.provider_id
          LIKE 'pi_%'

        AND transaction.gateway_vault_id
          IS NOT NULL

        AND item.id IS NULL

      ORDER BY transaction.created_at ASC
    `);

  console.log({
    candidates:
      transactions.length
  });

  for (
    const transaction of transactions
  ) {
    const credentials =
      transaction.credentials &&
      typeof transaction.credentials ===
        'object' &&
      !Array.isArray(
        transaction.credentials
      )
        ? transaction.credentials as
            Record<string, unknown>
        : {};

    const secretKey =
      String(
        credentials.secretKey ??
        ''
      );

    const result =
      await recordStripeSettlementAndReconcile({
        eventId:
          `backfill:${transaction.id}`,

        eventType:
          'payment_intent.succeeded',

        livemode:
          secretKey.startsWith(
            'sk_live_'
          ),

        transactionId:
          transaction.id,

        gatewayVaultId:
          transaction.gateway_vault_id,

        paymentIntentId:
          transaction.provider_id
      });

    console.log({
      transactionId:
        transaction.id,

      result
    });
  }
}

main()
  .catch(error => {
    console.error(
      '[SETTLEMENT_BACKFILL_ERROR]',
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
