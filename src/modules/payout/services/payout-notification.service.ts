import prisma from '../../../core/prisma';

export type NotifiableMerchantPayout = {
  id: string;
  ticketCode: string;
  merchantId: string;
  merchantName?: string | null;
  merchantEmail?: string | null;
  walletId: string;
  sourceCurrency: string;
  sourceAmount: number;
  payoutCurrency: string;
  payoutAmount?: number | null;
  method: string;
  network?: string | null;
  destination: Record<string, unknown>;
  beneficiaryName?: string | null;
  beneficiaryCountry?: string | null;
  status: string;
  fxRequired: boolean;
  fxStatus: string;
  fxRate?: number | null;
  fxProvider?: string | null;
  fxReference?: string | null;
  reviewNote?: string | null;
  rejectionReason?: string | null;
  providerReference?: string | null;
  externalReference?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const isEnabled = (
  value: string | undefined
): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

const safeJson = (
  value: unknown
): string => {
  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return String(value);
  }
};

const truncate = (
  value: string,
  maxLength: number
): string =>
  value.length <= maxLength
    ? value
    : `${value.slice(
        0,
        maxLength - 20
      )}\n...[TRUNCATED]`;

const eventTitle = (
  eventType: string
): string => {
  const titles:
    Record<string, string> = {
      requested:
        '🚨 NOVO MERCHANT PAYOUT',
      approved:
        '✅ MERCHANT PAYOUT APROVADO',
      fx_quoted:
        '💱 COTAÇÃO FX REGISTADA',
      processing:
        '⏳ MERCHANT PAYOUT EM PROCESSAMENTO',
      paid:
        '💸 MERCHANT PAYOUT PAGO',
      rejected:
        '❌ MERCHANT PAYOUT REJEITADO',
      cancelled:
        '🚫 MERCHANT PAYOUT CANCELADO'
    };

  return (
    titles[eventType] ??
    `📣 MERCHANT PAYOUT: ${eventType}`
  );
};

const buildMessage = (
  payout: NotifiableMerchantPayout,
  eventType: string
): string => {
  const destination =
    safeJson(
      payout.destination
    );

  return [
    eventTitle(eventType),
    '',
    `Ticket: ${payout.ticketCode}`,
    `Payout ID: ${payout.id}`,
    '',
    `Merchant: ${
      payout.merchantName ??
      payout.merchantId
    }`,
    `Merchant ID: ${payout.merchantId}`,
    `Email: ${
      payout.merchantEmail ??
      '-'
    }`,
    '',
    `Wallet ID: ${payout.walletId}`,
    `Saldo origem: ${
      payout.sourceAmount
    } ${payout.sourceCurrency}`,
    `Moeda de pagamento: ${
      payout.payoutCurrency
    }`,
    `Valor de pagamento: ${
      payout.payoutAmount ??
      'PENDENTE'
    }`,
    '',
    `Método: ${payout.method}`,
    `Rede: ${
      payout.network ??
      '-'
    }`,
    '',
    `Beneficiário: ${
      payout.beneficiaryName ??
      '-'
    }`,
    `País: ${
      payout.beneficiaryCountry ??
      '-'
    }`,
    '',
    'Destino completo:',
    destination,
    '',
    `Estado: ${payout.status}`,
    `FX necessário: ${
      payout.fxRequired
        ? 'SIM'
        : 'NÃO'
    }`,
    `FX status: ${payout.fxStatus}`,
    `FX rate: ${
      payout.fxRate ??
      '-'
    }`,
    `FX provider: ${
      payout.fxProvider ??
      '-'
    }`,
    `FX reference: ${
      payout.fxReference ??
      '-'
    }`,
    '',
    `Provider reference: ${
      payout.providerReference ??
      '-'
    }`,
    `External reference: ${
      payout.externalReference ??
      '-'
    }`,
    '',
    `Nota: ${
      payout.reviewNote ??
      '-'
    }`,
    `Rejeição: ${
      payout.rejectionReason ??
      '-'
    }`,
    '',
    `Criado: ${
      new Date(
        payout.createdAt
      ).toISOString()
    }`,
    `Atualizado: ${
      new Date(
        payout.updatedAt
      ).toISOString()
    }`
  ].join('\n');
};

