CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. MIGRAÇÃO DE NOMES GENÉRICOS, CASO JÁ EXISTAM
-- =========================================================

DO $$
BEGIN
    IF to_regclass(
        'public.payout_requests'
    ) IS NOT NULL
    AND to_regclass(
        'public.merchant_payout_requests'
    ) IS NULL
    THEN
        ALTER TABLE payout_requests
            RENAME TO merchant_payout_requests;
    END IF;
END
$$;

DO $$
BEGIN
    IF to_regclass(
        'public.payout_events'
    ) IS NOT NULL
    AND to_regclass(
        'public.merchant_payout_events'
    ) IS NULL
    THEN
        ALTER TABLE payout_events
            RENAME TO merchant_payout_events;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name =
              'merchant_payout_events'
          AND column_name =
              'payout_request_id'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name =
              'merchant_payout_events'
          AND column_name =
              'merchant_payout_request_id'
    )
    THEN
        ALTER TABLE merchant_payout_events
            RENAME COLUMN payout_request_id
            TO merchant_payout_request_id;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name =
              'wallet_movements'
          AND column_name =
              'payout_request_id'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name =
              'wallet_movements'
          AND column_name =
              'merchant_payout_request_id'
    )
    THEN
        ALTER TABLE wallet_movements
            RENAME COLUMN payout_request_id
            TO merchant_payout_request_id;
    END IF;
END
$$;

-- =========================================================
-- 2. MERCHANT PAYOUT REQUESTS
-- =========================================================

CREATE TABLE IF NOT EXISTS merchant_payout_requests (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ledger_domain VARCHAR(32) NOT NULL
        DEFAULT 'merchant_settlement',

    ticket_code VARCHAR(48) NOT NULL
        UNIQUE,

    merchant_id UUID NOT NULL
        REFERENCES merchants(id)
        ON DELETE RESTRICT,

    wallet_id UUID NOT NULL
        REFERENCES wallets(id)
        ON DELETE RESTRICT,

    source_currency VARCHAR(12) NOT NULL,

    source_amount NUMERIC(18, 8) NOT NULL
        CHECK (source_amount > 0),

    payout_currency VARCHAR(12) NOT NULL,

    payout_amount NUMERIC(18, 8),

    method VARCHAR(32) NOT NULL,

    network VARCHAR(24),

    destination JSONB NOT NULL
        DEFAULT '{}'::jsonb,

    beneficiary_name TEXT,

    beneficiary_country VARCHAR(2),

    status VARCHAR(32) NOT NULL
        DEFAULT 'pending_review',

    fx_required BOOLEAN NOT NULL
        DEFAULT FALSE,

    fx_status VARCHAR(32) NOT NULL
        DEFAULT 'not_required',

    fx_rate NUMERIC(24, 12),

    fx_provider TEXT,

    fx_reference TEXT,

    review_note TEXT,

    rejection_reason TEXT,

    provider_reference TEXT,

    external_reference TEXT,

    requested_by UUID,

    approved_by UUID,

    rejected_by UUID,

    processing_by UUID,

    paid_by UUID,

    cancelled_by UUID,

    idempotency_key TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    approved_at TIMESTAMPTZ,

    rejected_at TIMESTAMPTZ,

    processing_at TIMESTAMPTZ,

    paid_at TIMESTAMPTZ,

    cancelled_at TIMESTAMPTZ,

    CONSTRAINT merchant_payout_domain_check
        CHECK (
            ledger_domain =
            'merchant_settlement'
        ),

    CONSTRAINT merchant_payout_method_check
        CHECK (
            method IN (
                'SEPA_INSTANT',
                'PIX',
                'USDT_TRC20',
                'USDT_ERC20',
                'MANUAL'
            )
        ),

    CONSTRAINT merchant_payout_status_check
        CHECK (
            status IN (
                'pending_review',
                'fx_pending',
                'approved',
                'processing',
                'paid',
                'rejected',
                'cancelled'
            )
        ),

    CONSTRAINT merchant_payout_fx_status_check
        CHECK (
            fx_status IN (
                'not_required',
                'pending_quote',
                'quoted',
                'accepted',
                'converted',
                'cancelled'
            )
        ),

    CONSTRAINT merchant_payout_idempotency_unique
        UNIQUE (
            merchant_id,
            idempotency_key
        )
);

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        ledger_domain VARCHAR(32)
        NOT NULL
        DEFAULT 'merchant_settlement';

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        requested_by UUID;

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        approved_by UUID;

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        rejected_by UUID;

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        processing_by UUID;

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        paid_by UUID;

