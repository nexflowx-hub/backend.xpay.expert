import {
  Prisma,
  PrismaClient
} from '@prisma/client';

import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const XPAY_MASTER_ID =
  process.env.XPAY_MASTER_ID ??
  'c8c0387b-ea92-4c31-a5bb-739e6d61d262';

const TV_EMAIL =
  String(process.env.TV_EMAIL ?? '')
    .trim()
    .toLowerCase();

const TV_PASSWORD =
  String(process.env.TV_PASSWORD ?? '');

const SANDBOX_PUBLIC_KEY =
  String(
    process.env.SANDBOX_PUBLIC_KEY ?? ''
  ).trim();

const SANDBOX_SECRET_KEY =
  String(
    process.env.SANDBOX_SECRET_KEY ?? ''
  ).trim();

const AZORES_PUBLIC_KEY =
  String(
    process.env.AZORES_PUBLIC_KEY ?? ''
  ).trim();

const AZORES_SECRET_KEY =
  String(
    process.env.AZORES_SECRET_KEY ?? ''
  ).trim();

const outputFile =
  process.env.XPAY_BOOTSTRAP_OUTPUT ??
  `/root/xpay-secrets/pilot-${Date.now()}.json`;

const standardScopes = [
  'payments_write',
  'checkout_write',
  'catalog_read'
];

const initialRoutingRules = (
  provider: string
): Prisma.InputJsonValue => ({
  card: provider
});

const generateApiKey = (
  environment: 'test' | 'live'
): string => {
  const random =
    crypto
      .randomBytes(24)
      .toString('base64url');

  return `xp_${environment}_${random}`;
};

const mask = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  return (
    `${value.slice(0, 12)}` +
    `...${value.slice(-4)}`
  );
};

async function resolveMasterMerchant() {
  const merchant =
    await prisma.merchant.findFirst({
      where: {
        OR: [
          {
            id: XPAY_MASTER_ID
          },
          {
            email:
              'contact@xpay.expert'
          }
        ]
      }
    });

  if (!merchant) {
    throw new Error(
      'Merchant XPay-Master não encontrado.'
    );
  }

  await prisma.merchant.update({
    where: {
      id: merchant.id
    },
    data: {
      name: 'XPay-Master',
      company: 'XPay.Expert',
      status: 'active'
    }
  });

  return merchant;
}

async function resolveTvMerchant() {
  if (!TV_EMAIL) {
    throw new Error(
      'TV_EMAIL é obrigatório.'
    );
  }

  const existing =
    await prisma.merchant.findUnique({
      where: {
        email: TV_EMAIL
      }
    });

  if (existing) {
    return prisma.merchant.update({
      where: {
        id: existing.id
      },
      data: {
        name: 'TV-Business',
        company: 'TV-Business',
        status: 'active'
      }
    });
  }

  if (
    !TV_PASSWORD ||
    TV_PASSWORD.length < 10
  ) {
    throw new Error(
      'A password temporária do TV-Business deve ter pelo menos 10 caracteres.'
    );
  }

  const passwordHash =
    await bcrypt.hash(
      TV_PASSWORD,
      12
    );

  return prisma.merchant.create({
    data: {
      email: TV_EMAIL,
      name: 'TV-Business',
      company: 'TV-Business',
      tier: 'TIER_C_STANDARD',
      status: 'active',
      kycStatus: 'not_submitted',
      riskScore: 0,
      passwordHash
    }
  });
}

