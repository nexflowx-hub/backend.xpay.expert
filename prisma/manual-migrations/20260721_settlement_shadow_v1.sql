BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  provider text NOT NULL,

  provider_event_id text NOT NULL,

  gateway_vault_id uuid NOT NULL
    REFERENCES public.gateway_vaults(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  event_type text NOT NULL,

  livemode boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'processed',

  attempts integer NOT NULL DEFAULT 1,

  payload jsonb NULL,

  error_message text NULL,

  processed_at timestamptz NULL,

  created_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT provider_webhook_events_unique
    UNIQUE(provider, provider_event_id),

  CONSTRAINT provider_webhook_events_status_check
    CHECK (
      status IN (
        'processing',
        'processed',
        'ignored',
        'failed'
      )
    )
);

CREATE INDEX IF NOT EXISTS
  provider_webhook_events_vault_created_idx
ON public.provider_webhook_events(
  gateway_vault_id,
  created_at DESC
);

CREATE TABLE IF NOT EXISTS public.settlement_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  merchant_id uuid NOT NULL
    REFERENCES public.merchants(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  store_id uuid NOT NULL
    REFERENCES public.stores(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  gateway_vault_id uuid NOT NULL
    REFERENCES public.gateway_vaults(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  settlement_enabled boolean NOT NULL
    DEFAULT true,

  shadow_mode boolean NOT NULL
    DEFAULT true,

  provider_balance_sync_enabled boolean NOT NULL
    DEFAULT true,

  release_mode text NOT NULL
    DEFAULT 'manual',

  platform_fee_rate numeric(8,6) NOT NULL
    DEFAULT 0.010000,

  platform_fee_basis text NOT NULL
    DEFAULT 'gross',

  created_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT settlement_policies_scope_unique
    UNIQUE(
      merchant_id,
      store_id,
      gateway_vault_id
    ),

  CONSTRAINT settlement_policies_release_mode_check
    CHECK (
      release_mode IN (
        'manual',
        'automatic'
      )
    ),

  CONSTRAINT settlement_policies_fee_basis_check
    CHECK (
      platform_fee_basis IN (
        'gross',
        'provider_net'
      )
    ),

  CONSTRAINT settlement_policies_fee_rate_check
    CHECK (
      platform_fee_rate >= 0
      AND platform_fee_rate <= 1
    )
);

CREATE TABLE IF NOT EXISTS public.settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  merchant_id uuid NOT NULL
    REFERENCES public.merchants(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  store_id uuid NOT NULL
    REFERENCES public.stores(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  gateway_vault_id uuid NOT NULL
    REFERENCES public.gateway_vaults(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  wallet_id uuid NULL
    REFERENCES public.wallets(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  currency text NOT NULL,

  business_date date NOT NULL,

  status text NOT NULL
    DEFAULT 'pending_provider',

  transaction_count integer NOT NULL
    DEFAULT 0,

  gross_amount numeric(18,2) NOT NULL
    DEFAULT 0,

  provider_fee numeric(18,2) NOT NULL
    DEFAULT 0,

  platform_fee numeric(18,2) NOT NULL
    DEFAULT 0,

  merchant_net numeric(18,2) NOT NULL
    DEFAULT 0,

  provider_available_at timestamptz NULL,

  ready_at timestamptz NULL,

  released_at timestamptz NULL,

  released_by text NULL,

  hold_reason text NULL,

  metadata jsonb NULL,

  created_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT settlement_batches_scope_unique
    UNIQUE(
      merchant_id,
      store_id,
      gateway_vault_id,
      currency,
      business_date
    ),

  CONSTRAINT settlement_batches_status_check
    CHECK (
      status IN (
        'pending_provider',
        'pending_review',
        'held',
        'released',
        'reversed'
      )
    )
);

CREATE INDEX IF NOT EXISTS
  settlement_batches_merchant_status_idx
ON public.settlement_batches(
  merchant_id,
  status,
  business_date DESC
);

CREATE INDEX IF NOT EXISTS
  settlement_batches_store_date_idx
ON public.settlement_batches(
  store_id,
  business_date DESC
);

CREATE TABLE IF NOT EXISTS public.settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id uuid NOT NULL
    REFERENCES public.settlement_batches(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  transaction_id uuid NOT NULL
    REFERENCES public.transactions(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  merchant_id uuid NOT NULL
    REFERENCES public.merchants(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  store_id uuid NOT NULL
    REFERENCES public.stores(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  gateway_vault_id uuid NOT NULL
    REFERENCES public.gateway_vaults(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  wallet_id uuid NULL
    REFERENCES public.wallets(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  provider_charge_id text NULL,

  provider_balance_transaction_id text NULL,

  gross_amount numeric(18,2) NOT NULL,

  provider_fee numeric(18,2) NOT NULL
    DEFAULT 0,

  platform_fee numeric(18,2) NOT NULL
    DEFAULT 0,

  merchant_net numeric(18,2) NOT NULL,

  currency text NOT NULL,

  release_status text NOT NULL
    DEFAULT 'pending_provider',

  provider_available_at timestamptz NULL,

  ready_at timestamptz NULL,

  released_at timestamptz NULL,

  metadata jsonb NULL,

  created_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at timestamptz NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT settlement_items_transaction_unique
    UNIQUE(transaction_id),

  CONSTRAINT settlement_items_release_status_check
    CHECK (
      release_status IN (
        'pending_provider',
        'pending_review',
        'held',
        'released',
        'reversed'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  settlement_items_balance_transaction_unique
ON public.settlement_items(
  provider_balance_transaction_id
)
WHERE provider_balance_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  settlement_items_batch_idx
ON public.settlement_items(batch_id);

CREATE INDEX IF NOT EXISTS
  settlement_items_store_status_idx
ON public.settlement_items(
  store_id,
  release_status,
  created_at DESC
);

ALTER TABLE public.provider_webhook_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settlement_policies
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settlement_batches
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settlement_items
  ENABLE ROW LEVEL SECURITY;

COMMIT;
