import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const reference =
    String(process.argv[2] ?? '').trim();

  if (!reference) {
    throw new Error('Referência obrigatória.');
  }

  const transaction =
    await prisma.transaction.findUnique({
      where: {
        reference
      },
      include: {
        store: true,
        gatewayVault: true
      }
    });

  if (!transaction) {
    throw new Error('Transaction não encontrada.');
  }

  console.log({
    id: transaction.id,
    reference: transaction.reference,
    merchantId: transaction.merchantId,
    store: transaction.store?.name,
    storeId: transaction.storeId,
    gatewayVaultId: transaction.gatewayVaultId,
    provider: transaction.gatewayVault?.provider,
    providerId: transaction.providerId,
    status: transaction.status,
    amount: Number(transaction.amount),
    currency: transaction.currency,
    platformFee: Number(transaction.fee ?? 0)
  });
}

main()
  .catch(error => {
    console.error({
      success: false,
      message: error.message
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