async function upsertStore(input: {
  merchantId: string;
  storeCode: string;
  name: string;
  domain: string | null;
  provider: string;
}) {
  const existing =
    await prisma.store.findUnique({
      where: {
        storeCode: input.storeCode
      }
    });

  if (
    existing &&
    existing.merchantId !==
      input.merchantId
  ) {
    throw new Error(
      `A Store ${input.storeCode} já pertence a outro Merchant.`
    );
  }

  if (existing) {
    return prisma.store.update({
      where: {
        id: existing.id
      },
      data: {
        name: input.name,
        domain: input.domain,
        status: 'active',
        currency: 'EUR',
        routingRules:
          initialRoutingRules(
            input.provider
          ),
        theme: 'light'
      }
    });
  }

  return prisma.store.create({
    data: {
      merchantId: input.merchantId,
      storeCode: input.storeCode,
      name: input.name,
      domain: input.domain,
      status: 'active',
      revenue: 0,
      currency: 'EUR',
      routingRules:
        initialRoutingRules(
          input.provider
        ),
      theme: 'light'
    }
  });
}

async function upsertGatewayVault(input: {
  merchantId: string;
  storeId: string;
  provider: string;
  accountId: string;
  publicKey: string;
  secretKey: string;
}) {
  const isConfigured =
    input.publicKey.startsWith('pk_') &&
    input.secretKey.startsWith('sk_');

  const credentials:
    Prisma.InputJsonValue = {
      accountId: input.accountId,

      publicKey:
        input.publicKey || null,

      secretKey:
        input.secretKey || null,

      configurationStatus:
        isConfigured
          ? 'pending_webhook'
          : 'pending_credentials',

      mode:
        input.secretKey.startsWith(
          'sk_live_'
        )
          ? 'live'
          : input.secretKey.startsWith(
              'sk_test_'
            )
            ? 'test'
            : 'unknown'
    };

  const existing =
    await prisma.gatewayVault.findFirst({
      where: {
        merchantId:
          input.merchantId,

        storeId:
          input.storeId,

        provider:
          input.provider
      }
    });

  if (existing) {
    return prisma.gatewayVault.update({
      where: {
        id: existing.id
      },
      data: {
        credentials,
        isActive: isConfigured
      }
    });
  }

  return prisma.gatewayVault.create({
    data: {
      merchantId:
        input.merchantId,

      storeId:
        input.storeId,

      provider:
        input.provider,

      credentials,

      isActive:
        isConfigured
    }
  });
}

async function upsertApiKey(input: {
  storeId: string;
  storeName: string;
}) {
  const name =
    `API Key - ${input.storeName} Test`;

  const existing =
    await prisma.apiKey.findFirst({
      where: {
        storeId:
          input.storeId,

        environment:
          'test',

        name
      }
    });

  if (existing) {
    return {
      apiKey: existing,
      created: false
    };
  }

  const apiKey =
    await prisma.apiKey.create({
      data: {
        storeId:
          input.storeId,

        name,

        key:
          generateApiKey('test'),

        scopes:
          standardScopes,

        environment:
          'test'
      }
    });

  return {
    apiKey,
    created: true
  };
}

async function ensureWallet(
  merchantId: string
) {
  return prisma.wallet.upsert({
    where: {
      merchantId_currency: {
        merchantId,
        currency: 'EUR'
      }
    },
    update: {},
    create: {
      merchantId,
      currency: 'EUR',
      label: 'EUR Wallet',
      balance: 0,
      available: 0,
      reserved: 0,
      type: 'fiat'
    }
  });
}

