import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

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
        gatewayVault: true,
        store: true
      }
    });

  if (!transaction) {
    throw new Error('Transaction não encontrada.');
  }

  if (!transaction.providerId) {
    throw new Error(
      'Transaction sem PaymentIntent providerId.'
    );
  }

  if (!transaction.gatewayVault) {
    throw new Error(
      'Transaction sem Gateway Vault.'
    );
  }

  const credentials =
    transaction.gatewayVault.credentials &&
    typeof transaction.gatewayVault.credentials === 'object' &&
    !Array.isArray(transaction.gatewayVault.credentials)
      ? transaction.gatewayVault.credentials as
          Record<string, unknown>
      : {};

  const secretKey =
    String(credentials.secretKey ?? '');

  if (!secretKey.startsWith('sk_test_')) {
    throw new Error(
      'Este comando aceita apenas Stripe Test Keys.'
    );
  }

  const stripe =
    new Stripe(secretKey, {
      apiVersion:
        '2026-06-24.dahlia' as any
    });

  const current =
    await stripe.paymentIntents.retrieve(
      transaction.providerId
    );

  if (current.status === 'succeeded') {
    console.log({
      success: true,
      transactionId: transaction.id,
      paymentIntentId: current.id,
      status: current.status,
      alreadyConfirmed: true
    });

    return;
  }

  const confirmed =
    await stripe.paymentIntents.confirm(
      current.id,
      {
        payment_method:
          'pm_card_visa',

        return_url:
          'https://xpay.expert/payment-return'
      }
    );

  console.log({
    success: true,
    transactionId: transaction.id,
    store: transaction.store?.name,
    gatewayVaultId:
      transaction.gatewayVaultId,
    provider:
      transaction.gatewayVault.provider,
    paymentIntentId:
      confirmed.id,
    status:
      confirmed.status
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
