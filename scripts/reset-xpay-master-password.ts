import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const XPAY_MASTER_ID =
  'c8c0387b-ea92-4c31-a5bb-739e6d61d262';

const XPAY_MASTER_EMAIL =
  'contact@xpay.expert';

async function main() {
  const newPassword =
    String(
      process.env.XPAY_MASTER_NEW_PASSWORD ??
      ''
    );

  if (newPassword.length < 12) {
    throw new Error(
      'A nova password deve ter pelo menos 12 caracteres.'
    );
  }

  const merchant =
    await prisma.merchant.findFirst({
      where: {
        OR: [
          {
            id: XPAY_MASTER_ID
          },
          {
            email: XPAY_MASTER_EMAIL
          }
        ]
      }
    });

  if (!merchant) {
    throw new Error(
      'XPay-Master não encontrado.'
    );
  }

  if (
    merchant.id !== XPAY_MASTER_ID
  ) {
    throw new Error(
      'O email contact@xpay.expert pertence a um ID inesperado.'
    );
  }

  const passwordHash =
    await bcrypt.hash(
      newPassword,
      12
    );

  const passwordVerified =
    await bcrypt.compare(
      newPassword,
      passwordHash
    );

  if (!passwordVerified) {
    throw new Error(
      'Falha interna ao validar o novo hash.'
    );
  }

  const updated =
    await prisma.merchant.update({
      where: {
        id: XPAY_MASTER_ID
      },

      data: {
        passwordHash,
        status: 'active'
      },

      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        status: true,
        updatedAt: true
      }
    });

  console.log({
    success: true,
    merchant: updated,
    passwordHashUpdated: true
  });
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