ALTER TABLE merchant_payout_requests
    ADD COLUMN IF NOT EXISTS
        cancelled_by UUID;

CREATE INDEX IF NOT EXISTS
    merchant_payout_merchant_created_idx
ON merchant_payout_requests (
    merchant_id,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS
    merchant_payout_status_created_idx
ON merchant_payout_requests (
    status,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS
    merchant_payout_wallet_idx
ON merchant_payout_requests (
    wallet_id
);

CREATE INDEX IF NOT EXISTS
    merchant_payout_method_idx
ON merchant_payout_requests (
    method
);

-- =========================================================
-- 3. PAYOUT EVENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS merchant_payout_events (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    merchant_payout_request_id UUID NOT NULL
        REFERENCES merchant_payout_requests(id)
        ON DELETE CASCADE,

    event_type VARCHAR(64) NOT NULL,

    actor_type VARCHAR(32) NOT NULL
        DEFAULT 'system',

    actor_id UUID,

    from_status VARCHAR(32),

    to_status VARCHAR(32),

    payload JSONB NOT NULL
        DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
    merchant_payout_events_request_idx
ON merchant_payout_events (
    merchant_payout_request_id,
    created_at ASC
);

CREATE INDEX IF NOT EXISTS
    merchant_payout_events_type_idx
ON merchant_payout_events (
    event_type
);

-- =========================================================
-- 4. NOTIFICATION DELIVERIES GENÉRICA
-- =========================================================

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    subject_type VARCHAR(64),

    subject_id UUID,

    event_type VARCHAR(64) NOT NULL,

    channel VARCHAR(32) NOT NULL,

    recipient TEXT,

    data_scope VARCHAR(32) NOT NULL
        DEFAULT 'full',

    status VARCHAR(32) NOT NULL
        DEFAULT 'pending',

    attempts INTEGER NOT NULL
        DEFAULT 0,

    idempotency_key TEXT NOT NULL
        UNIQUE,

    provider_message_id TEXT,

    request_payload JSONB,

    response_payload JSONB,

    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    delivered_at TIMESTAMPTZ
);

ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS
        subject_type VARCHAR(64);

ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS
        subject_id UUID;

ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS
        data_scope VARCHAR(32)
        NOT NULL
        DEFAULT 'full';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name =
              'notification_deliveries'
          AND column_name =
              'payout_request_id'
    )
    THEN
        EXECUTE '
            UPDATE notification_deliveries
            SET
                subject_type =
                    COALESCE(
                        subject_type,
                        ''merchant_payout''
                    ),
                subject_id =
                    COALESCE(
                        subject_id,
                        payout_request_id
                    )
            WHERE payout_request_id
                  IS NOT NULL
        ';
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
    notification_subject_idx
ON notification_deliveries (
    subject_type,
    subject_id,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS
    notification_status_idx
ON notification_deliveries (
    status,
    created_at DESC
);

-- =========================================================
-- 5. WALLET MOVEMENT TRACEABILITY
-- =========================================================

ALTER TABLE wallet_movements
    ADD COLUMN IF NOT EXISTS
        merchant_payout_request_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'wallet_movements_merchant_payout_fk'
    )
    THEN
        ALTER TABLE wallet_movements
            ADD CONSTRAINT
                wallet_movements_merchant_payout_fk
            FOREIGN KEY (
                merchant_payout_request_id
            )
            REFERENCES merchant_payout_requests(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
    wallet_movements_merchant_payout_idx
ON wallet_movements (
    merchant_payout_request_id
);

-- =========================================================
-- 6. UPDATED_AT TRIGGERS
-- =========================================================

CREATE OR REPLACE FUNCTION
    xpay_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
    merchant_payout_updated_at_trigger
ON merchant_payout_requests;

CREATE TRIGGER
    merchant_payout_updated_at_trigger
BEFORE UPDATE
ON merchant_payout_requests
FOR EACH ROW
EXECUTE FUNCTION
    xpay_set_updated_at();

DROP TRIGGER IF EXISTS
    notification_delivery_updated_at_trigger
ON notification_deliveries;

CREATE TRIGGER
    notification_delivery_updated_at_trigger
BEFORE UPDATE
ON notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION
    xpay_set_updated_at();
