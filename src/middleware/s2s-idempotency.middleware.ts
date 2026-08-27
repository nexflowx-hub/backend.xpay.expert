import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { dbPool } from '../lib/db-pool';

const enabled = (): boolean =>
  String(process.env.XPAY_S2S_IDEMPOTENCY_ENABLED ?? 'true').toLowerCase() === 'true';

const required = (): boolean =>
  String(process.env.XPAY_S2S_IDEMPOTENCY_REQUIRED ?? 'false').toLowerCase() === 'true';

export const s2sIdempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!enabled() || req.method !== 'POST') {
    next();
    return;
  }

  const idempotencyKey = String(req.get('Idempotency-Key') ?? '').trim();

  if (!idempotencyKey) {
    if (required()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required.'
        }
      });
      return;
    }

    next();
    return;
  }

  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must contain between 8 and 200 characters.'
      }
    });
    return;
  }

  const credential = String(
    req.get('x-api-key') ??
    req.get('authorization') ??
    'anonymous'
  );

  const scopeHash = crypto
    .createHash('sha256')
    .update(`${req.method}:${req.baseUrl}${req.path}:${credential}`)
    .digest('hex');

  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(req.body ?? {}))
    .digest('hex');

  const existing = await dbPool.query<{
    status: string;
    request_hash: string | null;
    response_status: number | null;
    response_body: unknown;
  }>(
    `
      SELECT status, request_hash, response_status, response_body
      FROM public.api_idempotency_records
      WHERE scope_hash = $1
        AND idempotency_key = $2
      LIMIT 1
    `,
    [scopeHash, idempotencyKey]
  );

  const record = existing.rows[0];

  if (record) {
    if (record.request_hash && record.request_hash !== requestHash) {
      res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          message: 'The same Idempotency-Key was used with a different payload.'
        }
      });
      return;
    }

    if (record.status === 'completed') {
      res
        .status(record.response_status ?? 200)
        .json(record.response_body);
      return;
    }

    res.status(409).json({
      success: false,
      error: {
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        message: 'A request with this Idempotency-Key is already being processed.'
      }
    });
    return;
  }

  await dbPool.query(
    `
      INSERT INTO public.api_idempotency_records (
        scope_hash,
        idempotency_key,
        request_hash,
        locked_until
      )
      VALUES ($1,$2,$3,now() + interval '2 minutes')
    `,
    [scopeHash, idempotencyKey, requestHash]
  );

  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    void dbPool.query(
      `
        UPDATE public.api_idempotency_records
        SET status = 'completed',
            response_status = $3,
            response_body = $4::jsonb,
            completed_at = now(),
            updated_at = now()
        WHERE scope_hash = $1
          AND idempotency_key = $2
      `,
      [scopeHash, idempotencyKey, res.statusCode, JSON.stringify(body)]
    );

    return originalJson(body);
  }) as Response['json'];

  next();
};
