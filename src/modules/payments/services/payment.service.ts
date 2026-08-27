import {
  PrismaClient
} from '@prisma/client';

import Stripe from 'stripe';

const prisma = new PrismaClient();

const STRIPE_API_VERSION =
  '2026-06-24.dahlia' as any;

const SERVER_CONFIRMATION_METHODS =
  new Set([
    'mb_way',
    'bizum',
    'multibanco'
  ]);

const CLIENT_CONFIRMATION_METHODS =
  new Set([
    'card',
    'payment_element',
    'ideal',
    'bancontact',
    'eps',
    'klarna',
    'amazon_pay',
    'pix',
    'blik'
  ]);

const EXPLICIT_STRIPE_METHODS:
  Record<string, string[]> = {
    card: ['card'],
    ideal: ['ideal'],
    bancontact: ['bancontact'],
    eps: ['eps'],
    klarna: ['klarna'],
    amazon_pay: ['amazon_pay'],
    pix: ['pix'],
    blik: ['blik']
  };

type CustomerInput = {
  name?: string;
  email?: string;
  phone?: string;
};

type PaymentRequestBody = {
  amount?: unknown;
  currency?: unknown;
  payment_method_types?: unknown;
  reference?: unknown;
  customer?: CustomerInput;
  metadata?: Record<string, unknown>;
};

type ApiKeyContext = {
  id: string;
  environment: string;
  store: any;
};

export class PaymentApiError
  extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);

    this.name = 'PaymentApiError';
  }
}

const normalizeMethod = (
  value: unknown
): string => {
  const method = String(
    value ?? 'card'
  )
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  if (method === 'mbway') {
    return 'mb_way';
  }

  if (
    method === 'visa' ||
    method === 'mastercard' ||
    method === 'amex' ||
    method === 'apple_pay' ||
    method === 'google_pay'
  ) {
    return 'card';
  }

  if (
    method === 'automatic' ||
    method === 'auto'
  ) {
    return 'payment_element';
  }

  return method;
};

const extractRequestedMethod = (
  input: unknown
): string => {
  if (!Array.isArray(input)) {
    return 'card';
  }

  return normalizeMethod(input[0]);
};

const parseRoutingRules = (
  rules: unknown
): Record<string, string> => {
  try {
    if (typeof rules === 'string') {
      return JSON.parse(
        rules
          .replace(/\\"/g, '"')
          .replace(/^"|"$/g, '')
      );
    }

    if (
      rules &&
      typeof rules === 'object'
    ) {
      return rules as Record<
        string,
        string
      >;
    }

    return {};
  } catch {
    return {};
  }
};

const normalizePhone = (
  value: unknown,
  method: string
): string | null => {
  if (!value) {
    return null;
  }

  let phone = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[().-]/g, '');

  if (phone.startsWith('00')) {
    phone = `+${phone.slice(2)}`;
  }

  if (method === 'bizum') {
    if (/^\d{9}$/.test(phone)) {
      phone = `+34${phone}`;
    } else if (/^34\d{9}$/.test(phone)) {
      phone = `+${phone}`;
    }

    return /^\+34\d{9}$/.test(phone)
      ? phone
      : null;
  }

  if (method === 'mb_way') {
    if (/^\d{9}$/.test(phone)) {
      phone = `+351${phone}`;
    } else if (/^351\d{9}$/.test(phone)) {
      phone = `+${phone}`;
    }

    return /^\+\d{8,15}$/.test(phone)
      ? phone
      : null;
  }

  if (!phone.startsWith('+')) {
    phone = `+${phone}`;
  }

  return /^\+\d{8,15}$/.test(phone)
    ? phone
    : null;
};

const maskPhone = (
  phone: string | null
): string | null => {
  if (!phone) {
    return null;
  }

  if (phone.length <= 6) {
    return '***';
  }

  return (
    phone.slice(0, 4) +
    '*'.repeat(
      Math.max(
        phone.length - 7,
        3
      )
    ) +
    phone.slice(-3)
  );
};

