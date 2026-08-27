import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables =
    await prisma.$queryRawUnsafe<
      Array<{
        table_name: string;
      }>
    >(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'payout_requests',
          'payout_events',
          'notification_deliveries'
        )
      ORDER BY table_name
    `);

  const payoutColumns =
    await prisma.$queryRawUnsafe<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>
    >(`
      SELECT
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payout_requests'
      ORDER BY ordinal_position
    `);

  const walletMovementColumns =
    await prisma.$queryRawUnsafe<
      Array<{
        column_name: string;
      }>
    >(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'wallet_movements'
        AND column_name = 'payout_request_id'
    `);

  console.log(
    JSON.stringify(
      {
        success: true,
        tables,
        payoutColumns,
        walletMovementTraceability:
          walletMovementColumns
      },
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
        error instanceof Error
          ? error.message
          : String(error)
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
