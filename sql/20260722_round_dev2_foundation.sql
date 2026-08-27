BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stable operational Merchant identity.
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS merchant_code text;

UPDATE public.merchants
SET merchant_code = 'MER-' || upper(substr(replace(id::text, '-', ''), 1, 12))
WHERE merchant_code IS NULL OR btrim(merchant_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS merchants_merchant_code_unique
  ON public.merchants (merchant_code)
  WHERE merchant_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.xpay_assign_merchant_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.merchant_code IS NULL
     OR btrim(NEW.merchant_code) = '' THEN
    NEW.merchant_code :=
      'MER-' ||
      upper(
        substr(
          replace(NEW.id::text, '-', ''),
          1,
          12
        )
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchants_assign_merchant_code
ON public.merchants;

CREATE TRIGGER merchants_assign_merchant_code
BEFORE INSERT ON public.merchants
FOR EACH ROW
EXECUTE FUNCTION public.xpay_assign_merchant_code();

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_required boolean NOT NULL DEFAULT false;

-- Historical snapshots for financial records.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_name_snapshot text,
  ADD COLUMN IF NOT EXISTS merchant_code_snapshot text,
  ADD COLUMN IF NOT EXISTS store_code_snapshot text,
  ADD COLUMN IF NOT EXISTS store_name_snapshot text;

UPDATE public.transactions t
SET merchant_name_snapshot = COALESCE(
      t.merchant_name_snapshot,
      (SELECT m.name FROM public.merchants m WHERE m.id = t.merchant_id)
    ),
    merchant_code_snapshot = COALESCE(
      t.merchant_code_snapshot,
      (SELECT m.merchant_code FROM public.merchants m WHERE m.id = t.merchant_id)
    ),
    store_code_snapshot = COALESCE(
      t.store_code_snapshot,
      (SELECT s.store_code FROM public.stores s WHERE s.id = t.store_id)
    ),
    store_name_snapshot = COALESCE(
      t.store_name_snapshot,
      (SELECT s.name FROM public.stores s WHERE s.id = t.store_id)
    );

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS merchant_name_snapshot text,
  ADD COLUMN IF NOT EXISTS merchant_code_snapshot text,
  ADD COLUMN IF NOT EXISTS store_code_snapshot text,
  ADD COLUMN IF NOT EXISTS store_name_snapshot text;

UPDATE public.wallet_movements wm
SET merchant_name_snapshot = COALESCE(
      wm.merchant_name_snapshot,
      (SELECT m.name FROM public.merchants m WHERE m.id = wm.merchant_id)
    ),
    merchant_code_snapshot = COALESCE(
      wm.merchant_code_snapshot,
      (SELECT m.merchant_code FROM public.merchants m WHERE m.id = wm.merchant_id)
    ),
    store_code_snapshot = COALESCE(
      wm.store_code_snapshot,
      (SELECT s.store_code FROM public.stores s WHERE s.id = wm.store_id)
    ),
    store_name_snapshot = COALESCE(
      wm.store_name_snapshot,
      (SELECT s.name FROM public.stores s WHERE s.id = wm.store_id)
    );

CREATE OR REPLACE FUNCTION public.xpay_fill_commerce_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT m.name, m.merchant_code
    INTO NEW.merchant_name_snapshot, NEW.merchant_code_snapshot
  FROM public.merchants m
  WHERE m.id = NEW.merchant_id;

  IF NEW.store_id IS NOT NULL THEN
    SELECT s.store_code, s.name
      INTO NEW.store_code_snapshot, NEW.store_name_snapshot
    FROM public.stores s
    WHERE s.id = NEW.store_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_fill_commerce_snapshots ON public.transactions;
CREATE TRIGGER transactions_fill_commerce_snapshots
BEFORE INSERT OR UPDATE OF merchant_id, store_id
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.xpay_fill_commerce_snapshots();

DROP TRIGGER IF EXISTS wallet_movements_fill_commerce_snapshots ON public.wallet_movements;
CREATE TRIGGER wallet_movements_fill_commerce_snapshots
BEFORE INSERT OR UPDATE OF merchant_id, store_id
ON public.wallet_movements
FOR EACH ROW
EXECUTE FUNCTION public.xpay_fill_commerce_snapshots();

-- Remove the duplicate Payout FK/index while preserving the canonical pair.
ALTER TABLE public.wallet_movements
  DROP CONSTRAINT IF EXISTS wallet_movements_merchant_payout_fk;
DROP INDEX IF EXISTS public.wallet_movements_merchant_payout_idx;

-- API Key v2 migration fields. Do not drop the current plaintext field yet.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS merchant_id uuid,
  ADD COLUMN IF NOT EXISTS key_prefix text,
  ADD COLUMN IF NOT EXISTS key_last_four text,
  ADD COLUMN IF NOT EXISTS key_hash text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '["payments:write","checkout:write"]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotated_from_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_ip inet,
  ADD COLUMN IF NOT EXISTS created_by_user_agent text;

UPDATE public.api_keys ak
SET merchant_id = s.merchant_id
FROM public.stores s
WHERE ak.store_id = s.id
  AND ak.merchant_id IS NULL;

CREATE INDEX IF NOT EXISTS api_keys_merchant_id_idx
  ON public.api_keys (merchant_id);
CREATE INDEX IF NOT EXISTS api_keys_store_status_idx
  ON public.api_keys (store_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique
  ON public.api_keys (key_hash)
  WHERE key_hash IS NOT NULL;

-- Generic six-digit email Security Challenges.
CREATE TABLE IF NOT EXISTS public.security_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  email text NOT NULL,
  purpose text NOT NULL,
  resource_type text,
  resource_id text,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  requested_ip inet,
  requested_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_challenges_status_check
    CHECK (status IN ('requested','verified','consumed','expired','locked','cancelled'))
);

CREATE INDEX IF NOT EXISTS security_challenges_merchant_purpose_idx
  ON public.security_challenges (merchant_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS security_challenges_expiry_idx
  ON public.security_challenges (expires_at)
  WHERE status IN ('requested','verified');

CREATE TABLE IF NOT EXISTS public.security_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL UNIQUE REFERENCES public.security_challenges(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  resource_type text,
  resource_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- New multi-channel outbox. Existing Telegram delivery table remains untouched.
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL,
  recipient text,
  template_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_channel_check
    CHECK (channel IN ('email','telegram','discord','whatsapp','merchant_webhook','in_app')),
  CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending','processing','retrying','sent','failed','dead_letter'))
);

CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON public.notification_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending','retrying');

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  telegram_enabled boolean NOT NULL DEFAULT false,
  merchant_webhook_enabled boolean NOT NULL DEFAULT true,
  in_app_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, event_type)
);

-- Lifecycle email events, without exposing secrets.

CREATE OR REPLACE FUNCTION public.xpay_enqueue_account_created_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.notification_outbox (
    merchant_id,
    event_type,
    channel,
    recipient,
    template_key,
    payload
  )
  VALUES (
    NEW.id,
    'account.created',
    'email',
    NEW.email,
    'account-created',
    jsonb_build_object(
      'merchantId', NEW.id,
      'merchantCode', NEW.merchant_code,
      'merchantName', NEW.name
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchants_enqueue_account_created_email
ON public.merchants;

CREATE TRIGGER merchants_enqueue_account_created_email
AFTER INSERT ON public.merchants
FOR EACH ROW
EXECUTE FUNCTION public.xpay_enqueue_account_created_email();

CREATE OR REPLACE FUNCTION public.xpay_enqueue_lifecycle_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event text;
  v_template text;
  v_merchant uuid;
  v_payload jsonb;
BEGIN
  IF TG_TABLE_NAME = 'stores' THEN
    v_event := 'store.created';
    v_template := 'store-created';
    v_merchant := NEW.merchant_id;
    v_payload := jsonb_build_object(
      'storeId', NEW.id,
      'storeCode', NEW.store_code,
      'storeName', NEW.name,
      'status', NEW.status,
      'currency', NEW.currency
    );
  ELSIF TG_TABLE_NAME = 'api_keys' THEN
    v_event := 'api_key.created';
    v_template := 'api-key-created';
    v_merchant := NEW.merchant_id;

    IF v_merchant IS NULL THEN
      SELECT s.merchant_id
      INTO v_merchant
      FROM public.stores s
      WHERE s.id = NEW.store_id;
    END IF;

    v_payload := jsonb_build_object(
      'apiKeyId', NEW.id,
      'storeId', NEW.store_id,
      'environment', NEW.environment,
      'keyPrefix', NEW.key_prefix,
      'keyLastFour', NEW.key_last_four
    );
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_outbox (
    merchant_id, event_type, channel, template_key, payload
  )
  VALUES (v_merchant, v_event, 'email', v_template, v_payload);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stores_enqueue_lifecycle_email ON public.stores;
CREATE TRIGGER stores_enqueue_lifecycle_email
AFTER INSERT ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.xpay_enqueue_lifecycle_email();

DROP TRIGGER IF EXISTS api_keys_enqueue_lifecycle_email ON public.api_keys;
CREATE TRIGGER api_keys_enqueue_lifecycle_email
AFTER INSERT ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.xpay_enqueue_lifecycle_email();


CREATE OR REPLACE FUNCTION public.xpay_enqueue_webhook_lifecycle_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_store_id uuid;
  v_merchant_id uuid;
BEGIN
  v_store_id := NULLIF(v_row->>'store_id', '')::uuid;

  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT merchant_id
  INTO v_merchant_id
  FROM public.stores
  WHERE id = v_store_id;

  INSERT INTO public.notification_outbox (
    merchant_id,
    event_type,
    channel,
    template_key,
    payload
  )
  VALUES (
    v_merchant_id,
    'webhook.created',
    'email',
    'webhook-created',
    jsonb_build_object(
      'webhookId', v_row->>'id',
      'storeId', v_store_id,
      'status', COALESCE(v_row->>'status', v_row->>'active')
    )
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.webhooks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS webhooks_enqueue_lifecycle_email ON public.webhooks';
    EXECUTE '
      CREATE TRIGGER webhooks_enqueue_lifecycle_email
      AFTER INSERT ON public.webhooks
      FOR EACH ROW
      EXECUTE FUNCTION public.xpay_enqueue_webhook_lifecycle_email()
    ';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.xpay_enqueue_payout_status_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_status text := v_new->>'status';
  v_old_status text := v_old->>'status';
BEGIN
  IF TG_OP = 'UPDATE' AND v_status IS NOT DISTINCT FROM v_old_status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_outbox (
    merchant_id,
    event_type,
    channel,
    template_key,
    payload
  )
  VALUES (
    (v_new->>'merchant_id')::uuid,
    'payout.' || COALESCE(v_status, 'updated'),
    'email',
    'payout-status',
    jsonb_build_object(
      'payoutId', v_new->>'id',
      'ticketCode', COALESCE(v_new->>'ticket_code', v_new->>'ticketCode'),
      'status', v_status,
      'sourceAmount', COALESCE(v_new->>'source_amount', v_new->>'sourceAmount'),
      'sourceCurrency', COALESCE(v_new->>'source_currency', v_new->>'sourceCurrency'),
      'payoutAmount', COALESCE(v_new->>'payout_amount', v_new->>'payoutAmount'),
      'payoutCurrency', COALESCE(v_new->>'payout_currency', v_new->>'payoutCurrency')
    )
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.merchant_payout_requests') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS merchant_payout_enqueue_status_email ON public.merchant_payout_requests';
    EXECUTE '
      CREATE TRIGGER merchant_payout_enqueue_status_email
      AFTER INSERT OR UPDATE OF status ON public.merchant_payout_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.xpay_enqueue_payout_status_email()
    ';
  END IF;
END;
$$;

-- Optional S2S idempotency storage.
CREATE TABLE IF NOT EXISTS public.api_idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_hash text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text,
  status text NOT NULL DEFAULT 'processing',
  response_status integer,
  response_body jsonb,
  locked_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_hash, idempotency_key),
  CONSTRAINT api_idempotency_status_check
    CHECK (status IN ('processing','completed','failed'))
);

-- Operational Supabase views.
CREATE OR REPLACE VIEW public.v_transactions_readable AS
SELECT
  t.id,
  COALESCE(t.merchant_code_snapshot, m.merchant_code) AS merchant_code,
  COALESCE(t.merchant_name_snapshot, m.name) AS merchant_name,
  COALESCE(t.store_code_snapshot, s.store_code) AS store_code,
  COALESCE(t.store_name_snapshot, s.name) AS store_name,
  t.reference,
  t.amount,
  t.currency,
  t.status,
  t.method,
  t.gateway,
  t.provider_id,
  t.customer,
  t.customer_email,
  t.fee,
  t.merchant_id,
  t.store_id,
  t.gateway_vault_id,
  t.created_at,
  t.metadata
FROM public.transactions t
JOIN public.merchants m ON m.id = t.merchant_id
LEFT JOIN public.stores s ON s.id = t.store_id;

CREATE OR REPLACE VIEW public.v_wallets_readable AS
SELECT
  w.id AS wallet_id,
  m.merchant_code,
  m.name AS merchant_name,
  m.email AS merchant_email,
  m.status AS merchant_status,
  w.currency,
  w.label,
  w.balance,
  w.available,
  w.reserved,
  w.type,
  w.merchant_id,
  w.created_at
FROM public.wallets w
JOIN public.merchants m ON m.id = w.merchant_id;

CREATE OR REPLACE VIEW public.v_wallet_movements_readable AS
SELECT
  wm.id,
  COALESCE(wm.merchant_code_snapshot, m.merchant_code) AS merchant_code,
  COALESCE(wm.merchant_name_snapshot, m.name) AS merchant_name,
  COALESCE(wm.store_code_snapshot, s.store_code) AS store_code,
  COALESCE(wm.store_name_snapshot, s.name) AS store_name,
  wm.type,
  wm.direction,
  wm.amount,
  wm.currency,
  wm.status,
  wm.bucket,
  wm.reference,
  t.reference AS transaction_reference,
  wm.settlement_batch_id,
  wm.merchant_payout_request_id,
  wm.idempotency_key,
  wm.wallet_id,
  wm.merchant_id,
  wm.store_id,
  wm.transaction_id,
  wm.created_at,
  wm.metadata
FROM public.wallet_movements wm
JOIN public.merchants m ON m.id = wm.merchant_id
LEFT JOIN public.stores s ON s.id = wm.store_id
LEFT JOIN public.transactions t ON t.id = wm.transaction_id;


DO $$
BEGIN
  IF to_regclass('public.merchant_payout_requests') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.v_merchant_payouts_readable AS
      SELECT
        m.merchant_code,
        m.name AS merchant_name,
        m.email AS merchant_email,
        p.*
      FROM public.merchant_payout_requests p
      JOIN public.merchants m ON m.id = p.merchant_id
    $view$;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.v_api_keys_readable AS
SELECT
  ak.id,
  m.merchant_code,
  m.name AS merchant_name,
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
  ak.store_id,
  COALESCE(ak.merchant_id, s.merchant_id) AS merchant_id,
  ak.created_at
FROM public.api_keys ak
JOIN public.stores s ON s.id = ak.store_id
JOIN public.merchants m ON m.id = COALESCE(ak.merchant_id, s.merchant_id);

-- Banking Core, separate from Commerce Settlement Wallet/Payout.
CREATE TABLE IF NOT EXISTS public.banking_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL UNIQUE REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'private_beta',
  provider text NOT NULL DEFAULT 'manual',
  provider_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banking_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banking_customer_id uuid NOT NULL REFERENCES public.banking_customers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  account_code text NOT NULL UNIQUE,
  currency text NOT NULL,
  account_type text NOT NULL DEFAULT 'business',
  status text NOT NULL DEFAULT 'pending_provisioning',
  provider text NOT NULL DEFAULT 'manual',
  provider_account_id text,
  iban_masked text,
  bank_name text,
  country text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banking_ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  banking_account_id uuid REFERENCES public.banking_accounts(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  currency text NOT NULL,
  account_class text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banking_ledger_account_class_check
    CHECK (account_class IN ('asset','liability','equity','revenue','expense','clearing'))
);

CREATE TABLE IF NOT EXISTS public.banking_ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE,
  transaction_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  idempotency_key text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT banking_ledger_transaction_status_check
    CHECK (status IN ('draft','posted','reversed','cancelled'))
);

CREATE TABLE IF NOT EXISTS public.banking_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id uuid NOT NULL REFERENCES public.banking_ledger_transactions(id) ON DELETE CASCADE,
  ledger_account_id uuid NOT NULL REFERENCES public.banking_ledger_accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.xpay_validate_banking_double_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_unbalanced_count integer;
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT count(*)
    INTO v_unbalanced_count
    FROM (
      SELECT e.currency
      FROM public.banking_ledger_entries e
      WHERE e.ledger_transaction_id = NEW.id
      GROUP BY e.currency
      HAVING
        SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE 0 END)
        <>
        SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE 0 END)
    ) unbalanced;

    IF v_unbalanced_count > 0 THEN
      RAISE EXCEPTION 'BANKING_LEDGER_UNBALANCED';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.banking_ledger_entries
      WHERE ledger_transaction_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'BANKING_LEDGER_EMPTY';
    END IF;

    NEW.posted_at := COALESCE(NEW.posted_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS banking_ledger_validate_double_entry
ON public.banking_ledger_transactions;

CREATE TRIGGER banking_ledger_validate_double_entry
BEFORE UPDATE OF status
ON public.banking_ledger_transactions
FOR EACH ROW
EXECUTE FUNCTION public.xpay_validate_banking_double_entry();

CREATE TABLE IF NOT EXISTS public.banking_beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  beneficiary_code text NOT NULL UNIQUE,
  beneficiary_type text NOT NULL,
  name text NOT NULL,
  country text,
  currency text,
  destination_encrypted text,
  destination_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_verification',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banking_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  source_account_id uuid NOT NULL REFERENCES public.banking_accounts(id) ON DELETE RESTRICT,
  beneficiary_id uuid NOT NULL REFERENCES public.banking_beneficiaries(id) ON DELETE RESTRICT,
  reference text NOT NULL UNIQUE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  idempotency_key text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key),
  CONSTRAINT banking_transfer_status_check
    CHECK (status IN (
      'draft','pending_confirmation','pending_review','approved',
      'submitted','processing','completed','failed','reversed','cancelled'
    ))
);

