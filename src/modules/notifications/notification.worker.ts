import { dbPool, withTransaction } from '../../lib/db-pool';
import { sendResendEmail } from './resend.provider';

const batchSize = Number(process.env.XPAY_NOTIFICATION_BATCH_SIZE ?? 20);
const pollMs = Number(process.env.XPAY_NOTIFICATION_POLL_MS ?? 5_000);

interface OutboxRow {
  id: string;
  merchant_id: string | null;
  recipient: string | null;
  template_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
}

const claimBatch = async (): Promise<OutboxRow[]> =>
  withTransaction(async client => {
    const result = await client.query<OutboxRow>(
      `
        SELECT
          id,
          merchant_id,
          recipient,
          template_key,
          payload,
          attempt_count,
          max_attempts
        FROM public.notification_outbox
        WHERE channel = 'email'
          AND status IN ('pending','retrying')
          AND next_attempt_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [batchSize]
    );

    if (result.rows.length === 0) {
      return [];
    }

    await client.query(
      `
        UPDATE public.notification_outbox
        SET status = 'processing',
            updated_at = now()
        WHERE id = ANY($1::uuid[])
      `,
      [result.rows.map(row => row.id)]
    );

    return result.rows;
  });

const resolveRecipient = async (row: OutboxRow): Promise<string | null> => {
  if (row.recipient) {
    return row.recipient;
  }

  if (!row.merchant_id) {
    return null;
  }

  const result = await dbPool.query<{ email: string }>(
    `SELECT email FROM public.merchants WHERE id = $1 LIMIT 1`,
    [row.merchant_id]
  );

  return result.rows[0]?.email ?? null;
};

const processRow = async (row: OutboxRow): Promise<void> => {
  const recipient = await resolveRecipient(row);

  if (!recipient) {
    throw new Error('NOTIFICATION_RECIPIENT_NOT_FOUND');
  }

  const result = await sendResendEmail({
    to: recipient,
    templateKey: row.template_key,
    payload: row.payload
  });

  await dbPool.query(
    `
      UPDATE public.notification_outbox
      SET status = 'sent',
          recipient = $2,
          attempt_count = attempt_count + 1,
          provider_message_id = $3,
          sent_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [row.id, recipient, result.providerMessageId]
  );
};

const markFailure = async (row: OutboxRow, error: unknown): Promise<void> => {
  const attemptCount = row.attempt_count + 1;
  const status = attemptCount >= row.max_attempts ? 'dead_letter' : 'retrying';

  await dbPool.query(
    `
      UPDATE public.notification_outbox
      SET status = $2,
          attempt_count = $3,
          last_error = $4,
          next_attempt_at =
            CASE
              WHEN $2 = 'dead_letter' THEN next_attempt_at
              ELSE now() + make_interval(mins => LEAST(60, POWER(2, $3)::integer))
            END,
          dead_lettered_at =
            CASE WHEN $2 = 'dead_letter' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = $1
    `,
    [
      row.id,
      status,
      attemptCount,
      error instanceof Error ? error.message : String(error)
    ]
  );
};

const tick = async (): Promise<void> => {
  const rows = await claimBatch();

  for (const row of rows) {
    try {
      await processRow(row);
    } catch (error) {
      await markFailure(row, error);
    }
  }
};

const main = async (): Promise<void> => {
  console.log('[XPAY] Notification worker started.');

  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error('[XPAY] Notification worker tick failed.', error);
    }

    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
};

void main();
