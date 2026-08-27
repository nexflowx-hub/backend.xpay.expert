INSERT INTO public.settlement_policies (
  merchant_id,
  store_id,
  gateway_vault_id,
  settlement_enabled,
  shadow_mode,
  provider_balance_sync_enabled,
  release_mode,
  platform_fee_rate,
  platform_fee_basis
)
VALUES
(
  'c8c0387b-ea92-4c31-a5bb-739e6d61d262'::uuid,
  '9c52e631-2af1-4579-b850-238b176403dd'::uuid,
  '39ce9cff-ced2-4632-bef9-19402550736f'::uuid,
  true,
  true,
  true,
  'manual',
  0.010000,
  'gross'
),
(
  (
    SELECT id
    FROM public.merchants
    WHERE name = 'TV-Business'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'cced8641-c881-435c-a293-d2dfc19703b7'::uuid,
  'de7c6f38-5df0-41ac-8409-847d85e31c96'::uuid,
  true,
  true,
  true,
  'manual',
  0.010000,
  'gross'
)
ON CONFLICT (
  merchant_id,
  store_id,
  gateway_vault_id
)
DO UPDATE SET
  settlement_enabled =
    EXCLUDED.settlement_enabled,

  shadow_mode =
    EXCLUDED.shadow_mode,

  provider_balance_sync_enabled =
    EXCLUDED.provider_balance_sync_enabled,

  release_mode =
    EXCLUDED.release_mode,

  platform_fee_rate =
    EXCLUDED.platform_fee_rate,

  platform_fee_basis =
    EXCLUDED.platform_fee_basis,

  updated_at =
    CURRENT_TIMESTAMP;
