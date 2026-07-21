import {
  PrismaClient
} from '@prisma/client';

const prisma =
  new PrismaClient();

const vaultIds = [
  '39ce9cff-ced2-4632-bef9-19402550736f',
  'de7c6f38-5df0-41ac-8409-847d85e31c96'
];

async function main() {
  const vaults =
    await prisma.gatewayVault.findMany({
      where: {
        id: {
          in: vaultIds
        }
      },

      include: {
        store: true
      }
    });

  for (const vault of vaults) {
    const credentials =
      vault.credentials as
        Record<string, unknown>;

    console.log({
      store:
        vault.store?.name,

      gatewayVaultId:
        vault.id,

      provider:
        vault.provider,

      active:
        vault.isActive,

      publicKeyConfigured:
        Boolean(
          credentials.publicKey
        ),

      secretKeyConfigured:
        Boolean(
          credentials.secretKey
        ),

      webhookSecretConfigured:
        Boolean(
          credentials.webhookSecret
        ),

      configurationStatus:
        credentials
          .configurationStatus
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
