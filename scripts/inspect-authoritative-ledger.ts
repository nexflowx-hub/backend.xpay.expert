import {
  Prisma,
  PrismaClient
} from '@prisma/client';

const prisma =
  new PrismaClient();

const defaultMerchantId =
  'c8c0387b-ea92-4c31-a5bb-739e6d61d262';

async function main() {
  const merchantId =
    String(
      process.argv[2] ??
      defaultMerchantId
    ).trim();

  if (!merchantId) {
    throw new Error(
      'Merchant ID obrigatório.'
    );
  }

  const wallets =
    await prisma.$queryRaw<
      Array<{
        id: string;
        currency: string;
        balance: number;
        available: number;
        reserved: number;
        pending: number;
      }>
    >(Prisma.sql`
      SELECT
        id,
        currency,

        balance::double precision
          AS balance,

        available::double precision
          AS available,

        reserved::double precision
          AS reserved,

        (
          balance -
          available -
          reserved
        )::double precision
          AS pending

      FROM public.wallets

      WHERE merchant_id =
        ${merchantId}::uuid

      ORDER BY currency
    `);

  const batches =
    await prisma.$queryRaw<
      Array<{
        id: string;
        store_id: string;
        store_name: string;
        gateway_vault_id: string;
        provider: string;
        currency: string;
        business_date: Date;
        status: string;
        transaction_count: number;
        gross_amount: number;
        provider_fee: number;
        platform_fee: number;
        merchant_net: number;
        provider_available_at: Date | null;
        ready_at: Date | null;
        released_at: Date | null;
        released_by: string | null;
      }>
    >(Prisma.sql`
      SELECT
        batch.id,
        batch.store_id,

        store.name
          AS store_name,

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
        batch.released_by

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

      ORDER BY
        batch.business_date DESC,
        batch.created_at DESC
    `);

  const items =
    await prisma.$queryRaw<
      Array<{
        id: string;
        batch_id: string;
        transaction_id: string;
        reference: string;
        gross_amount: number;
        provider_fee: number;
        platform_fee: number;
        merchant_net: number;
        currency: string;
        release_status: string;
        provider_available_at: Date | null;
        released_at: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        item.id,
        item.batch_id,
        item.transaction_id,
        transaction.reference,

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
        item.released_at

      FROM public.settlement_items
        AS item

      INNER JOIN public.transactions
        AS transaction
        ON transaction.id =
          item.transaction_id

      WHERE item.merchant_id =
        ${merchantId}::uuid

      ORDER BY item.created_at ASC
    `);

  const movements =
    await prisma.$queryRaw<
      Array<{
        id: string;
        transaction_id: string | null;
        settlement_batch_id: string | null;
        type: string;
        direction: string;
        amount: number;
        currency: string;
        status: string;
        bucket: string | null;
        reference: string | null;
        idempotency_key: string | null;
        created_at: Date;
      }>
    >(Prisma.sql`
      SELECT
        id,
        transaction_id,
        settlement_batch_id,
        type,
        direction,

        amount::double precision
          AS amount,

        currency,
        status,
        bucket,
        reference,
        idempotency_key,
        created_at

      FROM public.wallet_movements

      WHERE merchant_id =
        ${merchantId}::uuid

      ORDER BY created_at ASC
    `);

  console.log(
    JSON.stringify(
      {
        merchantId,
        wallets,
        batches,
        items,
        movements
      },
      null,
      2
    )
  );
}

main()
  .catch(error => {
    console.error(
      '[INSPECT_AUTHORITATIVE_LEDGER_ERROR]',
      {
        message:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