const createDelivery = async (
  payout: NotifiableMerchantPayout,
  eventType: string,
  channel: string,
  recipient: string
): Promise<{
  id: string;
  status: string;
} | null> => {
  const idempotencyKey =
    [
      'merchant-payout',
      payout.id,
      eventType,
      channel
    ].join(':');

  const rows =
    await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        status: string;
      }>
    >(
      `
        INSERT INTO notification_deliveries (
          subject_type,
          subject_id,
          event_type,
          channel,
          recipient,
          data_scope,
          status,
          attempts,
          idempotency_key,
          created_at,
          updated_at
        )
        VALUES (
          'merchant_payout',
          $1::uuid,
          $2,
          $3,
          $4,
          'full',
          'pending',
          0,
          $5,
          NOW(),
          NOW()
        )
        ON CONFLICT (
          idempotency_key
        )
        DO UPDATE SET
          updated_at = NOW()
        RETURNING
          id,
          status
      `,
      payout.id,
      eventType,
      channel,
      recipient,
      idempotencyKey
    );

  return rows[0] ?? null;
};

const markDelivery = async (
  deliveryId: string,
  status: string,
  options?: {
    providerMessageId?: string;
    responsePayload?: unknown;
    lastError?: string;
  }
): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `
      UPDATE notification_deliveries
      SET
        status = $2,
        attempts = attempts + 1,
        provider_message_id =
          COALESCE(
            $3,
            provider_message_id
          ),
        response_payload =
          COALESCE(
            $4::jsonb,
            response_payload
          ),
        last_error = $5,
        delivered_at =
          CASE
            WHEN $2 = 'delivered'
            THEN NOW()
            ELSE delivered_at
          END,
        updated_at = NOW()
      WHERE id = $1::uuid
    `,
    deliveryId,
    status,
    options?.providerMessageId ??
      null,
    options?.responsePayload
      ? JSON.stringify(
          options.responsePayload
        )
      : null,
    options?.lastError ??
      null
  );
};

const sendTelegram = async (
  payout: NotifiableMerchantPayout,
  eventType: string,
  message: string
): Promise<void> => {
  if (
    !isEnabled(
      process.env
        .XPAY_NOTIFICATIONS_TELEGRAM_ENABLED
    )
  ) {
    return;
  }

  const token =
    String(
      process.env
        .XPAY_TELEGRAM_BOT_TOKEN ??
      ''
    );

  const chatId =
    String(
      process.env
        .XPAY_TELEGRAM_CHAT_ID ??
      ''
    );

  if (!token || !chatId) {
    throw new Error(
      'Telegram não configurado.'
    );
  }

  const delivery =
    await createDelivery(
      payout,
      eventType,
      'telegram',
      chatId
    );

  if (
    !delivery ||
    delivery.status ===
      'delivered'
  ) {
    return;
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          chat_id: chatId,
          text: truncate(
            message,
            4000
          ),
          disable_web_page_preview:
            true
        })
      }
    );

  const body =
    await response.json()
      .catch(() => ({}));

  if (!response.ok) {
    await markDelivery(
      delivery.id,
      'failed',
      {
        responsePayload: body,
        lastError:
          safeJson(body)
      }
    );

    throw new Error(
      `Telegram falhou: ${
        safeJson(body)
      }`
    );
  }

  const result =
    (
      body as {
        result?: {
          message_id?: number;
        };
      }
    ).result;

  await markDelivery(
    delivery.id,
    'delivered',
    {
      providerMessageId:
        result?.message_id
          ? String(
              result.message_id
            )
          : undefined,
      responsePayload: body
    }
  );
};

