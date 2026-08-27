from pathlib import Path

path = Path("src/core/app.ts")
text = path.read_text()

imports = [
    "import securityChallengeRoutes from '../modules/security/security-challenge.routes';",
    "import developerApiKeyV2Routes from '../modules/security/developer-api-key.routes';",
    "import bankingRoutes from '../modules/banking/banking.routes';",
    "import { s2sIdempotencyMiddleware } from '../middleware/s2s-idempotency.middleware';",
    "import { payoutSecurityGate } from '../middleware/payout-security-gate.middleware';",
]

for import_line in imports:
    if import_line in text:
        continue

    lines = text.splitlines()
    insert_at = None

    for index, line in enumerate(lines):
        if line.startswith("const app") or line.startswith("export const app"):
            insert_at = index
            break

    if insert_at is None:
        raise SystemExit("Cannot locate the Express app declaration.")

    lines.insert(insert_at, import_line)
    text = "\n".join(lines) + "\n"

mounts = [
    "app.use('/api/v1/security', securityChallengeRoutes);",
    "app.use('/api/v1/developer/api-keys', developerApiKeyV2Routes);",
    "app.use('/api/v1/banking', bankingRoutes);",
]

for mount_line in mounts:
    if mount_line in text:
        continue

    lines = text.splitlines()
    insert_at = None

    for index, line in enumerate(lines):
        if "app.use" in line and "/api/v1/auth" in line:
            insert_at = index + 1

    if insert_at is None:
        raise SystemExit(f"Cannot locate a safe mount point for: {mount_line}")

    lines.insert(insert_at, mount_line)
    text = "\n".join(lines) + "\n"

idempotency_mount = (
    "app.use('/api/v1/payments/charge', s2sIdempotencyMiddleware);"
)

if idempotency_mount not in text:
    lines = text.splitlines()
    insert_at = None

    for index, line in enumerate(lines):
        if "app.use" in line and "/api/v1/payments" in line:
            insert_at = index
            break

    if insert_at is None:
        raise SystemExit("Cannot locate /api/v1/payments mount.")

    lines.insert(insert_at, idempotency_mount)
    text = "\n".join(lines) + "\n"


payout_gate_mount = (
    "app.use('/api/v1/merchant/payouts', payoutSecurityGate);"
)

if payout_gate_mount not in text:
    lines = text.splitlines()
    insert_at = None

    for index, line in enumerate(lines):
        if "app.use" in line and "/api/v1/merchant" in line:
            insert_at = index
            break

    if insert_at is None:
        # Mount before generic private routes when Merchant route is assembled elsewhere.
        for index, line in enumerate(lines):
            if "app.use" in line and "/api/v1" in line:
                insert_at = index
                break

    if insert_at is None:
        raise SystemExit("Cannot locate Merchant route mount.")

    lines.insert(insert_at, payout_gate_mount)
    text = "\n".join(lines) + "\n"

path.write_text(text)
print("Round DEV-2 routes mounted in src/core/app.ts")
