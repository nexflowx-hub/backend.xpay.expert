import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const vaultId = String(process.argv[2] ?? '').trim();

  if (!vaultId) {
    throw new Error('Gateway Vault ID obrigatório.');
  }

  const vault = await prisma.gatewayVault.findUnique({
    where: { id: vaultId }
  });

  if (!vault) {
    throw new Error('Gateway Vault não encontrado.');
  }

  const credentials =
    vault.credentials &&
    typeof vault.credentials === 'object' &&
    !Array.isArray(vault.credentials)
      ? vault.credentials as Record<string, unknown>
      : {};

  await prisma.gatewayVault.update({
    where: { id: vault.id },
    data: {
      isActive: false,
      credentials: {
        ...credentials,
        webhookSecret: null,
        configurationStatus: 'pending_webhook'
      }
    }
  });

  console.log({
    success: true,
    gatewayVaultId: vault.id,
    provider: vault.provider,
    active: false,
    webhookSecretConfigured: false,
    configurationStatus: 'pending_webhook'
  });
}

main()
  .catch(error => {
    console.error({
      success: false,
      message: error.message
    });

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
