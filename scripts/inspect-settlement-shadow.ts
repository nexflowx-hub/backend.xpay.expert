import {
  Prisma,
  PrismaClient
} from '@prisma/client';

const prisma =
  new PrismaClient();

async function main() {
  const reference =
    String(
      process.argv[2] ?? ''
    ).trim();

  if (!reference) {
    throw new Error(
      'Referência obrigatória.'
    );
  }

  const rows =
    await prisma.$queryRaw<
      Array<Record<string, unknown>>
    >(Prisma.sql`
      SELECT
        transaction.reference,
        transaction.status
          AS transaction_status,

        transaction.amount
          AS transaction_gross,

        item.provider_charge_id,
        item.provider_balance_transaction_id,
        item.gross_amount,
        item.provider_fee,
        item.platform_fee,
        item.merchant_net,
        item.currency,
        item.release_status,
        item.provider_available_at,

        batch.id
          AS batch_id,

        batch.status
          AS batch_status,

        batch.transaction_count,
        batch.gross_amount
          AS batch_gross,

        batch.provider_fee
          AS batch_provider_fee,

        batch.platform_fee
          AS batch_platform_fee,

        batch.merchant_net
          AS batch_merchant_net

      FROM public.transactions
        AS transaction

      INNER JOIN
        public.settlement_items
        AS item
        ON item.transaction_id =
          transaction.id

      INNER JOIN
        public.settlement_batches
        AS batch
        ON batch.id =
          item.batch_id

      WHERE transaction.reference =
        ${reference}

      LIMIT 1
    `);

  console.dir(
    rows[0] ?? null,
    {
      depth: null
    }
  );
}

main()
  .catch(error => {
    console.error({
      success: false,
      message:
        error.message
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
