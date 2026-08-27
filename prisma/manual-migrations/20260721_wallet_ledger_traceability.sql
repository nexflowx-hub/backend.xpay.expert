BEGIN;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS transaction_id uuid NULL
    REFERENCES public.transactions(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS store_id uuid NULL
    REFERENCES public.stores(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS settlement_item_id uuid NULL
    REFERENCES public.settlement_items(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS settlement_batch_id uuid NULL
    REFERENCES public.settlement_batches(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS bucket text NULL;

ALTER TABLE public.wallet_movements
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  wallet_movements_idempotency_key_unique
ON public.wallet_movements(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  wallet_movements_transaction_idx
ON public.wallet_movements(transaction_id);

CREATE INDEX IF NOT EXISTS
  wallet_movements_settlement_batch_idx
ON public.wallet_movements(settlement_batch_id);

CREATE INDEX IF NOT EXISTS
  wallet_movements_store_created_idx
ON public.wallet_movements(
  store_id,
  created_at DESC
);

UPDATE public.wallet_movements
  AS movement

SET
  transaction_id =
    transaction.id,

  store_id =
    transaction.store_id

FROM public.transactions
  AS transaction

WHERE movement.transaction_id IS NULL
  AND movement.reference =
    transaction.id::text;

COMMIT;
