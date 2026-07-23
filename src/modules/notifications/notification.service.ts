import { dbPool } from '../../lib/db-pool';
import { sendResendEmail } from './resend.provider';

interface EnqueueEmailInput {
  merchantId?: string | null;
  recipient?: string | null;
  eventType: string;
  templateKey: string;
  payload?: Record<string, unknown>;
}

export const enqueueEmailNotification = async (
  input: EnqueueEmailInput
): Promise<string> => {
  const result = await dbPool.query<{ id: string }>(
    `
      INSERT INTO public.notification_outbox (
        merchant_id,
        event_type,
        channel,
        recipient,
        template_key,
        payload
      )
      VALUES ($1, $2, 'email', $3, $4, $5::jsonb)
      RETURNING id
    `,
    [
      input.merchantId ?? null,
      input.eventType,
      input.recipient ?? null,
      input.templateKey,
      JSON.stringify(input.payload ?? {})
    ]
  );

  return result.rows[0].id;
};

export const sendSecurityCodeNow = async (input: {
  merchantId: string;
  recipient: string;
  code: string;
  purpose: string;
}): Promise<void> => {
  const outboxId = await enqueueEmailNotification({
    merchantId: input.merchantId,
    recipient: input.recipient,
    eventType: 'security.code_requested',
    templateKey: 'security-code',
    payload: {
      code: input.code,
      purpose: input.purpose
    }
  });

  try {
    const result = await sendResendEmail({
      to: input.recipient,
      templateKey: 'security-code',
      payload: {
        code: input.code,
        purpose: input.purpose
      }
    });

    await dbPool.query(
      `
        UPDATE public.notification_outbox
        SET status = 'sent',
            attempt_count = attempt_count + 1,
            provider_message_id = $2,
            sent_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [outboxId, result.providerMessageId]
    );
  } catch (error) {
    await dbPool.query(
      `
        UPDATE public.notification_outbox
        SET status = 'retrying',
            attempt_count = attempt_count + 1,
            last_error = $2,
            next_attempt_at = now() + interval '2 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [outboxId, error instanceof Error ? error.message : String(error)]
    );

    throw error;
  }
};
