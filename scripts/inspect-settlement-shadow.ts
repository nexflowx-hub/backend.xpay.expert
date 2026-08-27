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
      Array<{
        reference: string;
        transaction_status: string;
        transaction_gross: number;
        provider_charge_id: string | null;
        provider_balance_transaction_id: string | null;
        gross_amount: number;
        provider_fee: number;
        platform_fee: number;
        merchant_net: number;
        currency: string;
        release_status: string;
        provider_available_at: Date | null;
        batch_id: string;
        batch_status: string;
        transaction_count: number;
        batch_gross: number;
        batch_provider_fee: number;
        batch_platform_fee: number;
        batch_merchant_net: number;
      }>
    >(Prisma.sql`
      SELECT
        transaction.reference,

        transaction.status
          AS transaction_status,

        transaction.amount::double precision
          AS transaction_gross,

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

        batch.id
          AS batch_id,

        batch.status
          AS batch_status,

        batch.transaction_count,

        batch.gross_amount::double precision
          AS batch_gross,

        batch.provider_fee::double precision
          AS batch_provider_fee,

        batch.platform_fee::double precision
          AS batch_platform_fee,

        batch.merchant_net::double precision
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

  console.log(
    JSON.stringify(
      rows[0] ?? null,
      null,
      2
    )
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
