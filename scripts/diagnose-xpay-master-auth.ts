import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const password =
    String(
      process.env.XPAY_TEST_PASSWORD ??
      ''
    );

  if (!password) {
    throw new Error(
      'XPAY_TEST_PASSWORD ausente.'
    );
  }

  const merchant =
    await prisma.merchant.findFirst({
      where: {
        email: {
          equals: 'contact@xpay.expert',
          mode: 'insensitive'
        }
      },

      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        status: true,
        passwordHash: true,
        updatedAt: true
      }
    });

  const databaseFingerprint =
    crypto
      .createHash('sha256')
      .update(
        process.env.DATABASE_URL ?? ''
      )
      .digest('hex')
      .slice(0, 16);

  if (!merchant) {
    console.log({
      databaseFingerprint,
      merchantFound: false
    });

    return;
  }

  const passwordMatch =
    merchant.passwordHash
      ? await bcrypt.compare(
          password,
          merchant.passwordHash
        )
      : false;

  console.log({
    databaseFingerprint,
    merchantFound: true,
    merchant: {
      id: merchant.id,
      email: merchant.email,
      name: merchant.name,
      company: merchant.company,
      status: merchant.status,
      updatedAt: merchant.updatedAt,
      passwordHashConfigured:
        Boolean(merchant.passwordHash),
      passwordHashType:
        merchant.passwordHash
          ?.slice(0, 4) ??
        null
    },
    passwordMatch
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
