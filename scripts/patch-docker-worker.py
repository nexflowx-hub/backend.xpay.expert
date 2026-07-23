from pathlib import Path

path = Path("docker-compose.yml")
text = path.read_text()

if "notification-worker:" in text:
    print("notification-worker already exists.")
    raise SystemExit(0)

service = r'''
  notification-worker:
    build: .
    command: node dist/modules/notifications/notification.worker.js
    env_file:
      - .env
    restart: unless-stopped
    depends_on:
      - xpay-expert-api
'''

# Append as another top-level service entry inside the existing services block.
# This assumes the project uses the standard `services:` structure.
if "services:" not in text:
    raise SystemExit("docker-compose.yml has no services section.")

text = text.rstrip() + "\n" + service.lstrip("\n")
path.write_text(text)
print("notification-worker appended. Validate with docker compose config.")
