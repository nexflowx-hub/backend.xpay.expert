import 'dotenv/config';

type JsonObject =
  Record<string, unknown>;

const enabled = (
  value: string | undefined
): boolean =>
  String(value ?? '')
    .trim()
    .toLowerCase() === 'true';

const readJson = async (
  response: Response
): Promise<JsonObject> => {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(
      text
    ) as JsonObject;
  } catch {
    return {
      raw: text
    };
  }
};

const testTelegram =
  async (): Promise<void> => {
    if (
      !enabled(
        process.env
          .XPAY_NOTIFICATIONS_TELEGRAM_ENABLED
      )
    ) {
      console.log({
        channel: 'telegram',
        status: 'disabled'
      });

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
        'Configuração Telegram incompleta.'
      );
    }

    const getMeResponse =
      await fetch(
        `https://api.telegram.org/bot${token}/getMe`
      );

    const getMeBody =
      await readJson(
        getMeResponse
      );

    if (!getMeResponse.ok) {
      throw new Error(
        `Telegram getMe falhou: ${
          JSON.stringify(getMeBody)
        }`
      );
    }

    const message = [
      '<b>✅ XPAY NOTIFICATION TEST</b>',
      '',
      'Canal interno operacional.',
      '',
      `<b>Environment:</b> ${
        process.env.NODE_ENV ??
        'development'
      }`,
      `<b>Timestamp:</b> ${
        new Date().toISOString()
      }`,
      '',
      'Nenhuma operação financeira foi executada.'
    ].join('\n');

    const sendResponse =
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
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview:
              true
          })
        }
      );

    const sendBody =
      await readJson(
        sendResponse
      );

    if (!sendResponse.ok) {
      throw new Error(
        `Telegram sendMessage falhou: ${
          JSON.stringify(sendBody)
        }`
      );
    }

    const result =
      sendBody.result as
        | Record<string, unknown>
        | undefined;

    console.log({
      channel: 'telegram',
      status: 'delivered',
      messageId:
        result?.message_id ??
        null
    });
  };

const testDiscord =
  async (): Promise<void> => {
    if (
      !enabled(
        process.env
          .XPAY_NOTIFICATIONS_DISCORD_ENABLED
      )
    ) {
      console.log({
        channel: 'discord',
        status: 'disabled'
      });

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
        'Discord webhook não configurado.'
      );
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
              'XPay WatchLogs',

            content:
              '✅ **XPAY NOTIFICATION TEST**\nCanal Discord operacional.',

            allowed_mentions: {
              parse: []
            }
          })
        }
      );

    const body =
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        `Discord falhou: ${
          JSON.stringify(body)
        }`
      );
    }

    console.log({
      channel: 'discord',
      status: 'delivered'
    });
  };

const testEmail =
  async (): Promise<void> => {
    if (
      !enabled(
        process.env
          .XPAY_NOTIFICATIONS_EMAIL_ENABLED
      )
    ) {
      console.log({
        channel: 'email',
        status: 'disabled'
      });

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

    const to =
      String(
        process.env
          .XPAY_EMAIL_TEST_TO ??
        ''
      );

    if (!apiKey || !from || !to) {
      throw new Error(
        'Configuração Resend incompleta.'
      );
    }

    const idempotencyKey =
      `xpay-notification-test-${
        new Date()
          .toISOString()
          .slice(0, 10)
      }`;

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
              idempotencyKey
          },

          body: JSON.stringify({
            from,
            to: [to],
            subject:
              'XPAY Notification Test',
            html:
              '<strong>Canal de email XPAY operacional.</strong>'
          })
        }
      );

    const body =
      await readJson(response);

    if (!response.ok) {
      throw new Error(
        `Resend falhou: ${
          JSON.stringify(body)
        }`
      );
    }

    console.log({
      channel: 'email',
      status: 'accepted',
      providerId:
        body.id ?? null
    });
  };

const main =
  async (): Promise<void> => {
    const results =
      await Promise.allSettled([
        testTelegram(),
        testDiscord(),
        testEmail()
      ]);

    let failed = false;

    for (const result of results) {
      if (
        result.status ===
        'rejected'
      ) {
        failed = true;

        console.error({
          status: 'failed',
          message:
            result.reason instanceof Error
              ? result.reason.message
              : String(
                  result.reason
                )
        });
      }
    }

    if (failed) {
      process.exitCode = 1;
      return;
    }

    console.log({
      success: true,
      message:
        'Testes de notificação concluídos.'
    });
  };

main().catch(error => {
  console.error({
    success: false,
    message:
      error instanceof Error
        ? error.message
        : String(error)
  });

  process.exitCode = 1;
});