async function main() {
  const master =
    await resolveMasterMerchant();

  const tvMerchant =
    await resolveTvMerchant();

  const sandboxStore =
    await upsertStore({
      merchantId:
        master.id,

      storeCode:
        'XPAY-SANDBOX',

      name:
        'XPAY-Sandbox',

      domain:
        'sandbox.xpay.expert',

      provider:
        'stripe-sandbox'
    });

  const azoresStore =
    await upsertStore({
      merchantId:
        tvMerchant.id,

      storeCode:
        'AZORESBIO',

      name:
        'azores.bio',

      domain:
        'azores.bio',

      provider:
        'stripe-azores'
    });

  const sandboxVault =
    await upsertGatewayVault({
      merchantId:
        master.id,

      storeId:
        sandboxStore.id,

      provider:
        'stripe-sandbox',

      accountId:
        'STRIPE_SANDBOX',

      publicKey:
        SANDBOX_PUBLIC_KEY,

      secretKey:
        SANDBOX_SECRET_KEY
    });

  const azoresVault =
    await upsertGatewayVault({
      merchantId:
        tvMerchant.id,

      storeId:
        azoresStore.id,

      provider:
        'stripe-azores',

      accountId:
        'STRIPE_AZORES',

      publicKey:
        AZORES_PUBLIC_KEY,

      secretKey:
        AZORES_SECRET_KEY
    });

  const sandboxApiKey =
    await upsertApiKey({
      storeId:
        sandboxStore.id,

      storeName:
        sandboxStore.name
    });

  const azoresApiKey =
    await upsertApiKey({
      storeId:
        azoresStore.id,

      storeName:
        azoresStore.name
    });

  await ensureWallet(master.id);
  await ensureWallet(tvMerchant.id);

  const result = {
    createdAt:
      new Date().toISOString(),

    adminMerchant: {
      id:
        master.id,

      email:
        master.email,

      name:
        master.name
    },

    sandbox: {
      merchantId:
        master.id,

      storeId:
        sandboxStore.id,

      storeCode:
        sandboxStore.storeCode,

      storeName:
        sandboxStore.name,

      apiKeyId:
        sandboxApiKey.apiKey.id,

      apiKey:
        sandboxApiKey.apiKey.key,

      apiKeyCreated:
        sandboxApiKey.created,

      gatewayVaultId:
        sandboxVault.id,

      provider:
        sandboxVault.provider,

      vaultActive:
        sandboxVault.isActive,

      webhookUrl:
        (
          'https://api.xpay.expert' +
          '/api/v1/payments/webhooks/stripe/' +
          sandboxVault.id
        )
    },

    tvBusiness: {
      merchantId:
        tvMerchant.id,

      merchantEmail:
        tvMerchant.email,

      storeId:
        azoresStore.id,

      storeCode:
        azoresStore.storeCode,

      storeName:
        azoresStore.name,

      apiKeyId:
        azoresApiKey.apiKey.id,

      apiKey:
        azoresApiKey.apiKey.key,

      apiKeyCreated:
        azoresApiKey.created,

      gatewayVaultId:
        azoresVault.id,

      provider:
        azoresVault.provider,

      vaultActive:
        azoresVault.isActive,

      webhookUrl:
        (
          'https://api.xpay.expert' +
          '/api/v1/payments/webhooks/stripe/' +
          azoresVault.id
        )
    }
  };

  fs.mkdirSync(
    path.dirname(outputFile),
    {
      recursive: true,
      mode: 0o700
    }
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      result,
      null,
      2
    ),
    {
      mode: 0o600
    }
  );

  fs.chmodSync(
    outputFile,
    0o600
  );

  console.log(
    '\n========================================'
  );

  console.log(
    'XPAY PILOT BOOTSTRAP CONCLUÍDO'
  );

  console.log(
    '========================================'
  );

  console.log({
    adminMerchantId:
      master.id,

    sandboxStoreId:
      sandboxStore.id,

    sandboxGatewayVaultId:
      sandboxVault.id,

    sandboxApiKey:
      mask(
        sandboxApiKey.apiKey.key
      ),

    sandboxVaultActive:
      sandboxVault.isActive,

    tvMerchantId:
      tvMerchant.id,

    azoresStoreId:
      azoresStore.id,

    azoresGatewayVaultId:
      azoresVault.id,

    azoresApiKey:
      mask(
        azoresApiKey.apiKey.key
      ),

    azoresVaultActive:
      azoresVault.isActive,

    secretsFile:
      outputFile
  });

  console.log(
    '\nWebhook XPAY-Sandbox:'
  );

  console.log(
    result.sandbox.webhookUrl
  );

  console.log(
    '\nWebhook azores.bio:'
  );

  console.log(
    result.tvBusiness.webhookUrl
  );
}

main()
  .catch(error => {
    console.error(
      '\n❌ Bootstrap falhou:',
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
