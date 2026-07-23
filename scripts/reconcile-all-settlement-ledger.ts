import {
  Prisma,
  PrismaClient
} from '@prisma/client';

import {
  reconcileSettlementTransaction
} from '../src/modules/settlement/services/ledger-reconciliation.service';

const prisma =
  new PrismaClient();

async function main() {
  const rows =
    await prisma.$queryRaw<
      Array<{
        transaction_id: string;
      }>
    >(Prisma.sql`
      SELECT transaction_id

      FROM public.settlement_items

      WHERE release_status !=
        'released'

      ORDER BY created_at ASC
    `);

  console.log({
    candidates:
      rows.length
  });

  for (const row of rows) {
    const result =
      await reconcileSettlementTransaction(
        row.transaction_id
      );

    console.log(result);
  }
}

main()
  .catch(error => {
    console.error(
      '[LEDGER_RECONCILIATION_ERROR]',
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