const redactValue = (
  value: unknown
): any => {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    const result:
      Record<string, unknown> = {};

    for (
      const [key, nestedValue]
      of Object.entries(value)
    ) {
      if (
        /secret|password|token|authorization|api.?key|client_secret/i
          .test(key)
      ) {
        result[key] = '[REDACTED]';
        continue;
      }

      if (
        key.toLowerCase() ===
        'phone'
      ) {
        result[key] =
          maskPhone(
            String(
              nestedValue ?? ''
            )
          );

        continue;
      }

      result[key] =
        redactValue(nestedValue);
    }

    return result;
  }

  return value;
};

const sanitizePaymentIntent = (
  paymentIntent: any
) => ({
  id: paymentIntent?.id ?? null,

  object:
    paymentIntent?.object ??
    'payment_intent',

  amount:
    paymentIntent?.amount ?? null,

  amountReceived:
    paymentIntent
      ?.amount_received ?? null,

  amountCapturable:
    paymentIntent
      ?.amount_capturable ?? null,

  currency:
    paymentIntent?.currency ?? null,

  status:
    paymentIntent?.status ?? null,

  livemode:
    paymentIntent?.livemode ?? null,

  paymentMethodTypes:
    paymentIntent
      ?.payment_method_types ?? [],

  paymentMethod:
    typeof paymentIntent
      ?.payment_method === 'string'
      ? paymentIntent.payment_method
      : paymentIntent
          ?.payment_method?.id ??
        null,

  latestCharge:
    typeof paymentIntent
      ?.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent
          ?.latest_charge?.id ??
        null,

  nextActionType:
    paymentIntent
      ?.next_action?.type ??
    null,

  failureCode:
    paymentIntent
      ?.last_payment_error
      ?.code ?? null,

  declineCode:
    paymentIntent
      ?.last_payment_error
      ?.decline_code ?? null,

  failureMessage:
    paymentIntent
      ?.last_payment_error
      ?.message ?? null,

  metadata: {
    transactionId:
      paymentIntent
        ?.metadata
        ?.xpay_transaction_id ??
      paymentIntent
        ?.metadata
        ?.nexflowx_transaction_id ??
      null,

    merchantReference:
      paymentIntent
        ?.metadata
        ?.merchant_reference ??
      null
  }
});

const stripeKeyMode = (
  key: string
): 'test' | 'live' | 'unknown' => {
  if (
    key.startsWith('sk_test_') ||
    key.startsWith('rk_test_') ||
    key.startsWith('pk_test_')
  ) {
    return 'test';
  }

  if (
    key.startsWith('sk_live_') ||
    key.startsWith('rk_live_') ||
    key.startsWith('pk_live_')
  ) {
    return 'live';
  }

  return 'unknown';
};

const getApiKeyContext = async (
  apiKey: string
): Promise<ApiKeyContext> => {
  const keyRecord =
    await prisma.apiKey.findUnique({
      where: {
        key: apiKey
      },
      include: {
        store: true
      }
    });

  if (
    !keyRecord ||
    keyRecord.store.status !==
      'active'
  ) {
    throw new PaymentApiError(
      401,
      'ACCESS_DENIED',
      'API Key inválida ou Store inativa.'
    );
  }

  return keyRecord as ApiKeyContext;
};

const validateEnvironment = (
  environment: string,
  secretKey: string,
  publishableKey?: string
): void => {
  const expectedMode =
    environment
      .trim()
      .toLowerCase();

  const secretMode =
    stripeKeyMode(secretKey);

  if (
    expectedMode === 'test' &&
    secretMode !== 'test'
  ) {
    throw new PaymentApiError(
      409,
      'TEST_KEY_LIVE_GATEWAY_MISMATCH',
      'A API Key Test não pode utilizar um Gateway Stripe Live.'
    );
  }

  if (
    expectedMode === 'live' &&
    secretMode !== 'live'
  ) {
    throw new PaymentApiError(
      409,
      'LIVE_KEY_TEST_GATEWAY_MISMATCH',
      'A API Key Live não pode utilizar um Gateway Stripe Test.'
    );
  }

  if (publishableKey) {
    const publicMode =
      stripeKeyMode(
        publishableKey
      );

    if (
      publicMode !== 'unknown' &&
      publicMode !== secretMode
    ) {
      throw new PaymentApiError(
        500,
        'STRIPE_KEY_MODE_MISMATCH',
        'As chaves pública e secreta do Gateway pertencem a ambientes diferentes.'
      );
    }
  }
};

