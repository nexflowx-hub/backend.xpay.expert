CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ticket_code VARCHAR(48) NOT NULL UNIQUE,

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

    method VARCHAR(32) NOT NULL
        CHECK (
            method IN (
                'SEPA_INSTANT',
                'PIX',
                'USDT_TRC20',
                'USDT_ERC20',
                'MANUAL'
            )
        ),

    network VARCHAR(24),

    destination JSONB NOT NULL
        DEFAULT '{}'::jsonb,

    beneficiary_name TEXT,
    beneficiary_country VARCHAR(2),

    status VARCHAR(32) NOT NULL
        DEFAULT 'pending_review'
        CHECK (
            status IN (
                'pending_review',
                'approved',
                'fx_pending',
                'processing',
                'paid',
                'rejected',
                'cancelled'
            )
        ),

    fx_required BOOLEAN NOT NULL
        DEFAULT FALSE,

    fx_status VARCHAR(32) NOT NULL
        DEFAULT 'not_required'
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

    CONSTRAINT payout_requests_merchant_idempotency_unique
        UNIQUE (
            merchant_id,
            idempotency_key
        ),

    CONSTRAINT payout_requests_fx_values_check
        CHECK (
            (
                fx_required = FALSE
            )
            OR
            (
                fx_required = TRUE
                AND fx_status <> 'not_required'
            )
        )
);

CREATE INDEX IF NOT EXISTS payout_requests_merchant_created_idx
    ON payout_requests (
        merchant_id,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS payout_requests_status_created_idx
    ON payout_requests (
        status,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS payout_requests_wallet_idx
    ON payout_requests (
        wallet_id
    );

CREATE INDEX IF NOT EXISTS payout_requests_method_idx
    ON payout_requests (
        method
    );

CREATE TABLE IF NOT EXISTS payout_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    payout_request_id UUID NOT NULL
        REFERENCES payout_requests(id)
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

CREATE INDEX IF NOT EXISTS payout_events_request_created_idx
    ON payout_events (
        payout_request_id,
        created_at ASC
    );

CREATE INDEX IF NOT EXISTS payout_events_type_idx
    ON payout_events (
        event_type
    );

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    payout_request_id UUID
        REFERENCES payout_requests(id)
        ON DELETE CASCADE,

    event_type VARCHAR(64) NOT NULL,
    channel VARCHAR(32) NOT NULL,

    recipient TEXT,

    status VARCHAR(32) NOT NULL
        DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'delivered',
                'failed',
                'disabled',
                'skipped'
            )
        ),

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

CREATE INDEX IF NOT EXISTS notification_deliveries_payout_idx
    ON notification_deliveries (
        payout_request_id,
        created_at DESC
    );

CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx
    ON notification_deliveries (
        status,
        created_at DESC
    );

ALTER TABLE wallet_movements
    ADD COLUMN IF NOT EXISTS payout_request_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'wallet_movements_payout_request_fk'
    ) THEN
        ALTER TABLE wallet_movements
            ADD CONSTRAINT wallet_movements_payout_request_fk
            FOREIGN KEY (
                payout_request_id
            )
            REFERENCES payout_requests(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS wallet_movements_payout_request_idx
    ON wallet_movements (
        payout_request_id
    );

CREATE OR REPLACE FUNCTION update_payout_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_requests_updated_at_trigger
    ON payout_requests;

CREATE TRIGGER payout_requests_updated_at_trigger
BEFORE UPDATE ON payout_requests
FOR EACH ROW
EXECUTE FUNCTION update_payout_updated_at();

DROP TRIGGER IF EXISTS notification_deliveries_updated_at_trigger
    ON notification_deliveries;

CREATE TRIGGER notification_deliveries_updated_at_trigger
BEFORE UPDATE ON notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION update_payout_updated_at();
