import {
  Request,
  Response
} from 'express';

import {
  PrismaClient
} from '@prisma/client';

import Stripe from 'stripe';

import {
  dispatchMerchantWebhook
} from '../../../core/utils/webhook-dispatcher';

import {
  sanitizePaymentIntent
} from '../services/payment.service';

const prisma =
  new PrismaClient();

const stripe =
  new Stripe(
    process.env
      .STRIPE_WEBHOOK_API_KEY ??
    'sk_test_signature_validation_only',
    {
      apiVersion:
        '2026-06-24.dahlia' as any
    }
  );

const supportedEvents =
  new Set([
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.processing',
    'payment_intent.canceled'
  ]);

const resolveEventStatus = (
  eventType: string
): string => {
  switch (eventType) {
    case 'payment_intent.succeeded':
      return 'succeeded';

    case 'payment_intent.payment_failed':
      return 'failed';

    case 'payment_intent.processing':
      return 'processing';

    case 'payment_intent.canceled':
      return 'canceled';

    default:
      return 'pending';
  }
};

const parseStripeEvent = (
  req: Request
): Stripe.Event => {
  const rawBody =
    Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(
          typeof req.body ===
            'string'
            ? req.body
            : JSON.stringify(
                req.body ?? {}
              )
        );

  const webhookSecret =
    String(
      process.env
        .STRIPE_WEBHOOK_SECRET ??
      ''
    ).trim();

  if (webhookSecret) {
    const header =
      req.headers[
        'stripe-signature'
      ];

    const signature =
      Array.isArray(header)
        ? header[0]
        : header;

    if (!signature) {
      throw new Error(
        'STRIPE_SIGNATURE_MISSING'
      );
    }

    return stripe.webhooks
      .constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
  }

  const environment =
    String(
      process.env.APP_ENV ??
      process.env.NODE_ENV ??
      'lab'
    ).toLowerCase();

  if (
    ![
      'lab',
      'test',
      'development'
    ].includes(environment)
  ) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED'
    );
  }

  console.warn(
    '⚠️ [STRIPE WEBHOOK] Assinatura não validada porque STRIPE_WEBHOOK_SECRET não está configurado no ambiente Lab.'
  );

  return JSON.parse(
    rawBody.toString('utf8')
  ) as Stripe.Event;
};

export const handleStripeWebhook =
  async (
    req: Request,
    res: Response
  ) => {
    let event:
      Stripe.Event;

    try {
      event =
        parseStripeEvent(req);
    } catch (error) {
      console.error(
        '[STRIPE_WEBHOOK_SIGNATURE_ERROR]',
        error
      );

      return res.status(400).json({
        received: false,
        error:
          'invalid_signature'
      });
    }

    if (
      !supportedEvents.has(
        event.type
      )
    ) {
      return res.status(200).json({
        received: true,
        ignored: true
      });
    }

    try {
      const paymentIntent =
        event.data
          .object as Stripe.PaymentIntent;

      const transactionId =
        paymentIntent.metadata
          ?.xpay_transaction_id ??
        paymentIntent.metadata
          ?.nexflowx_transaction_id;

      if (!transactionId) {
        return res.status(200).json({
          received: true,
          ignored: true,
          reason:
            'transaction_id_missing'
        });
      }

      const transaction =
        await prisma.transaction
          .findUnique({
            where: {
              id: transactionId
            }
          });

      if (!transaction) {
        console.warn(
          '[STRIPE_WEBHOOK_TRANSACTION_NOT_FOUND]',
          {
            eventId:
              event.id,

            transactionId
          }
        );

        return res.status(200).json({
          received: true,
          ignored: true,
          reason:
            'transaction_not_found'
        });
      }

      const newStatus =
        resolveEventStatus(
          event.type
        );

      const safeResponse =
        sanitizePaymentIntent(
          paymentIntent
        );

      const amount =
        Number(
          transaction.amount
        );

      const feeRate =
        Number(
          process.env
            .XPAY_PAYMENT_FEE_RATE ??
          0.02
        );

      const totalFee =
        newStatus ===
          'succeeded'
          ? Number(
              (
                amount *
                feeRate
              ).toFixed(2)
            )
          : 0;

      const netAmount =
        newStatus ===
          'succeeded'
          ? Number(
              (
                amount -
                totalFee
              ).toFixed(2)
            )
          : 0;

      let financialProcessingDone =
        false;

      if (
        newStatus ===
        'succeeded'
      ) {
        financialProcessingDone =
          await prisma
            .$transaction(
              async tx => {
                const claim =
                  await tx
                    .transaction
                    .updateMany({
                      where: {
                        id:
                          transactionId,

                        status: {
                          not:
                            'succeeded'
                        }
                      },

                      data: {
                        status:
                          'succeeded',

                        providerId:
                          paymentIntent.id,

                        fee:
                          totalFee,

                        rawResponse:
                          safeResponse
                      }
                    });

                if (
                  claim.count === 0
                ) {
                  return false;
                }

                const currency =
                  transaction
                    .currency
                    .toUpperCase();

                const wallet =
                  await tx.wallet
                    .upsert({
                      where: {
                        merchantId_currency: {
                          merchantId:
                            transaction
                              .merchantId,

                          currency
                        }
                      },

                      update: {
                        balance: {
                          increment:
                            netAmount
                        }
                      },

                      create: {
                        merchantId:
                          transaction
                            .merchantId,

                        currency,

                        balance:
                          netAmount,

                        available:
                          0,

                        type: 'fiat'
                      }
                    });

                await tx
                  .walletMovement
                  .create({
                    data: {
                      walletId:
                        wallet.id,

                      merchantId:
                        transaction
                          .merchantId,

                      currency,

                      type:
                        'payment',

                      direction:
                        'in',

                      amount:
                        netAmount,

                      status:
                        'pendente',

                      reference:
                        transaction.id,

                      metadata: {
                        eventId:
                          event.id,

                        provider:
                          'stripe',

                        providerId:
                          paymentIntent.id,

                        grossAmount:
                          amount,

                        fee:
                          totalFee,

                        netAmount
                      }
                    }
                  });

                return true;
              }
            );
      } else {
        await prisma.transaction
          .updateMany({
            where: {
              id:
                transactionId,

              status: {
                not:
                  'succeeded'
              }
            },

            data: {
              status:
                newStatus,

              providerId:
                paymentIntent.id,

              fee: 0,

              rawResponse:
                safeResponse
            }
          });
      }

      try {
        await dispatchMerchantWebhook(
          transaction.id,
          event.type,
          safeResponse
        );
      } catch (dispatchError) {
        console.error(
          '[XPAY_MERCHANT_WEBHOOK_ERROR]',
          dispatchError
        );
      }

      console.log(
        '[XPAY_STRIPE_WEBHOOK_PROCESSED]',
        {
          eventId:
            event.id,

          eventType:
            event.type,

          transactionId,

          providerId:
            paymentIntent.id,

          status:
            newStatus,

          financialProcessingDone
        }
      );

      return res.status(200).json({
        received: true,

        transactionId,

        status:
          newStatus,

        financialProcessingDone
      });
    } catch (error) {
      console.error(
        '[XPAY_STRIPE_WEBHOOK_FATAL]',
        error
      );

      return res.status(500).json({
        received: false,
        error:
          'internal_server_error'
      });
    }
  };
