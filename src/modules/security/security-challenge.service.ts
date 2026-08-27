import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { dbPool, withTransaction } from '../../lib/db-pool';
import { sendSecurityCodeNow } from '../notifications/notification.service';

export const SECURITY_PURPOSES = [
  'verify_email',
  'confirm_live_api_key_creation',
  'confirm_api_key_rotation',
  'confirm_webhook_secret_rotation',
  'confirm_new_payout_destination',
  'confirm_payout_request',
  'confirm_banking_transfer',
  'confirm_profile_email_change',
  'confirm_password_change',
  'confirm_sensitive_settings_change'
] as const;

export type SecurityPurpose = (typeof SECURITY_PURPOSES)[number];

const getSecret = (name: string): string => {
  const value = process.env[name];

  if (!value || value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters.`);
  }

  return value;
};

const hashCode = (challengeId: string, code: string): string =>
  crypto
    .createHmac('sha256', getSecret('XPAY_SECURITY_CHALLENGE_SECRET'))
    .update(`${challengeId}:${code}`)
    .digest('hex');

const generateCode = (): string =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

export const requestSecurityChallenge = async (input: {
  merchantId: string;
  email: string;
  purpose: SecurityPurpose;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ challengeId: string; expiresAt: string }> => {
  const recent = await dbPool.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM public.security_challenges
      WHERE merchant_id = $1
        AND purpose = $2
        AND created_at > now() - interval '10 minutes'
    `,
    [input.merchantId, input.purpose]
  );

  if (Number(recent.rows[0]?.count ?? 0) >= 5) {
    throw new Error('SECURITY_CHALLENGE_RATE_LIMITED');
  }

  const challengeId = crypto.randomUUID();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await dbPool.query(
    `
      INSERT INTO public.security_challenges (
        id,
        merchant_id,
        email,
        purpose,
        resource_type,
        resource_id,
        code_hash,
        expires_at,
        requested_ip,
        requested_user_agent
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      challengeId,
      input.merchantId,
      input.email,
      input.purpose,
      input.resourceType ?? null,
      input.resourceId ?? null,
      hashCode(challengeId, code),
      expiresAt.toISOString(),
      input.ip ?? null,
      input.userAgent ?? null
    ]
  );

  await sendSecurityCodeNow({
    merchantId: input.merchantId,
    recipient: input.email,
    code,
    purpose: input.purpose
  });

  return {
    challengeId,
    expiresAt: expiresAt.toISOString()
  };
};

export const verifySecurityChallenge = async (input: {
  merchantId: string;
  challengeId: string;
  code: string;
}): Promise<{ actionToken: string; expiresAt: string }> =>
  withTransaction(async client => {
    const result = await client.query<{
      id: string;
      purpose: SecurityPurpose;
      resource_type: string | null;
      resource_id: string | null;
      code_hash: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      expires_at: Date;
    }>(
      `
        SELECT *
        FROM public.security_challenges
        WHERE id = $1
          AND merchant_id = $2
        FOR UPDATE
      `,
      [input.challengeId, input.merchantId]
    );

    const challenge = result.rows[0];

    if (!challenge) {
      throw new Error('SECURITY_CHALLENGE_NOT_FOUND');
    }

    if (challenge.status !== 'requested') {
      throw new Error('SECURITY_CHALLENGE_NOT_ACTIVE');
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE public.security_challenges SET status = 'expired' WHERE id = $1`,
        [challenge.id]
      );
      throw new Error('SECURITY_CHALLENGE_EXPIRED');
    }

    const attempts = challenge.attempt_count + 1;

    if (hashCode(challenge.id, input.code) !== challenge.code_hash) {
      await client.query(
        `
          UPDATE public.security_challenges
          SET attempt_count = $2,
              status = CASE WHEN $2 >= max_attempts THEN 'locked' ELSE status END
          WHERE id = $1
        `,
        [challenge.id, attempts]
      );

      throw new Error(
        attempts >= challenge.max_attempts
          ? 'SECURITY_CHALLENGE_LOCKED'
          : 'SECURITY_CHALLENGE_INVALID_CODE'
      );
    }

    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query(
      `
        UPDATE public.security_challenges
        SET status = 'verified',
            attempt_count = $2,
            verified_at = now()
        WHERE id = $1
      `,
      [challenge.id, attempts]
    );

    await client.query(
      `
        INSERT INTO public.security_action_tokens (
          id,
          challenge_id,
          merchant_id,
          purpose,
          resource_type,
          resource_id,
          expires_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        tokenId,
        challenge.id,
        input.merchantId,
        challenge.purpose,
        challenge.resource_type,
        challenge.resource_id,
        expiresAt.toISOString()
      ]
    );

    const actionToken = jwt.sign(
      {
        jti: tokenId,
        merchantId: input.merchantId,
        purpose: challenge.purpose,
        resourceType: challenge.resource_type,
        resourceId: challenge.resource_id
      },
      getSecret('XPAY_SECURITY_ACTION_TOKEN_SECRET'),
      {
        expiresIn: '5m',
        issuer: 'xpay.expert',
        audience: 'xpay-sensitive-action'
      }
    );

    return {
      actionToken,
      expiresAt: expiresAt.toISOString()
    };
  });

export const consumeSecurityActionToken = async (input: {
  token: string;
  merchantId: string;
  expectedPurpose: SecurityPurpose;
  expectedResourceId?: string | null;
}): Promise<void> => {
  const payload = jwt.verify(
    input.token,
    getSecret('XPAY_SECURITY_ACTION_TOKEN_SECRET'),
    {
      issuer: 'xpay.expert',
      audience: 'xpay-sensitive-action'
    }
  ) as {
    jti: string;
    merchantId: string;
    purpose: SecurityPurpose;
    resourceId?: string | null;
  };

  if (payload.merchantId !== input.merchantId) {
    throw new Error('SECURITY_ACTION_MERCHANT_MISMATCH');
  }

  if (payload.purpose !== input.expectedPurpose) {
    throw new Error('SECURITY_ACTION_PURPOSE_MISMATCH');
  }

  if (
    input.expectedResourceId &&
    payload.resourceId &&
    payload.resourceId !== input.expectedResourceId
  ) {
    throw new Error('SECURITY_ACTION_RESOURCE_MISMATCH');
  }

  const result = await dbPool.query(
    `
      UPDATE public.security_action_tokens
      SET consumed_at = now()
      WHERE id = $1
        AND merchant_id = $2
        AND purpose = $3
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING challenge_id
    `,
    [payload.jti, input.merchantId, input.expectedPurpose]
  );

  if (result.rowCount !== 1) {
    throw new Error('SECURITY_ACTION_TOKEN_INVALID_OR_CONSUMED');
  }

  await dbPool.query(
    `
      UPDATE public.security_challenges
      SET status = 'consumed',
          consumed_at = now()
      WHERE id = $1
    `,
    [result.rows[0].challenge_id]
  );
};


export const completeEmailVerification = async (input: {
  token: string;
  merchantId: string;
}): Promise<void> => {
  await consumeSecurityActionToken({
    token: input.token,
    merchantId: input.merchantId,
    expectedPurpose: 'verify_email'
  });

  await dbPool.query(
    `
      UPDATE public.merchants
      SET email_verified_at = now(),
          email_verification_required = false,
          updated_at = now()
      WHERE id = $1
    `,
    [input.merchantId]
  );
};
