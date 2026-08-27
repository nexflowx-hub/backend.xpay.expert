# XPAY Round DEV-2

This is an additive pilot migration.

## Included

- Merchant operational codes.
- Transaction and wallet-movement snapshots.
- Supabase-readable views.
- Duplicate wallet-movement FK/index cleanup.
- Security Challenges with six-digit Resend email codes.
- One-time, Merchant-bound sensitive action tokens.
- Notification outbox, retry worker and dead-letter state.
- Store and API-key lifecycle email events.
- Secure API Key v2 create/list/rotate/revoke routes.
- Transitional API-key dual-write for S2S compatibility.
- Optional S2S Idempotency-Key middleware.
- Separate Banking Private Beta schema and APIs.
- Double-entry ledger posting invariant.

## Deliberate safeguards

- Banking remains disabled in Platform Capabilities.
- No automatic external Banking execution exists.
- No fake IBAN, card, transfer completion or balance is created.
- S2S Idempotency-Key remains optional until Merchant clients migrate.
- The legacy API-key plaintext field is not removed.
- Complete API keys are never emailed.
- Existing keys cannot be revealed; they must be rotated.
- Paid Merchant Payout remains separate and manual.

## Installation order

1. Copy the bundle into `/root/xpay-expert-backend`.
2. Review the SQL against the current schema.
3. Configure `RESEND_API_KEY` and a verified sender.
4. Run `scripts/install-round-dev2.sh`.
5. Run `scripts/apply-round-dev2-migration.sh`.
6. Keep `docker-compose.round-dev2.yml` beside the main Compose file.
7. Validate the merged Compose configuration.
8. Run `scripts/deploy-round-dev2.sh`.
9. Run `scripts/verify-round-dev2-db.sh`.
10. Test Security Challenges using a pilot Merchant.
11. Keep `XPAY_BANKING_ENABLED=false` until frontend and operations review pass.

## New routes

- `GET /api/v1/security/purposes`
- `POST /api/v1/security/challenges/request`
- `POST /api/v1/security/challenges/verify`

- `GET /api/v1/developer/api-keys`
- `POST /api/v1/developer/api-keys`
- `POST /api/v1/developer/api-keys/:id/rotate`
- `POST /api/v1/developer/api-keys/:id/revoke`

- `GET /api/v1/banking/capabilities`
- `GET /api/v1/banking/accounts`
- `GET /api/v1/banking/accounts/:id`
- `GET /api/v1/banking/accounts/:id/transactions`
- `GET /api/v1/banking/beneficiaries`
- `POST /api/v1/banking/beneficiaries`
- `GET /api/v1/banking/transfers`
- `POST /api/v1/banking/transfers`
- `GET /api/v1/banking/transfers/:id`
- `POST /api/v1/banking/transfers/:id/confirm`
- `POST /api/v1/banking/transfers/:id/cancel`
- `POST /api/v1/banking/fx-quotes`
- `GET /api/v1/banking/statements`

## Important API-key transition

The v2 controller currently dual-writes the complete key to the legacy `key`
column when that column exists. This prevents existing S2S validation from
breaking. The dashboard must never return that legacy value.

Final hash-only migration requires:

1. updating every S2S validator to compare `key_hash`;
2. maintaining a temporary legacy fallback;
3. rotating all active live keys;
4. removing the fallback;
5. nulling/dropping plaintext keys.