const sendDiscord = async (
  payout: NotifiableMerchantPayout,
  eventType: string,
  message: string
): Promise<void> => {
  if (
    !isEnabled(
      process.env
        .XPAY_NOTIFICATIONS_DISCORD_ENABLED
    )
  ) {
    return;
  }

  const webhookUrl =
    String(
      process.env
        .XPAY_DISCORD_WEBHOOK_URL ??
      ''
    );

  if (!webhookUrl) {
    throw new Error(
      'Discord não configurado.'
    );
  }

  const delivery =
    await createDelivery(
      payout,
      eventType,
      'discord',
      webhookUrl
    );

  if (
    !delivery ||
    delivery.status ===
      'delivered'
  ) {
    return;
  }

  const response =
    await fetch(
      `${webhookUrl}?wait=true`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          username:
            'NeXFlowX | WatchLogs',

          content: truncate(
            message,
            1950
          ),

          allowed_mentions: {
            parse: []
          }
        })
      }
    );

  const body =
    await response.json()
      .catch(() => ({}));

  if (!response.ok) {
    await markDelivery(
      delivery.id,
      'failed',
      {
        responsePayload: body,
        lastError:
          safeJson(body)
      }
    );

    throw new Error(
      `Discord falhou: ${
        safeJson(body)
      }`
    );
  }

  await markDelivery(
    delivery.id,
    'delivered',
    {
      providerMessageId:
        String(
          (
            body as {
              id?: string;
            }
          ).id ??
          ''
        ),
      responsePayload: body
    }
  );
};

const sendEmail = async (
  payout: NotifiableMerchantPayout,
  eventType: string,
  message: string
): Promise<void> => {
  if (
    !isEnabled(
      process.env
        .XPAY_NOTIFICATIONS_EMAIL_ENABLED
    )
  ) {
    return;
  }

  const apiKey =
    String(
      process.env
        .XPAY_RESEND_API_KEY ??
      ''
    );

  const from =
    String(
      process.env
        .XPAY_EMAIL_FROM ??
      ''
    );

  const recipient =
    String(
      payout.merchantEmail ??
      ''
    );

  if (
    !apiKey ||
    !from ||
    !recipient
  ) {
    throw new Error(
      'Resend incompleto.'
    );
  }

  const delivery =
    await createDelivery(
      payout,
      eventType,
      'email',
      recipient
    );

  if (
    !delivery ||
    delivery.status ===
      'delivered'
  ) {
    return;
  }

  const response =
    await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          'Content-Type':
            'application/json',

          'Idempotency-Key':
            [
              'merchant-payout',
              payout.id,
              eventType,
              'email'
            ].join('-')
        },

        body: JSON.stringify({
          from,
          to: [recipient],
          subject:
            `${eventTitle(
              eventType
            )} — ${payout.ticketCode}`,
          text: message
        })
      }
    );

  const body =
    await response.json()
      .catch(() => ({}));

  if (!response.ok) {
    await markDelivery(
      delivery.id,
      'failed',
      {
        responsePayload: body,
        lastError:
          safeJson(body)
      }
    );

    throw new Error(
      `Resend falhou: ${
        safeJson(body)
      }`
    );
  }

  await markDelivery(
    delivery.id,
    'delivered',
    {
      providerMessageId:
        String(
          (
            body as {
              id?: string;
            }
          ).id ??
          ''
        ),
      responsePayload: body
    }
  );
};

export const notifyMerchantPayout =
  async (
    payout:
      NotifiableMerchantPayout,
    eventType: string
  ): Promise<void> => {
    const message =
      buildMessage(
        payout,
        eventType
      );

    const results =
      await Promise.allSettled([
        sendTelegram(
          payout,
          eventType,
          message
        ),
        sendDiscord(
          payout,
          eventType,
          message
        ),
        sendEmail(
          payout,
          eventType,
          message
        )
      ]);

    for (const result of results) {
      if (
        result.status ===
        'rejected'
      ) {
        console.error(
          '[MERCHANT_PAYOUT_NOTIFICATION_ERROR]',
          {
            payoutId:
              payout.id,
            eventType,
            error:
              result.reason instanceof
              Error
                ? result.reason.message
                : String(
                    result.reason
                  )
          }
        );
      }
    }
  };
