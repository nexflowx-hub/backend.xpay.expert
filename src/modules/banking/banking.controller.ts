import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { dbPool, withTransaction } from '../../lib/db-pool';
import { consumeSecurityActionToken } from '../security/security-challenge.service';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    merchantId?: string;
  };
  merchantId?: string;
};

const merchantIdFrom = (req: AuthenticatedRequest): string =>
  String(
    req.user?.id ??
    req.user?.merchantId ??
    req.merchantId ??
    ''
  ).trim();


const routeParam = (
  value: string | string[] | undefined
): string =>
  Array.isArray(value)
    ? String(value[0] ?? '')
    : String(value ?? '');

const toCamelKey = (
  key: string
): string =>
  key.replace(
    /_([a-z])/g,
    (_match, letter: string) =>
      letter.toUpperCase()
  );

const numericFields =
  new Set([
    'amount',
    'ledgerBalance',
    'sourceAmount',
    'targetAmount',
    'rate',
    'openingBalance',
    'closingBalance',
    'balance',
    'fxRate',
    'fxAmount'
  ]);

const normalizeDbPayload = (
  value: unknown,
  fieldName?: string
): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      normalizeDbPayload(item)
    );
  }

  if (
    value !== null &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<string, unknown>
      ).map(([key, item]) => {
        const camelKey =
          toCamelKey(key);

        return [
          camelKey,
          normalizeDbPayload(
            item,
            camelKey
          )
        ];
      })
    );
  }

  if (
    fieldName &&
    numericFields.has(fieldName) &&
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return value;
};

const ok = (
  res: Response,
  data: unknown,
  status = 200
): Response =>
  res.status(status).json({
    success: true,
    data:
      normalizeDbPayload(data)
  });

const fail = (res: Response, error: unknown): Response => {
  const code = error instanceof Error ? error.message : 'BANKING_UNKNOWN_ERROR';

  const status =
    code.includes('NOT_FOUND') ? 404 :
    code.includes('FORBIDDEN') ? 403 :
    code.includes('INVALID') ||
    code.includes('REQUIRED') ? 400 :
    code.includes('CONFLICT') ? 409 :
    500;

  return res.status(status).json({
    success: false,
    error: { code, message: code }
  });
};

export const getBankingCapabilities = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> =>
  ok(res, {
    merchantId: merchantIdFrom(req),
    status: 'private_beta',
    providerMode: 'manual',
    features: {
      accounts: true,
      balances: true,
      beneficiaries: true,
      transfers: true,
      fxQuotes: true,
      statements: true,
      cards: false,
      cryptoWithdrawals: false,
      automaticExternalExecution: false
    }
  });

export const listBankingAccounts = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT
          ba.*,
          COALESCE(vb.ledger_balance, 0) AS ledger_balance
        FROM public.banking_accounts ba
        LEFT JOIN public.v_banking_account_balances vb
          ON vb.banking_account_id = ba.id
        WHERE ba.merchant_id = $1
        ORDER BY ba.created_at DESC
      `,
      [merchantIdFrom(req)]
    );

    return ok(res, result.rows);
  } catch (error) {
    return fail(res, error);
  }
};

export const getBankingAccount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT
          ba.*,
          COALESCE(vb.ledger_balance, 0) AS ledger_balance
        FROM public.banking_accounts ba
        LEFT JOIN public.v_banking_account_balances vb
          ON vb.banking_account_id = ba.id
        WHERE ba.id = $1
          AND ba.merchant_id = $2
        LIMIT 1
      `,
      [req.params.id, merchantIdFrom(req)]
    );

    if (!result.rows[0]) {
      throw new Error('BANKING_ACCOUNT_NOT_FOUND');
    }

    return ok(res, result.rows[0]);
  } catch (error) {
    return fail(res, error);
  }
};

export const listBankingAccountTransactions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT
          lt.id,
          lt.reference,
          lt.transaction_type,
          lt.status,
          lt.description,
          lt.posted_at,
          lt.created_at,
          le.direction,
          le.amount,
          le.currency,
          la.code AS ledger_account_code,
          la.name AS ledger_account_name
        FROM public.banking_ledger_transactions lt
        JOIN public.banking_ledger_entries le
          ON le.ledger_transaction_id = lt.id
        JOIN public.banking_ledger_accounts la
          ON la.id = le.ledger_account_id
        WHERE lt.merchant_id = $1
          AND la.banking_account_id = $2
        ORDER BY lt.created_at DESC, le.created_at
        LIMIT 200
      `,
      [merchantIdFrom(req), req.params.id]
    );

    return ok(res, result.rows);
  } catch (error) {
    return fail(res, error);
  }
};

export const listBeneficiaries = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT
          id,
          beneficiary_code,
          beneficiary_type,
          name,
          country,
          currency,
          destination_masked,
          status,
          verified_at,
          created_at,
          updated_at
        FROM public.banking_beneficiaries
        WHERE merchant_id = $1
        ORDER BY created_at DESC
      `,
      [merchantIdFrom(req)]
    );

    return ok(res, result.rows);
  } catch (error) {
    return fail(res, error);
  }
};

