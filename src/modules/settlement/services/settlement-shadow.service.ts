import {
  Prisma
} from '@prisma/client';

import Stripe from 'stripe';

import prisma from '../../../core/prisma';

type RecordShadowInput = {
  eventId: string;
  eventType: string;
  livemode: boolean;
  transactionId: string;
  gatewayVaultId: string;
  paymentIntentId: string;
};

function money(
  value: number
): number {
  return Number(
    value.toFixed(2)
  );
}

export async function recordStripeSettlementShadow(
  input: RecordShadowInput
) {
  const transaction =
    await prisma.transaction.findUnique({
      where: {
        id: input.transactionId
      },

      include: {
        gatewayVault: true
      }
    });

  if (!transaction) {
    throw new Error(
      'SETTLEMENT_TRANSACTION_NOT_FOUND'
    );
  }

  if (
    transaction.gatewayVaultId !==
    input.gatewayVaultId
  ) {
    throw new Error(
      'SETTLEMENT_GATEWAY_VAULT_MISMATCH'
    );
  }

  if (
    !transaction.storeId ||
    !transaction.gatewayVault
  ) {
    throw new Error(
      'SETTLEMENT_TRANSACTION_SCOPE_INCOMPLETE'
    );
  }

  const credentials =
    transaction.gatewayVault.credentials &&
    typeof transaction.gatewayVault.credentials ===
      'object' &&
    !Array.isArray(
      transaction.gatewayVault.credentials
    )
      ? transaction.gatewayVault.credentials as
          Record<string, unknown>
      : {};

  const secretKey =
    String(
      credentials.secretKey ??
      ''
    ).trim();

  if (!secretKey.startsWith('sk_')) {
    throw new Error(
      'SETTLEMENT_PROVIDER_SECRET_MISSING'
    );
  }

  const stripe =
    new Stripe(
      secretKey,
      {
        apiVersion:
          '2026-06-24.dahlia' as any
      }
    );

  const charges =
    await stripe.charges.list({
      payment_intent:
        input.paymentIntentId,

      limit: 1,

      expand: [
        'data.balance_transaction'
      ]
    });

  const charge =
    charges.data[0] ?? null;

  let balanceTransaction:
    Stripe.BalanceTransaction | null =
      null;

  if (
    charge?.balance_transaction &&
    typeof charge.balance_transaction !==
      'string'
  ) {
    balanceTransaction =
      charge.balance_transaction;
  }

  if (
    charge?.balance_transaction &&
    typeof charge.balance_transaction ===
      'string'
  ) {
    balanceTransaction =
      await stripe
        .balanceTransactions
        .retrieve(
          charge.balance_transaction
        );
  }

  const grossAmount =
    money(
      Number(transaction.amount)
    );

  const providerFee =
    balanceTransaction
      ? money(
          balanceTransaction.fee /
          100
        )
      : 0;

  const policyRows =
    await prisma.$queryRaw<
      Array<{
        shadow_mode: boolean;
        platform_fee_rate: unknown;
        platform_fee_basis: string;
      }>
    >(Prisma.sql`
      SELECT
        shadow_mode,
        platform_fee_rate,
        platform_fee_basis
      FROM public.settlement_policies
      WHERE merchant_id =
        ${transaction.merchantId}::uuid
        AND store_id =
          ${transaction.storeId}::uuid
        AND gateway_vault_id =
          ${input.gatewayVaultId}::uuid
        AND settlement_enabled = true
      LIMIT 1
    `);

  const policy =
    policyRows[0];

  if (!policy) {
    throw new Error(
      'SETTLEMENT_POLICY_NOT_FOUND'
    );
  }

  const platformFeeRate =
    Number(
      policy.platform_fee_rate ??
      0.01
    );

  const platformFeeBase =
    policy.platform_fee_basis ===
      'provider_net'
      ? Math.max(
          0,
          grossAmount -
          providerFee
        )
      : grossAmount;

  const platformFee =
    money(
      platformFeeBase *
      platformFeeRate
    );

  const merchantNet =
    money(
      Math.max(
        0,
        grossAmount -
        providerFee -
        platformFee
      )
    );

  const providerAvailableAt =
    balanceTransaction?.available_on
      ? new Date(
          balanceTransaction
            .available_on *
          1000
        )
      : null;

  const providerReady =
    Boolean(
      providerAvailableAt &&
      providerAvailableAt.getTime() <=
        Date.now()
    );

  const releaseStatus =
    providerReady
      ? 'pending_review'
      : 'pending_provider';

  const businessDate =
    transaction.createdAt
      .toISOString()
      .slice(0, 10);

  const wallet =
    await prisma.wallet.findUnique({
      where: {
        merchantId_currency: {
          merchantId:
            transaction.merchantId,

          currency:
            transaction.currency
              .toUpperCase()
        }
      }
    });

  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO
            public.provider_webhook_events (
              provider,
              provider_event_id,
              gateway_vault_id,
              event_type,
              livemode,
              status,
              payload,
              processed_at
            )
          VALUES (
            'stripe',
            ${input.eventId},
            ${input.gatewayVaultId}::uuid,
            ${input.eventType},
            ${input.livemode},
            'processed',
            ${JSON.stringify({
              paymentIntentId:
                input.paymentIntentId,

              transactionId:
                input.transactionId
            })}::jsonb,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (
            provider,
            provider_event_id
          )
          DO UPDATE SET
            attempts =
              public
                .provider_webhook_events
                .attempts + 1,

            updated_at =
              CURRENT_TIMESTAMP
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO
            public.settlement_batches (
              merchant_id,
              store_id,
              gateway_vault_id,
              wallet_id,
              currency,
              business_date,
              status,
              provider_available_at,
              ready_at,
              metadata
            )
          VALUES (
            ${transaction.merchantId}::uuid,
            ${transaction.storeId}::uuid,
            ${input.gatewayVaultId}::uuid,
            ${wallet?.id ?? null}::uuid,
            ${transaction.currency.toUpperCase()},
            ${businessDate}::date,
            ${releaseStatus},
            ${providerAvailableAt},
            CASE
              WHEN ${providerReady}
              THEN CURRENT_TIMESTAMP
              ELSE NULL
            END,
            ${JSON.stringify({
              shadowMode:
                policy.shadow_mode
            })}::jsonb
          )
          ON CONFLICT (
            merchant_id,
            store_id,
            gateway_vault_id,
            currency,
            business_date
          )
          DO UPDATE SET
            wallet_id =
              EXCLUDED.wallet_id,

            provider_available_at =
              GREATEST(
                public
                  .settlement_batches
                  .provider_available_at,

                EXCLUDED
                  .provider_available_at
              ),

            status =
              CASE
                WHEN EXCLUDED.status =
                  'pending_review'
                THEN 'pending_review'

                ELSE public
                  .settlement_batches
                  .status
              END,

            ready_at =
              CASE
                WHEN EXCLUDED.status =
                  'pending_review'
                THEN COALESCE(
                  public
                    .settlement_batches
                    .ready_at,

                  CURRENT_TIMESTAMP
                )

                ELSE public
                  .settlement_batches
                  .ready_at
              END,

            updated_at =
              CURRENT_TIMESTAMP
        `
      );

      const batches =
        await tx.$queryRaw<
          Array<{
            id: string;
          }>
        >(Prisma.sql`
          SELECT id
          FROM public.settlement_batches
          WHERE merchant_id =
            ${transaction.merchantId}::uuid

            AND store_id =
              ${transaction.storeId}::uuid

            AND gateway_vault_id =
              ${input.gatewayVaultId}::uuid

            AND currency =
              ${transaction.currency.toUpperCase()}

            AND business_date =
              ${businessDate}::date
          LIMIT 1
        `);

      const batchId =
        batches[0]?.id;

      if (!batchId) {
        throw new Error(
          'SETTLEMENT_BATCH_NOT_FOUND'
        );
      }

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO
            public.settlement_items (
              batch_id,
              transaction_id,
              merchant_id,
              store_id,
              gateway_vault_id,
              wallet_id,
              provider_charge_id,
              provider_balance_transaction_id,
              gross_amount,
              provider_fee,
              platform_fee,
              merchant_net,
              currency,
              release_status,
              provider_available_at,
              ready_at,
              metadata
            )
          VALUES (
            ${batchId}::uuid,
            ${transaction.id}::uuid,
            ${transaction.merchantId}::uuid,
            ${transaction.storeId}::uuid,
            ${input.gatewayVaultId}::uuid,
            ${wallet?.id ?? null}::uuid,
            ${charge?.id ?? null},
            ${balanceTransaction?.id ?? null},
            ${grossAmount},
            ${providerFee},
            ${platformFee},
            ${merchantNet},
            ${transaction.currency.toUpperCase()},
            ${releaseStatus},
            ${providerAvailableAt},
            CASE
              WHEN ${providerReady}
              THEN CURRENT_TIMESTAMP
              ELSE NULL
            END,
            ${JSON.stringify({
              shadowMode:
                policy.shadow_mode,

              stripeFeeDetails:
                balanceTransaction
                  ?.fee_details ??
                []
            })}::jsonb
          )
          ON CONFLICT (
            transaction_id
          )
          DO UPDATE SET
            provider_charge_id =
              EXCLUDED
                .provider_charge_id,

            provider_balance_transaction_id =
              EXCLUDED
                .provider_balance_transaction_id,

            provider_fee =
              EXCLUDED.provider_fee,

            platform_fee =
              EXCLUDED.platform_fee,

            merchant_net =
              EXCLUDED.merchant_net,

            release_status =
              EXCLUDED.release_status,

            provider_available_at =
              EXCLUDED
                .provider_available_at,

            ready_at =
              EXCLUDED.ready_at,

            metadata =
              EXCLUDED.metadata,

            updated_at =
              CURRENT_TIMESTAMP
        `
      );

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE
            public.settlement_batches
          SET
            transaction_count =
              totals.transaction_count,

            gross_amount =
              totals.gross_amount,

            provider_fee =
              totals.provider_fee,

            platform_fee =
              totals.platform_fee,

            merchant_net =
              totals.merchant_net,

            status =
              totals.batch_status,

            updated_at =
              CURRENT_TIMESTAMP
          FROM (
            SELECT
              batch_id,

              COUNT(*)::integer
                AS transaction_count,

              COALESCE(
                SUM(gross_amount),
                0
              )::numeric(18,2)
                AS gross_amount,

              COALESCE(
                SUM(provider_fee),
                0
              )::numeric(18,2)
                AS provider_fee,

              COALESCE(
                SUM(platform_fee),
                0
              )::numeric(18,2)
                AS platform_fee,

              COALESCE(
                SUM(merchant_net),
                0
              )::numeric(18,2)
                AS merchant_net,

              CASE
                WHEN COUNT(*) FILTER (
                  WHERE release_status =
                    'pending_provider'
                ) > 0
                THEN 'pending_provider'

                ELSE 'pending_review'
              END
                AS batch_status

            FROM
              public.settlement_items

            WHERE batch_id =
              ${batchId}::uuid

            GROUP BY batch_id
          ) AS totals

          WHERE public
            .settlement_batches
            .id =
            totals.batch_id
        `
      );

      return {
        batchId,
        transactionId:
          transaction.id,

        providerChargeId:
          charge?.id ?? null,

        providerBalanceTransactionId:
          balanceTransaction?.id ??
          null,

        grossAmount,
        providerFee,
        platformFee,
        merchantNet,
        providerAvailableAt,
        releaseStatus,
        shadowMode:
          policy.shadow_mode
      };
    }
  );
}
