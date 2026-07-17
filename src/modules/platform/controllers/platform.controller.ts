import { Response } from 'express';

import prisma from '../../../core/prisma';
import { AuthRequest } from '../../../middleware/auth.middleware';

type ModuleStatus =
  | 'available'
  | 'attention'
  | 'locked'
  | 'preview';

function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value
  ) {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isApproved(value: unknown): boolean {
  const normalized = String(value ?? '').toLowerCase();

  return (
    normalized === 'approved' ||
    normalized === 'verified' ||
    normalized === 'active'
  );
}

function moduleStatus(
  available: boolean,
  attention: boolean
): ModuleStatus {
  if (!available) {
    return 'locked';
  }

  if (attention) {
    return 'attention';
  }

  return 'available';
}

export const getBootstrap = async (
  req: AuthRequest,
  res: Response
) => {
  const merchantId = req.user?.id;

  if (!merchantId) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sessão não autenticada.'
      }
    });
  }

  try {
    const merchant = await prisma.merchant.findUnique({
      where: {
        id: merchantId
      },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
        tier: true,
        status: true,
        kycStatus: true,
        riskScore: true,
        createdAt: true
      }
    });

    if (!merchant) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'MERCHANT_NOT_FOUND',
          message: 'Conta não encontrada.'
        }
      });
    }

    const [
      stores,
      wallets,
      transactionCount,
      recentTransactions,
      gatewayCount
    ] = await Promise.all([
      prisma.store.findMany({
        where: {
          merchantId
        },
        orderBy: {
          createdAt: 'asc'
        },
        select: {
          id: true,
          storeCode: true,
          name: true,
          domain: true,
          status: true,
          currency: true,
          createdAt: true
        }
      }),

      prisma.wallet.findMany({
        where: {
          merchantId
        },
        orderBy: {
          currency: 'asc'
        },
        select: {
          id: true,
          currency: true,
          type: true,
          balance: true,
          available: true,
          reserved: true,
          createdAt: true
        }
      }),

      prisma.transaction.count({
        where: {
          merchantId
        }
      }),

      prisma.transaction.findMany({
        where: {
          merchantId
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 8,
        select: {
          id: true,
          reference: true,
          storeId: true,
          amount: true,
          currency: true,
          status: true,
          method: true,
          createdAt: true
        }
      }),

      prisma.gatewayVault.count({
        where: {
          merchantId
        }
      })
    ]);

    const storeIds = stores.map(store => store.id);

    const [apiKeyCount, webhookCount] =
      storeIds.length > 0
        ? await Promise.all([
            prisma.apiKey.count({
              where: {
                storeId: {
                  in: storeIds
                }
              }
            }),

            prisma.webhook.count({
              where: {
                storeId: {
                  in: storeIds
                }
              }
            })
          ])
        : [0, 0];

    const activeStores = stores.filter(store =>
      isApproved(store.status)
    ).length;

    const walletBalances = wallets.map(wallet => ({
      id: wallet.id,
      currency: wallet.currency,
      type: wallet.type,
      total: toNumber(wallet.balance),
      available: toNumber(wallet.available),
      reserved: toNumber(wallet.reserved)
    }));

    const kycApproved = isApproved(
      merchant.kycStatus
    );

    const onboardingSteps = [
      {
        id: 'account',
        label: 'Account created',
        completed: true,
        route: '/'
      },
      {
        id: 'business',
        label: 'Business information',
        completed: Boolean(
          merchant.company?.trim()
        ),
        route: '/settings/business'
      },
      {
        id: 'verification',
        label: 'Business verification',
        completed: kycApproved,
        route: '/risk/verification'
      },
      {
        id: 'store',
        label: 'Create a Store',
        completed: stores.length > 0,
        route: '/commerce/stores'
      },
      {
        id: 'provider',
        label: 'Configure a provider',
        completed: gatewayCount > 0,
        route: '/developers/providers'
      },
      {
        id: 'api-key',
        label: 'Create an API Key',
        completed: apiKeyCount > 0,
        route: '/developers/api-keys'
      },
      {
        id: 'first-payment',
        label: 'Complete a test payment',
        completed: transactionCount > 0,
        route: '/commerce/payments'
      }
    ];

    const completedSteps =
      onboardingSteps.filter(step => step.completed);

    const currentStep =
      onboardingSteps.find(step => !step.completed) ??
      null;

    const onboardingPercentage = Math.round(
      (
        completedSteps.length /
        onboardingSteps.length
      ) * 100
    );

    const modules = [
      {
        id: 'money',
        name: 'Money',
        subtitle: 'Accounts & Treasury',
        description:
          'Balances, deposits, FX, payouts, settlements and financial movements.',
        route: '/money',
        accent: 'emerald',
        status: moduleStatus(
          wallets.length > 0,
          wallets.length === 0
        ),
        attentionCount:
          wallets.length === 0 ? 1 : 0,
        kpis: [
          {
            label: 'Currencies',
            value: walletBalances.length
          },
          {
            label: 'Available balances',
            value: walletBalances.map(wallet => ({
              currency: wallet.currency,
              amount: wallet.available
            }))
          }
        ]
      },

      {
        id: 'commerce',
        name: 'Commerce',
        subtitle: 'Payments & Sales',
        description:
          'Payments, Stores, transactions, checkout, links, products and customers.',
        route: '/commerce',
        accent: 'violet',
        status: moduleStatus(
          true,
          stores.length === 0
        ),
        attentionCount:
          stores.length === 0 ? 1 : 0,
        kpis: [
          {
            label: 'Transactions',
            value: transactionCount
          },
          {
            label: 'Active Stores',
            value: activeStores
          }
        ]
      },

      {
        id: 'developers',
        name: 'Developers',
        subtitle: 'APIs & Integrations',
        description:
          'API Keys, Webhooks, Providers, Sandbox, Logs and Documentation.',
        route: '/developers',
        accent: 'amber',
        status: moduleStatus(
          true,
          apiKeyCount === 0 ||
            webhookCount === 0 ||
            gatewayCount === 0
        ),
        attentionCount: [
          apiKeyCount === 0,
          webhookCount === 0,
          gatewayCount === 0
        ].filter(Boolean).length,
        kpis: [
          {
            label: 'API Keys',
            value: apiKeyCount
          },
          {
            label: 'Providers',
            value: gatewayCount
          }
        ]
      },

      {
        id: 'risk',
        name: 'Risk & Compliance',
        subtitle: 'Verification & Monitoring',
        description:
          'Business verification, limits, reserves, disputes and monitoring.',
        route: '/risk',
        accent: 'rose',
        status: moduleStatus(
          true,
          !kycApproved
        ),
        attentionCount:
          kycApproved ? 0 : 1,
        kpis: [
          {
            label: 'Verification',
            value: merchant.kycStatus
          },
          {
            label: 'Risk score',
            value: toNumber(
              merchant.riskScore
            )
          }
        ]
      },

      {
        id: 'marketplace',
        name: 'Marketplace',
        subtitle: 'Services & Solutions',
        description:
          'Business formation, payment consulting, custom development, websites and applications.',
        route: '/marketplace',
        accent: 'indigo',
        status: 'preview' as ModuleStatus,
        attentionCount: 0,
        kpis: [
          {
            label: 'Services',
            value: 'Catalog opening soon'
          },
          {
            label: 'Projects',
            value: 0
          }
        ]
      },

      {
        id: 'insights',
        name: 'Insights',
        subtitle: 'Reports & Analytics',
        description:
          'Analytics, reconciliation, performance, reports and exports.',
        route: '/insights',
        accent: 'cyan',
        status: 'available' as ModuleStatus,
        attentionCount: 0,
        kpis: [
          {
            label: 'Transactions',
            value: transactionCount
          },
          {
            label: 'Stores',
            value: stores.length
          }
        ]
      }
    ];

    const quickActions = [
      {
        id: 'create-store',
        label: 'Create Store',
        route: '/commerce/stores',
        enabled: true
      },
      {
        id: 'create-api-key',
        label: 'Create API Key',
        route: '/developers/api-keys',
        enabled: stores.length > 0,
        disabledReason:
          stores.length > 0
            ? null
            : 'Create a Store first.'
      },
      {
        id: 'configure-provider',
        label: 'Configure Provider',
        route: '/developers/providers',
        enabled: stores.length > 0,
        disabledReason:
          stores.length > 0
            ? null
            : 'Create a Store first.'
      },
      {
        id: 'create-payment-link',
        label: 'Create Payment Link',
        route: '/commerce/links',
        enabled:
          stores.length > 0 &&
          gatewayCount > 0,
        disabledReason:
          stores.length === 0
            ? 'Create a Store first.'
            : gatewayCount === 0
              ? 'Configure a provider first.'
              : null
      },
      {
        id: 'explore-marketplace',
        label: 'Explore Services',
        route: '/marketplace/services',
        enabled: true
      }
    ];

    const alerts = [];

    if (!merchant.company?.trim()) {
      alerts.push({
        id: 'business-information',
        severity: 'warning',
        title: 'Business information required',
        description:
          'Complete your company information.',
        route: '/settings/business'
      });
    }

    if (!kycApproved) {
      alerts.push({
        id: 'business-verification',
        severity: 'warning',
        title: 'Business verification incomplete',
        description:
          'Complete verification to unlock additional capabilities.',
        route: '/risk/verification'
      });
    }

    if (stores.length === 0) {
      alerts.push({
        id: 'store-required',
        severity: 'info',
        title: 'Create your first Store',
        description:
          'A Store is required to start testing payments.',
        route: '/commerce/stores'
      });
    }

    if (
      stores.length > 0 &&
      gatewayCount === 0
    ) {
      alerts.push({
        id: 'provider-required',
        severity: 'warning',
        title: 'Payment provider not configured',
        description:
          'Connect a sandbox provider to process test payments.',
        route: '/developers/providers'
      });
    }

    return res.json({
      success: true,
      data: {
        product: {
          name:
            process.env.APP_NAME ||
            'XPAY.Expert',
          environment:
            process.env.APP_ENV ||
            'lab',
          version:
            process.env.APP_VERSION ||
            '4.0.0-lab'
        },

        organization: {
          id: merchant.id,
          legacyMerchantId: merchant.id,
          name:
            merchant.company ||
            merchant.name,
          legalName: merchant.company,
          contactName: merchant.name,
          email: merchant.email,
          tier: merchant.tier,
          status: merchant.status,
          verificationStatus:
            merchant.kycStatus,
          createdAt: merchant.createdAt
        },

        workspace: {
          selectedStoreId: 'all',
          stores: stores.map(store => ({
            id: store.id,
            code: store.storeCode,
            name: store.name,
            domain: store.domain,
            status: store.status,
            currency: store.currency,
            createdAt: store.createdAt
          }))
        },

        capabilities: {
          sandbox: true,
          liveMode: false,

          money: {
            access: wallets.length > 0,
            pixDeposits: false,
            sepaInstantDeposits: false,
            cryptoDeposits: false,
            fx: false,
            payouts: false,
            ledger: false
          },

          commerce: {
            access: true,
            stores: true,
            payments: true,
            paymentLinks:
              stores.length > 0,
            checkout:
              stores.length > 0
          },

          developers: {
            access: true,
            apiKeys: true,
            webhooks: true,
            providers: true,
            sandbox: true
          },

          marketplace: {
            access: true,
            ordering: false,
            projects: false
          }
        },

        onboarding: {
          percentage:
            onboardingPercentage,
          completed:
            onboardingPercentage === 100,
          currentStep,
          steps: onboardingSteps
        },

        balances: walletBalances,

        modules,

        quickActions,

        alerts,

        recentActivity:
          recentTransactions.map(
            transaction => ({
              id: transaction.id,
              type: 'payment',
              reference:
                transaction.reference,
              storeId:
                transaction.storeId,
              amount:
                toNumber(
                  transaction.amount
                ),
              currency:
                transaction.currency,
              status:
                transaction.status,
              method:
                transaction.method,
              createdAt:
                transaction.createdAt
            })
          ),

        systemStatus: {
          api: 'operational',
          database: 'operational',
          environment:
            process.env.APP_ENV ||
            'lab'
        }
      }
    });
  } catch (error) {
    console.error(
      '[PLATFORM_BOOTSTRAP_ERROR]',
      error
    );

    return res.status(500).json({
      success: false,
      error: {
        code: 'PLATFORM_BOOTSTRAP_FAILED',
        message:
          'Não foi possível carregar a plataforma.'
      }
    });
  }
};