export const createBeneficiary = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const merchantId = merchantIdFrom(req);
    const name = String(req.body?.name ?? '').trim();
    const beneficiaryType = String(req.body?.beneficiaryType ?? '').trim();

    if (!name || !beneficiaryType) {
      throw new Error('BANKING_BENEFICIARY_FIELDS_REQUIRED');
    }

    const beneficiaryCode =
      `BEN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    const result = await dbPool.query(
      `
        INSERT INTO public.banking_beneficiaries (
          merchant_id,
          beneficiary_code,
          beneficiary_type,
          name,
          country,
          currency,
          destination_masked
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        RETURNING
          id,
          beneficiary_code,
          beneficiary_type,
          name,
          country,
          currency,
          destination_masked,
          status,
          created_at
      `,
      [
        merchantId,
        beneficiaryCode,
        beneficiaryType,
        name,
        req.body?.country ?? null,
        req.body?.currency ?? null,
        JSON.stringify(req.body?.destinationMasked ?? {})
      ]
    );

    return ok(res, result.rows[0], 201);
  } catch (error) {
    return fail(res, error);
  }
};

export const listTransfers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT
          bt.*,
          bb.beneficiary_code,
          bb.name AS beneficiary_name,
          ba.account_code AS source_account_code
        FROM public.banking_transfers bt
        JOIN public.banking_beneficiaries bb
          ON bb.id = bt.beneficiary_id
        JOIN public.banking_accounts ba
          ON ba.id = bt.source_account_id
        WHERE bt.merchant_id = $1
        ORDER BY bt.created_at DESC
        LIMIT 200
      `,
      [merchantIdFrom(req)]
    );

    return ok(res, result.rows);
  } catch (error) {
    return fail(res, error);
  }
};

export const getTransfer = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const transfer = await dbPool.query(
      `
        SELECT
          bt.*,
          bb.beneficiary_code,
          bb.name AS beneficiary_name,
          bb.destination_masked,
          ba.account_code AS source_account_code
        FROM public.banking_transfers bt
        JOIN public.banking_beneficiaries bb
          ON bb.id = bt.beneficiary_id
        JOIN public.banking_accounts ba
          ON ba.id = bt.source_account_id
        WHERE bt.id = $1
          AND bt.merchant_id = $2
        LIMIT 1
      `,
      [req.params.id, merchantIdFrom(req)]
    );

    if (!transfer.rows[0]) {
      throw new Error('BANKING_TRANSFER_NOT_FOUND');
    }

    const events = await dbPool.query(
      `
        SELECT *
        FROM public.banking_transfer_events
        WHERE transfer_id = $1
        ORDER BY created_at
      `,
      [req.params.id]
    );

    return ok(res, {
      ...transfer.rows[0],
      events: events.rows
    });
  } catch (error) {
    return fail(res, error);
  }
};

export const createTransfer = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const merchantId = merchantIdFrom(req);
    const sourceAccountId = String(req.body?.sourceAccountId ?? '');
    const beneficiaryId = String(req.body?.beneficiaryId ?? '');
    const amount = Number(req.body?.amount);
    const currency = String(req.body?.currency ?? '').toUpperCase();
    const idempotencyKey = String(req.get('Idempotency-Key') ?? '').trim();

    if (
      !sourceAccountId ||
      !beneficiaryId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !currency
    ) {
      throw new Error('BANKING_TRANSFER_FIELDS_REQUIRED');
    }

    if (!idempotencyKey) {
      throw new Error('BANKING_TRANSFER_IDEMPOTENCY_REQUIRED');
    }

    const reference =
      `BT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-` +
      crypto.randomBytes(4).toString('hex').toUpperCase();

    const result = await withTransaction(async client => {
      const ownership = await client.query(
        `
          SELECT
            ba.id AS account_id,
            bb.id AS beneficiary_id
          FROM public.banking_accounts ba
          JOIN public.banking_beneficiaries bb
            ON bb.id = $2
           AND bb.merchant_id = $3
          WHERE ba.id = $1
            AND ba.merchant_id = $3
        `,
        [sourceAccountId, beneficiaryId, merchantId]
      );

      if (!ownership.rows[0]) {
        throw new Error('BANKING_TRANSFER_RESOURCE_NOT_FOUND');
      }

      const inserted = await client.query(
        `
          INSERT INTO public.banking_transfers (
            merchant_id,
            source_account_id,
            beneficiary_id,
            reference,
            amount,
            currency,
            status,
            idempotency_key,
            description
          )
          VALUES ($1,$2,$3,$4,$5,$6,'pending_confirmation',$7,$8)
          ON CONFLICT (merchant_id, idempotency_key)
          DO UPDATE SET updated_at = public.banking_transfers.updated_at
          RETURNING *
        `,
        [
          merchantId,
          sourceAccountId,
          beneficiaryId,
          reference,
          amount,
          currency,
          idempotencyKey,
          req.body?.description ?? null
        ]
      );

      await client.query(
        `
          INSERT INTO public.banking_transfer_events (
            transfer_id,
            merchant_id,
            event_type,
            new_status,
            actor_type,
            actor_id
          )
          VALUES ($1,$2,'created','pending_confirmation','merchant',$2)
        `,
        [inserted.rows[0].id, merchantId]
      );

      return inserted.rows[0];
    });

    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error);
  }
};

