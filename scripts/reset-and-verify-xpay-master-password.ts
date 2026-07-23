import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MERCHANT_ID =
  'c8c0387b-ea92-4c31-a5bb-739e6d61d262';

const EMAIL =
  'contact@xpay.expert';

function fingerprint(
  value: string
): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  const password =
    String(
      process.env.XPAY_MASTER_NEW_PASSWORD ??
      ''
    );

  if (password.length < 12) {
    throw new Error(
      'A password deve possuir pelo menos 12 caracteres.'
    );
  }

  const result =
    await prisma.$transaction(
      async tx => {
        const merchant =
          await tx.merchant.findUnique({
            where: {
              id: MERCHANT_ID
            },

            select: {
              id: true,
              email: true,
              name: true,
              company: true,
              status: true
            }
          });

        if (!merchant) {
          throw new Error(
            'XPay-Master não encontrado.'
          );
        }

        if (
          merchant.email
            .trim()
            .toLowerCase() !==
          EMAIL
        ) {
          throw new Error(
            'O Merchant ID pertence a outro email.'
          );
        }

        const passwordHash =
          await bcrypt.hash(
            password,
            12
          );

        const generatedHashValid =
          await bcrypt.compare(
            password,
            passwordHash
          );

        if (!generatedHashValid) {
          throw new Error(
            'Falha ao validar o hash gerado.'
          );
        }

        await tx.merchant.update({
          where: {
            id: MERCHANT_ID
          },

          data: {
            passwordHash,
            status: 'active'
          }
        });

        const persisted =
          await tx.merchant.findUnique({
            where: {
              id: MERCHANT_ID
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

        if (!persisted?.passwordHash) {
          throw new Error(
            'Hash não encontrado após a atualização.'
          );
        }

        const persistedMatch =
          await bcrypt.compare(
            password,
            persisted.passwordHash
          );

        if (!persistedMatch) {
          throw new Error(
            'A password não corresponde ao hash persistido.'
          );
        }

        return {
          merchant: {
            id: persisted.id,
            email: persisted.email,
            name: persisted.name,
            company: persisted.company,
            status: persisted.status,
            updatedAt: persisted.updatedAt
          },

          persistedMatch,

          hashType:
            persisted.passwordHash
              .slice(0, 4),

          hashFingerprint:
            fingerprint(
              persisted.passwordHash
            )
        };
      }
    );

  console.log({
    success: true,

    databaseFingerprint:
      fingerprint(
        process.env.DATABASE_URL ??
        ''
      ),

    passwordVerifiedAfterPersistence:
      result.persistedMatch,

    hashType:
      result.hashType,

    hashFingerprint:
      result.hashFingerprint,

    merchant:
      result.merchant
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
