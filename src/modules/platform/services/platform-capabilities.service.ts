export interface PlatformIdentity {
  id: string;
  email?: string | null;
  role?: string | null;
}

const booleanEnvironmentValue = (
  name: string,
  fallback: boolean
): boolean => {
  const value =
    process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return (
    value
      .trim()
      .toLowerCase() ===
    'true'
  );
};

const normalizedEnvironmentValue = (
  name: string,
  fallback: string
): string => {
  const value =
    String(
      process.env[name] ??
      fallback
    )
      .trim()
      .toLowerCase();

  return value || fallback;
};

const environmentIdSet = (
  name: string
): Set<string> =>
  new Set(
    String(
      process.env[name] ??
      ''
    )
      .split(',')
      .map(value =>
        value.trim()
      )
      .filter(Boolean)
  );

const normalizeRole = (
  role: string | null | undefined
): string =>
  String(role ?? '')
    .trim()
    .toLowerCase();

const isAdministrativeRole = (
  role: string
): boolean =>
  [
    'admin',
    'platform_admin',
    'platform-admin',
    'super_admin',
    'super-admin'
  ].includes(role);

export const isPlatformAdminIdentity = (
  identity: PlatformIdentity
): boolean => {
  const configuredAdminIds =
    environmentIdSet(
      'XPAY_ADMIN_MERCHANT_IDS'
    );

  const normalizedRole =
    normalizeRole(
      identity.role
    );

  return (
    configuredAdminIds.has(
      identity.id
    ) ||
    isAdministrativeRole(
      normalizedRole
    )
  );
};

export const getPlatformCapabilities = (
  identity: PlatformIdentity
) => {
  const isPlatformAdmin =
    isPlatformAdminIdentity(
      identity
    );

  const environment =
    normalizedEnvironmentValue(
      'XPAY_ENVIRONMENT',
      normalizedEnvironmentValue(
        'NODE_ENV',
        'pilot'
      )
    );

  const payoutExecutionAutomatic =
    booleanEnvironmentValue(
      'XPAY_PAYOUT_EXECUTION_AUTOMATIC_ENABLED',
      false
    );

  const payoutFxAutomatic =
    booleanEnvironmentValue(
      'XPAY_PAYOUT_FX_AUTOMATIC_ENABLED',
      false
    );

  const settlementReleaseMode =
    normalizedEnvironmentValue(
      'XPAY_SETTLEMENT_RELEASE_MODE',
      'manual'
    ) === 'automatic'
      ? 'automatic'
      : 'manual';

  const roles = [
    'merchant'
  ];

  if (isPlatformAdmin) {
    roles.push(
      'platform_admin'
    );
  }

  return {
    contract: {
      name:
        'XPAY.PlatformCapabilities',
      version:
        '1.0.0',
      commerceApi:
        'v1'
    },

    application: {
      name:
        'XPAY.Expert',
      version:
        String(
          process.env.XPAY_VERSION ??
          process.env.npm_package_version ??
          '4.0.0-lab'
        ),
      environment
    },

    identity: {
      merchantId:
        identity.id,
      email:
        identity.email ??
        null,
      roles,
      isPlatformAdmin
    },

    capabilities: {
      commerce:
        booleanEnvironmentValue(
          'XPAY_COMMERCE_ENABLED',
          true
        ),

      merchantPayouts:
        booleanEnvironmentValue(
          'XPAY_PAYOUTS_ENABLED',
          false
        ),

      settlements:
        booleanEnvironmentValue(
          'XPAY_SETTLEMENT_LEDGER_AUTHORITATIVE',
          false
        ),

      adminConsole:
        isPlatformAdmin,

      banking:
        booleanEnvironmentValue(
          'XPAY_BANKING_ENABLED',
          false
        ),

      advisory:
        booleanEnvironmentValue(
          'XPAY_ADVISORY_ENABLED',
          true
        ),

      advisoryCases:
        booleanEnvironmentValue(
          'XPAY_ADVISORY_CASES_ENABLED',
          false
        ),

      advisoryDocuments:
        booleanEnvironmentValue(
          'XPAY_ADVISORY_DOCUMENTS_ENABLED',
          false
        ),

      advisoryMessages:
        booleanEnvironmentValue(
          'XPAY_ADVISORY_MESSAGES_ENABLED',
          false
        )
    },

    operations: {
      payoutExecution:
        payoutExecutionAutomatic
          ? 'automatic'
          : 'manual',

      payoutFx:
        payoutFxAutomatic
          ? 'automatic'
          : 'manual',

      settlementRelease:
        settlementReleaseMode
    },

    controls: {
      kycGate:
        booleanEnvironmentValue(
          'XPAY_PAYOUT_KYC_GATE_ENABLED',
          false
        ),

      payoutLimits:
        booleanEnvironmentValue(
          'XPAY_PAYOUT_LIMITS_ENABLED',
          false
        ),

      destinationEncryption:
        booleanEnvironmentValue(
          'XPAY_PAYOUT_DESTINATION_ENCRYPTION_ENABLED',
          false
        ),

      fourEyesApproval:
        booleanEnvironmentValue(
          'XPAY_PAYOUT_FOUR_EYES_ENABLED',
          false
        )
    },

    notifications: {
      telegram:
        booleanEnvironmentValue(
          'XPAY_NOTIFICATIONS_TELEGRAM_ENABLED',
          false
        ),

      discord:
        booleanEnvironmentValue(
          'XPAY_NOTIFICATIONS_DISCORD_ENABLED',
          false
        ),

      email:
        booleanEnvironmentValue(
          'XPAY_NOTIFICATIONS_EMAIL_ENABLED',
          false
        ),

      whatsapp:
        booleanEnvironmentValue(
          'XPAY_NOTIFICATIONS_WHATSAPP_ENABLED',
          false
        )
    },

    generatedAt:
      new Date()
        .toISOString()
  };
};
