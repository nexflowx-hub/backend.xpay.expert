import crypto from 'node:crypto';
import { dbPool, withTransaction } from '../../lib/db-pool';
import { consumeSecurityActionToken } from './security-challenge.service';

const apiKeyPepper = (): string => {
  const value = process.env.XPAY_API_KEY_HASH_PEPPER;

  if (!value || value.length < 32) {
    throw new Error('XPAY_API_KEY_HASH_PEPPER must contain at least 32 characters.');
  }

  return value;
};

const hashApiKey = (fullKey: string): string =>
  crypto
    .createHmac('sha256', apiKeyPepper())
    .update(fullKey)
    .digest('hex');

const generateApiKey = (
  environment: 'test' | 'live'
): {
  fullKey: string;
  prefix: string;
  lastFour: string;
  hash: string;
} => {
  const prefix = environment === 'live' ? 'xpay_live_' : 'xpay_test_';
  const secret = crypto.randomBytes(32).toString('base64url');
  const fullKey = `${prefix}${secret}`;

  return {
    fullKey,
    prefix,
    lastFour: fullKey.slice(-4),
    hash: hashApiKey(fullKey)
  };
};

const tableColumns = async (): Promise<Set<string>> => {
  const result = await dbPool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'api_keys'
    `
  );

  return new Set(result.rows.map(row => row.column_name));
};

export const listSecureApiKeys = async (
  merchantId: string,
  storeId?: string | null
): Promise<unknown[]> => {
  const values: unknown[] = [merchantId];
  const storeFilter = storeId
    ? `AND ak.store_id = $${values.push(storeId)}`
    : '';

  const result = await dbPool.query(
    `
      SELECT
        ak.id,
        ak.store_id,
        s.store_code,
        s.name AS store_name,
        ak.key_prefix,
        ak.key_last_four,
        ak.environment,
        ak.scopes,
        ak.status,
        ak.last_used_at,
        ak.expires_at,
        ak.revoked_at,
        ak.created_at
      FROM public.api_keys ak
      JOIN public.stores s ON s.id = ak.store_id
      WHERE COALESCE(ak.merchant_id, s.merchant_id) = $1
        ${storeFilter}
      ORDER BY ak.created_at DESC
    `,
    values
  );

  return result.rows;
};

const insertApiKey = async (input: {
  merchantId: string;
  storeId: string;
  name?: string | null;
  environment: 'test' | 'live';
  scopes: string[];
  ip?: string | null;
  userAgent?: string | null;
  rotatedFromId?: string | null;
}): Promise<{
  id: string;
  fullKey: string;
  keyPrefix: string;
  keyLastFour: string;
  environment: string;
  scopes: string[];
}> => {
  const ownership = await dbPool.query(
    `
      SELECT id
      FROM public.stores
      WHERE id = $1
        AND merchant_id = $2
      LIMIT 1
    `,
    [input.storeId, input.merchantId]
  );

  if (!ownership.rows[0]) {
    throw new Error('API_KEY_STORE_NOT_FOUND');
  }

  const generated = generateApiKey(input.environment);
  const columns = await tableColumns();

  const insertColumns = [
    'merchant_id',
    'store_id',
    'key_prefix',
    'key_last_four',
    'key_hash',
    'environment',
    'scopes',
    'status',
    'rotated_from_id',
    'created_by_ip',
    'created_by_user_agent'
  ];

  const values: unknown[] = [
    input.merchantId,
    input.storeId,
    generated.prefix,
    generated.lastFour,
    generated.hash,
    input.environment,
    JSON.stringify(input.scopes),
    'active',
    input.rotatedFromId ?? null,
    input.ip ?? null,
    input.userAgent ?? null
  ];

  if (columns.has('key')) {
    // Transitional dual-write. Remove only after every S2S validator uses key_hash.
    insertColumns.push('key');
    values.push(generated.fullKey);
  }

  if (columns.has('name')) {
    insertColumns.push('name');
    values.push(input.name ?? `${input.environment.toUpperCase()} API Key`);
  }

  if (columns.has('active')) {
    insertColumns.push('active');
    values.push(true);
  }

  const placeholders = values.map((_, index) => `$${index + 1}`);
  const result = await dbPool.query<{ id: string }>(
    `
      INSERT INTO public.api_keys (${insertColumns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING id
    `,
    values
  );

  return {
    id: result.rows[0].id,
    fullKey: generated.fullKey,
    keyPrefix: generated.prefix,
    keyLastFour: generated.lastFour,
    environment: input.environment,
    scopes: input.scopes
  };
};

export const createSecureApiKey = async (input: {
  merchantId: string;
  storeId: string;
  name?: string | null;
  environment: 'test' | 'live';
  scopes: string[];
  securityActionToken?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  if (input.environment === 'live') {
    if (!input.securityActionToken) {
      throw new Error('SECURITY_ACTION_TOKEN_REQUIRED');
    }

    await consumeSecurityActionToken({
      token: input.securityActionToken,
      merchantId: input.merchantId,
      expectedPurpose: 'confirm_live_api_key_creation'
    });
  }

  return insertApiKey(input);
};

export const rotateSecureApiKey = async (input: {
  merchantId: string;
  apiKeyId: string;
  securityActionToken: string;
  ip?: string | null;
  userAgent?: string | null;
}) =>
  withTransaction(async client => {
    await consumeSecurityActionToken({
      token: input.securityActionToken,
      merchantId: input.merchantId,
      expectedPurpose: 'confirm_api_key_rotation',
      expectedResourceId: input.apiKeyId
    });

    const current = await client.query<{
      id: string;
      store_id: string;
      environment: 'test' | 'live';
      scopes: string[];
    }>(
      `
        SELECT
          ak.id,
          ak.store_id,
          ak.environment,
          ak.scopes
        FROM public.api_keys ak
        JOIN public.stores s ON s.id = ak.store_id
        WHERE ak.id = $1
          AND COALESCE(ak.merchant_id, s.merchant_id) = $2
          AND ak.status = 'active'
        FOR UPDATE
      `,
      [input.apiKeyId, input.merchantId]
    );

    if (!current.rows[0]) {
      throw new Error('API_KEY_NOT_FOUND');
    }

    const newKey = await insertApiKey({
      merchantId: input.merchantId,
      storeId: current.rows[0].store_id,
      environment: current.rows[0].environment,
      scopes: current.rows[0].scopes,
      rotatedFromId: input.apiKeyId,
      ip: input.ip,
      userAgent: input.userAgent
    });

    await client.query(
      `
        UPDATE public.api_keys
        SET status = 'revoked',
            revoked_at = now()
        WHERE id = $1
      `,
      [input.apiKeyId]
    );

    return newKey;
  });

export const revokeSecureApiKey = async (input: {
  merchantId: string;
  apiKeyId: string;
}): Promise<void> => {
  const result = await dbPool.query(
    `
      UPDATE public.api_keys ak
      SET status = 'revoked',
          revoked_at = now()
      FROM public.stores s
      WHERE ak.store_id = s.id
        AND ak.id = $1
        AND COALESCE(ak.merchant_id, s.merchant_id) = $2
        AND ak.status = 'active'
      RETURNING ak.id
    `,
    [input.apiKeyId, input.merchantId]
  );

  if (result.rowCount !== 1) {
    throw new Error('API_KEY_NOT_FOUND_OR_REVOKED');
  }
};