const resolveGatewayVault = (
  availableVaults: any[],
  routingRules: Record<
    string,
    string
  >,
  method: string,
  existingGatewayVaultId?: string | null
): any => {
  if (existingGatewayVaultId) {
    const existingVault =
      availableVaults.find(
        vault =>
          vault.id ===
          existingGatewayVaultId
      );

    if (existingVault) {
      return existingVault;
    }
  }

  const targetProvider =
    routingRules[method] ??
    routingRules[
      method ===
        'payment_element'
        ? 'card'
        : method
    ];

  if (targetProvider) {
    const routed =
      availableVaults.find(
        vault =>
          vault.provider
            .toLowerCase() ===
          targetProvider
            .toLowerCase()
      );

    if (routed) {
      return routed;
    }
  }

  const stripeVault =
    availableVaults.find(
      vault =>
        vault.provider
          .toLowerCase()
          .startsWith('stripe')
    );

  return (
    stripeVault ??
    availableVaults[0] ??
    null
  );
};

const mapInternalStatus = (
  providerStatus: string,
  clientConfirmation: boolean
): string => {
  switch (providerStatus) {
    case 'succeeded':
      return 'succeeded';

    case 'processing':
      return 'processing';

    case 'canceled':
      return 'canceled';

    case 'requires_payment_method':
      return clientConfirmation
        ? 'pending'
        : 'failed';

    default:
      return 'pending';
  }
};

const buildResponse = (
  paymentIntent: any,
  transaction: any,
  method: string,
  credentials: any,
  metadata: Record<
    string,
    unknown
  >,
  amountInCents: number,
  currencyUpper: string
) => {
  const clientConfirmation =
    CLIENT_CONFIRMATION_METHODS
      .has(method);

  if (clientConfirmation) {
    const publishableKey =
      String(
        credentials
          ?.publishableKey ??
        credentials
          ?.publicKey ??
        ''
      ).trim();

    if (!publishableKey) {
      throw new PaymentApiError(
        500,
        'STRIPE_PUBLIC_KEY_MISSING',
        'A chave pública Stripe não está configurada no Gateway Vault.'
      );
    }

    return {
      success: true,

      transactionId:
        transaction.id,

      reference:
        transaction.reference,

      providerId:
        paymentIntent.id,

      status:
        paymentIntent.status,

      internalStatus:
        mapInternalStatus(
          paymentIntent.status,
          true
        ),

      method,

      flow:
        'client_confirmation',

      action: {
        type:
          'stripe_elements',

        mode:
          'payment',

        clientSecret:
          paymentIntent
            .client_secret,

        publishableKey,

        returnUrl:
          String(
            metadata.return_url ??
            'https://xpay.expert/payment/complete'
          ),

        paymentMethodTypes:
          paymentIntent
            .payment_method_types ??
          []
      }
    };
  }

  if (
    method === 'multibanco'
  ) {
    const nextAction =
      paymentIntent.next_action as any;

    const details =
      nextAction
        ?.multibanco_display_details;

    const expiresAt =
      details?.expires_at
        ? new Date(
            details.expires_at *
            1000
          ).toISOString()
        : null;

    return {
      success: true,

      transactionId:
        transaction.id,

      reference:
        transaction.reference,

      providerId:
        paymentIntent.id,

      status:
        paymentIntent.status,

      internalStatus:
        mapInternalStatus(
          paymentIntent.status,
          false
        ),

      method,

      flow: 'voucher',

      action: details
        ? {
            type:
              'multibanco_reference',

            entity:
              details.entity,

            reference:
              details.reference,

            amount:
              `${(
                amountInCents /
                100
              ).toFixed(2)} ${currencyUpper}`,

            expiresAt,

            hostedVoucherUrl:
              details
                .hosted_voucher_url ??
              null,

            /*
             * Aliases temporários para
             * compatibilidade.
             */
            entidade:
              details.entity,

            referencia:
              details.reference,

            montante:
              `${(
                amountInCents /
                100
              ).toFixed(2)} ${currencyUpper}`
          }
        : null
    };
  }

  const nextAction =
    paymentIntent.next_action as any;

  const action:
    Record<string, unknown> = {
      type: 'bank_app',

      message:
        method === 'bizum'
          ? 'Pedido Bizum enviado. Confirme na aplicação do seu banco.'
          : 'Pedido MB WAY enviado. Confirme na aplicação.'
  };

  const redirectUrl =
    nextAction
      ?.redirect_to_url
      ?.url ??
    nextAction
      ?.bizum_authorize_url ??
    null;

  if (redirectUrl) {
    action.url = redirectUrl;
  }

  return {
    success: true,

    transactionId:
      transaction.id,

    reference:
      transaction.reference,

    providerId:
      paymentIntent.id,

    status:
      paymentIntent.status,

    internalStatus:
      mapInternalStatus(
        paymentIntent.status,
        false
      ),

    method,

    flow:
      'server_confirmation',

    action
  };
};