CREATE TABLE IF NOT EXISTS public.banking_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.banking_transfers(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  actor_type text NOT NULL DEFAULT 'merchant',
  actor_id uuid,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banking_fx_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  source_currency text NOT NULL,
  source_amount numeric(18,2) NOT NULL CHECK (source_amount > 0),
  target_currency text NOT NULL,
  target_amount numeric(18,2),
  rate numeric(24,10),
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banking_fx_quote_status_check
    CHECK (status IN ('pending','quoted','accepted','expired','rejected'))
);

CREATE TABLE IF NOT EXISTS public.banking_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  banking_account_id uuid NOT NULL REFERENCES public.banking_accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  file_url text,
  file_hash text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (banking_account_id, period_start, period_end)
);

CREATE OR REPLACE VIEW public.v_banking_account_balances AS
SELECT
  ba.id AS banking_account_id,
  ba.merchant_id,
  ba.account_code,
  ba.currency,
  ba.status,
  COALESCE(
    SUM(
      CASE
        WHEN lt.status <> 'posted' OR lt.status IS NULL THEN 0
        WHEN le.direction = 'credit' THEN le.amount
        WHEN le.direction = 'debit' THEN -le.amount
        ELSE 0
      END
    ),
    0
  )::numeric(18,2) AS ledger_balance
FROM public.banking_accounts ba
LEFT JOIN public.banking_ledger_accounts la
  ON la.banking_account_id = ba.id
LEFT JOIN public.banking_ledger_entries le
  ON le.ledger_account_id = la.id
LEFT JOIN public.banking_ledger_transactions lt
  ON lt.id = le.ledger_transaction_id
  AND lt.status = 'posted'
GROUP BY ba.id;

COMMIT;
