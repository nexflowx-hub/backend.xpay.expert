import {
  PrismaClient
} from '@prisma/client';

const prisma =
  new PrismaClient();

async function main() {
  const merchants =
    await prisma.merchant.findMany({
      where: {
        OR: [
          {
            id:
              'c8c0387b-ea92-4c31-a5bb-739e6d61d262'
          },
          {
            name:
              'TV-Business'
          }
        ]
      },

      include: {
        stores: {
          include: {
            apiKeys: true,
            gatewayVaults: true
          }
        },

        wallets: true
      }
    });

  for (
    const merchant of merchants
  ) {
    console.log(
      '\n========================================'
    );

    console.log({
      merchantId:
        merchant.id,

      name:
        merchant.name,

      email:
        merchant.email,

      company:
        merchant.company,

      status:
        merchant.status
    });

    console.log(
      'Wallets:',
      merchant.wallets.map(
        wallet => ({
          id:
            wallet.id,

          currency:
            wallet.currency,

          balance:
            Number(wallet.balance),

          available:
            Number(wallet.available),

          reserved:
            Number(wallet.reserved)
        })
      )
    );

    for (
      const store of merchant.stores
    ) {
      console.log(
        '\nStore:',
        {
          id:
            store.id,

          storeCode:
            store.storeCode,

          name:
            store.name,

          domain:
            store.domain,

          status:
            store.status,

          routingRules:
            store.routingRules
        }
      );

      console.log(
        'API Keys:',
        store.apiKeys.map(
          key => ({
            id:
              key.id,

            name:
              key.name,

            environment:
              key.environment,

            scopes:
              key.scopes,

            maskedKey:
              (
                `${key.key.slice(0, 12)}` +
                `...${key.key.slice(-4)}`
              )
          })
        )
      );

      console.log(
        'Gateway Vaults:',
        store.gatewayVaults.map(
          vault => ({
            id:
              vault.id,

            provider:
              vault.provider,

            isActive:
              vault.isActive,

            credentials:
              {
                accountId:
                  (
                    vault.credentials as any
                  )?.accountId,

                mode:
                  (
                    vault.credentials as any
                  )?.mode,

                configurationStatus:
                  (
                    vault.credentials as any
                  )?.configurationStatus,

                publicKeyConfigured:
                  Boolean(
                    (
                      vault.credentials as any
                    )?.publicKey
                  ),

                secretKeyConfigured:
                  Boolean(
                    (
                      vault.credentials as any
                    )?.secretKey
                  ),

                webhookSecretConfigured:
                  Boolean(
                    (
                      vault.credentials as any
                    )?.webhookSecret
                  )
              }
          })
        )
      );
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