export const executePayment =
  async (
    apiKey: string,
    body: PaymentRequestBody
  ) => {
    if (!apiKey) {
      throw new PaymentApiError(
        401,
        'API_KEY_REQUIRED',
        'API Key não fornecida.'
      );
    }

    const keyRecord =
      await getApiKeyContext(
        apiKey
      );

    const store =
      keyRecord.store;

    const amountInCents =
      Number(body.amount);

    if (
      !Number.isInteger(
        amountInCents
      ) ||
      amountInCents <= 0
    ) {
      throw new PaymentApiError(
        400,
        'INVALID_AMOUNT',
        'O amount deve ser um inteiro positivo em cêntimos.'
      );
    }

    const currencyUpper =
      String(
        body.currency ?? ''
      )
        .trim()
        .toUpperCase();

    if (
      !/^[A-Z]{3}$/.test(
        currencyUpper
      )
    ) {
      throw new PaymentApiError(
        400,
        'INVALID_CURRENCY',
        'Moeda inválida.'
      );
    }

    const method =
      extractRequestedMethod(
        body.payment_method_types
      );

    if (
      !SERVER_CONFIRMATION_METHODS
        .has(method) &&
      !CLIENT_CONFIRMATION_METHODS
        .has(method)
    ) {
      throw new PaymentApiError(
        400,
        'PAYMENT_METHOD_NOT_SUPPORTED',
        `Método não suportado: ${method}.`
      );
    }

    if (
      SERVER_CONFIRMATION_METHODS
        .has(method) &&
      currencyUpper !== 'EUR'
    ) {
      throw new PaymentApiError(
        400,
        'EUR_REQUIRED',
        `${method} aceita apenas pagamentos em EUR.`
      );
    }

    const customer =
      body.customer ?? {};

    const metadata =
      body.metadata ?? {};

    const merchantReference =
      String(
        metadata.order_id ??
        metadata.reference ??
        body.reference ??
        ''
      ).trim();

    if (!merchantReference) {
      throw new PaymentApiError(
        400,
        'REFERENCE_REQUIRED',
        'metadata.order_id é obrigatório.'
      );
    }

    const phone =
      normalizePhone(
        customer.phone,
        method
      );

    if (
      method === 'mb_way' &&
      !phone
    ) {
      throw new PaymentApiError(
        400,
        'INVALID_MBWAY_PHONE',
        'Telefone inválido para MB WAY.'
      );
    }

    if (
      method === 'bizum' &&
      !phone
    ) {
      throw new PaymentApiError(
        400,
        'INVALID_BIZUM_PHONE',
        'Informe um número espanhol válido para Bizum.'
      );
    }

    if (
      method === 'bizum' &&
      (
        amountInCents < 50 ||
        amountInCents > 500000
      )
    ) {
      throw new PaymentApiError(
        400,
        'BIZUM_AMOUNT_OUT_OF_RANGE',
        'O valor Bizum deve estar entre EUR 0,50 e EUR 5.000,00.'
      );
    }

    if (
      method ===
        'multibanco' &&
      !String(
        customer.email ?? ''
      ).trim()
    ) {
      throw new PaymentApiError(
        400,
        'MULTIBANCO_EMAIL_REQUIRED',
        'O email é obrigatório para Multibanco.'
      );
    }

    let transaction =
      await prisma.transaction
        .findUnique({
          where: {
            reference:
              merchantReference
          }
        });

    if (
      transaction &&
      transaction.storeId !==
        store.id
    ) {
      throw new PaymentApiError(
        409,
        'REFERENCE_ALREADY_IN_USE',
        'A referência já está associada a outra Store.'
      );
    }

    if (
      transaction &&
      normalizeMethod(
        transaction.method
      ) !== method
    ) {
      throw new PaymentApiError(
        409,
        'REFERENCE_METHOD_MISMATCH',
        'A referência já foi usada com outro método.'
      );
    }

    if (
      transaction &&
      (
        Math.round(
          Number(
            transaction.amount
          ) * 100
        ) !== amountInCents ||
        transaction.currency
          .toUpperCase() !==
          currencyUpper
      )
    ) {
      throw new PaymentApiError(
        409,
        'REFERENCE_PAYLOAD_MISMATCH',
        'A referência já foi usada com outro valor ou moeda.'
      );
    }

    if (
      transaction?.status ===
      'succeeded'
    ) {
      throw new PaymentApiError(
        409,
        'TRANSACTION_ALREADY_PAID',
        'Transação já paga.'
      );
    }

    const availableVaults =
      await prisma
        .gatewayVault
        .findMany({
          where: {
            merchantId:
              store.merchantId,

            isActive: true,

            OR: [
              {
                storeId: null
              },
              {
                storeId:
                  store.id
              }
            ]
          }
        });

    const routingRules =
      parseRoutingRules(
        store.routingRules
      );

    const gatewayVault =
      resolveGatewayVault(
        availableVaults,
        routingRules,
        method,
        transaction
          ?.gatewayVaultId
      );

    if (!gatewayVault) {
      throw new PaymentApiError(
        400,
        'GATEWAY_NOT_CONFIGURED',
        `Nenhum Gateway configurado para ${method}.`
      );
    }

    if (
      !gatewayVault.provider
        .toLowerCase()
        .startsWith('stripe')
    ) {
      throw new PaymentApiError(
        400,
        'PROVIDER_NOT_SUPPORTED',
        'O Gateway selecionado ainda não suporta este fluxo.'
      );
    }

    const credentials =
      gatewayVault
        .credentials as any;

    const secretKey =
      String(
        credentials
          ?.secretKey ?? ''
      ).trim();

    if (!secretKey) {
      throw new PaymentApiError(
        500,
        'STRIPE_SECRET_KEY_MISSING',
        'A chave secreta Stripe não está configurada.'
      );
    }

    const publishableKey =
      String(
        credentials
          ?.publishableKey ??
        credentials
          ?.publicKey ??
        ''
      ).trim();

    validateEnvironment(
      keyRecord.environment,
      secretKey,
      publishableKey ||
        undefined
    );

    const stripe =
      new Stripe(
        secretKey,
        {
          apiVersion:
            STRIPE_API_VERSION
        }
      );

    if (
      transaction?.providerId
    ) {
      const existingIntent =
        await stripe
          .paymentIntents
          .retrieve(
            transaction.providerId
          );

      return buildResponse(
        existingIntent,
        transaction,
        method,
        credentials,
        metadata,
        amountInCents,
        currencyUpper
      );
    }

    if (transaction) {
      transaction =
        await prisma.transaction
          .update({
            where: {
              id: transaction.id
            },
            data: {
              status: 'pending',

              gatewayVaultId:
                gatewayVault.id,

              gateway:
                gatewayVault
                  .provider,

              customerEmail:
                customer.email ??
                null,

              rawRequest:
                redactValue(body)
            }
          });
    } else {
      transaction =
        await prisma.transaction
          .create({
            data: {
              merchantId:
                store.merchantId,

              storeId:
                store.id,

              gatewayVaultId:
                gatewayVault.id,

              reference:
                merchantReference,

              amount:
                amountInCents /
                100,

              currency:
                currencyUpper,

              status:
                'pending',

              method,

              gateway:
                gatewayVault
                  .provider,

              customer:
                customer.name ??
                null,

              customerEmail:
                customer.email ??
                null,

              metadata:
                redactValue(
                  metadata
                ),

              rawRequest:
                redactValue(body)
            }
          });
    }

    const stripePayload: any = {
      amount:
        amountInCents,

      currency:
        currencyUpper
          .toLowerCase(),

      metadata: {
        xpay_transaction_id:
          transaction.id,

        /*
         * Compatibilidade temporária
         * com o dispatcher anterior.
         */
        nexflowx_transaction_id:
          transaction.id,

        merchant_reference:
          merchantReference,

        order_id:
          merchantReference
      }
    };

    const clientConfirmation =
      CLIENT_CONFIRMATION_METHODS
        .has(method);

    if (clientConfirmation) {
      if (
        method ===
          'payment_element'
      ) {
        stripePayload
          .automatic_payment_methods = {
            enabled: true
          };
      } else {
        stripePayload
          .payment_method_types =
            EXPLICIT_STRIPE_METHODS[
              method
            ];
      }
    } else {
      stripePayload
        .payment_method_types = [
          method
        ];

      stripePayload
        .payment_method_data = {
          type: method,

          billing_details: {
            name:
              customer.name ??
              undefined,

            email:
              customer.email ??
              undefined,

            phone:
              phone ??
              undefined
          }
        };

      stripePayload.confirm =
        true;

      if (method === 'bizum') {
        stripePayload
          .return_url =
            String(
              metadata
                .return_url ??
              'https://xpay.expert/payment/complete'
            );
      }
    }

    const idempotencyKey =
      [
        'xpay',
        store.id,
        merchantReference,
        method
      ]
        .join(':')
        .slice(0, 255);

    let paymentIntent:
      Stripe.PaymentIntent;

    try {
      paymentIntent =
        await stripe
          .paymentIntents
          .create(
            stripePayload,
            {
              idempotencyKey
            }
          );
    } catch (error: any) {
      await prisma.transaction
        .update({
          where: {
            id:
              transaction.id
          },
          data: {
            status: 'failed',

            rawResponse: {
              status: 'failed',

              code:
                error?.code ??
                'STRIPE_REQUEST_ERROR',

              type:
                error?.type ??
                null,

              message:
                error?.message ??
                'Stripe request failed'
            }
          }
        });

      console.error(
        '[XPAY_STRIPE_CREATE_ERROR]',
        {
          transactionId:
            transaction.id,

          method,

          code:
            error?.code ??
            null,

          type:
            error?.type ??
            null,

          message:
            error?.message ??
            null
        }
      );

      throw new PaymentApiError(
        400,
        error?.code ??
          'STRIPE_REQUEST_ERROR',
        'O método não pôde ser iniciado com a configuração atual do Gateway.'
      );
    }

    const internalStatus =
      mapInternalStatus(
        paymentIntent.status,
        clientConfirmation
      );

    await prisma.transaction
      .update({
        where: {
          id:
            transaction.id
        },
        data: {
          providerId:
            paymentIntent.id,

          status:
            internalStatus,

          rawResponse:
            sanitizePaymentIntent(
              paymentIntent
            )
        }
      });

    return buildResponse(
      paymentIntent,
      transaction,
      method,
      credentials,
      metadata,
      amountInCents,
      currencyUpper
    );
  };