export const confirmTransfer = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const merchantId = merchantIdFrom(req);
    const actionToken = String(req.get('X-Security-Action') ?? '');

    if (!actionToken) {
      throw new Error('SECURITY_ACTION_TOKEN_REQUIRED');
    }

    await consumeSecurityActionToken({
      token: actionToken,
      merchantId,
      expectedPurpose: 'confirm_banking_transfer',
      expectedResourceId: routeParam(req.params.id)
    });

    const result = await withTransaction(async client => {
      const current = await client.query<{ status: string }>(
        `
          SELECT status
          FROM public.banking_transfers
          WHERE id = $1
            AND merchant_id = $2
          FOR UPDATE
        `,
        [req.params.id, merchantId]
      );

      if (!current.rows[0]) {
        throw new Error('BANKING_TRANSFER_NOT_FOUND');
      }

      if (current.rows[0].status !== 'pending_confirmation') {
        throw new Error('BANKING_TRANSFER_INVALID_TRANSITION');
      }

      const updated = await client.query(
        `
          UPDATE public.banking_transfers
          SET status = 'pending_review',
              confirmed_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [req.params.id]
      );

      await client.query(
        `
          INSERT INTO public.banking_transfer_events (
            transfer_id,
            merchant_id,
            event_type,
            previous_status,
            new_status,
            actor_type,
            actor_id
          )
          VALUES (
            $1,$2,'confirmed',
            'pending_confirmation','pending_review',
            'merchant',$2
          )
        `,
        [req.params.id, merchantId]
      );

      return updated.rows[0];
    });

    return ok(res, result);
  } catch (error) {
    return fail(res, error);
  }
};

export const cancelTransfer = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const merchantId = merchantIdFrom(req);

    const result = await dbPool.query(
      `
        UPDATE public.banking_transfers
        SET status = 'cancelled',
            cancelled_at = now(),
            updated_at = now()
        WHERE id = $1
          AND merchant_id = $2
          AND status IN ('draft','pending_confirmation','pending_review')
        RETURNING *
      `,
      [req.params.id, merchantId]
    );

    if (!result.rows[0]) {
      throw new Error('BANKING_TRANSFER_INVALID_TRANSITION_OR_NOT_FOUND');
    }

    await dbPool.query(
      `
        INSERT INTO public.banking_transfer_events (
          transfer_id,
          merchant_id,
          event_type,
          new_status,
          actor_type,
          actor_id,
          note
        )
        VALUES ($1,$2,'cancelled','cancelled','merchant',$2,$3)
      `,
      [req.params.id, merchantId, req.body?.reason ?? null]
    );

    return ok(res, result.rows[0]);
  } catch (error) {
    return fail(res, error);
  }
};

export const createFxQuote = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const sourceCurrency =
      String(req.body?.sourceCurrency ?? '').toUpperCase();
    const targetCurrency =
      String(req.body?.targetCurrency ?? '').toUpperCase();
    const sourceAmount = Number(req.body?.sourceAmount);

    if (
      !sourceCurrency ||
      !targetCurrency ||
      !Number.isFinite(sourceAmount) ||
      sourceAmount <= 0
    ) {
      throw new Error('BANKING_FX_FIELDS_REQUIRED');
    }

    const result = await dbPool.query(
      `
        INSERT INTO public.banking_fx_quotes (
          merchant_id,
          source_currency,
          source_amount,
          target_currency,
          status,
          provider
        )
        VALUES ($1,$2,$3,$4,'pending','manual')
        RETURNING *
      `,
      [
        merchantIdFrom(req),
        sourceCurrency,
        sourceAmount,
        targetCurrency
      ]
    );

    return ok(res, result.rows[0], 201);
  } catch (error) {
    return fail(res, error);
  }
};

export const listStatements = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const result = await dbPool.query(
      `
        SELECT *
        FROM public.banking_statements
        WHERE merchant_id = $1
        ORDER BY period_end DESC
      `,
      [merchantIdFrom(req)]
    );

    return ok(res, result.rows);
  } catch (error) {
    return fail(res, error);
  }
};
