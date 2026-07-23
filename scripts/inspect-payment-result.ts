import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const reference =
    String(process.argv[2] ?? '').trim();

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

  const wallet =
    await prisma.wallet.findUnique({
      where: {
        merchantId_currency: {
          merchantId:
            transaction.merchantId,
          currency:
            transaction.currency.toUpperCase()
        }
      }
    });

  const movements =
    await prisma.walletMovement.findMany({
      where: {
        OR: [
          {
            reference:
              transaction.id
          },
          {
            reference:
              transaction.reference
          }
        ]
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

  const balance =
    Number(wallet?.balance ?? 0);

  const available =
    Number(wallet?.available ?? 0);

  const reserved =
    Number(wallet?.reserved ?? 0);

  console.log({
    transaction: {
      id: transaction.id,
      reference:
        transaction.reference,
      store:
        transaction.store?.name,
      gatewayVaultId:
        transaction.gatewayVaultId,
      provider:
        transaction.gatewayVault?.provider,
      providerId:
        transaction.providerId,
      status:
        transaction.status,
      grossAmount:
        Number(transaction.amount),
      platformFee:
        Number(transaction.fee ?? 0),
      currency:
        transaction.currency
    },

    wallet: wallet
      ? {
          id: wallet.id,
          balance,
          available,
          reserved,
          pending:
            Number(
              (
                balance -
                available -
                reserved
              ).toFixed(2)
            )
        }
      : null,

    movements:
      movements.map(
        movement => ({
          id: movement.id,
          type: movement.type,
          direction:
            movement.direction,
          amount:
            Number(movement.amount),
          status:
            movement.status,
          reference:
            movement.reference,
          createdAt:
            movement.createdAt
        })
      )
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