export const getPaymentStatus =
  async (
    apiKey: string,
    reference: string
  ) => {
    if (!apiKey) {
      throw new PaymentApiError(
        401,
        'API_KEY_REQUIRED',
        'API Key não fornecida.'
      );
    }

    const keyRecord =
      await getApiKeyContext(
        apiKey
      );

    const transaction =
      await prisma.transaction
        .findFirst({
          where: {
            storeId:
              keyRecord.store.id,

            reference
          }
        });

    if (!transaction) {
      throw new PaymentApiError(
        404,
        'TRANSACTION_NOT_FOUND',
        'Transação não encontrada.'
      );
    }

    const safeProviderResponse =
      transaction.rawResponse &&
      typeof transaction
        .rawResponse === 'object'
        ? transaction.rawResponse
        : null;

    return {
      success: true,

      transactionId:
        transaction.id,

      reference:
        transaction.reference,

      providerId:
        transaction.providerId,

      status:
        transaction.status,

      providerStatus:
        (
          safeProviderResponse as any
        )?.status ?? null,

      method:
        transaction.method,

      amount:
        Number(
          transaction.amount
        ),

      currency:
        transaction.currency,

      fee:
        transaction.fee === null
          ? null
          : Number(
              transaction.fee
            ),

      gateway:
        transaction.gateway,

      createdAt:
        transaction.createdAt
    };
  };

export {
  sanitizePaymentIntent
};
