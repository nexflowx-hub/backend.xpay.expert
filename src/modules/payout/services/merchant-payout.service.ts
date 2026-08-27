import crypto from 'node:crypto';

import {
  Prisma
} from '@prisma/client';

import prisma from '../../../core/prisma';

export class MerchantPayoutError
  extends Error {
  public readonly statusCode:
    number;

  public readonly code:
    string;

  constructor(
    statusCode: number,
    code: string,
    message: string
  ) {
    super(message);

    this.name =
      'MerchantPayoutError';

    this.statusCode =
      statusCode;

    this.code =
      code;
  }
}

type RawPayout = {
  id: string;
  ledger_domain: string;
  ticket_code: string;
  merchant_id: string;
  merchant_name?: string | null;
  merchant_email?: string | null;
  wallet_id: string;
  source_currency: string;
  source_amount: unknown;
  payout_currency: string;
  payout_amount: unknown | null;
  method: string;
  network: string | null;
  destination:
    Record<string, unknown>;
  beneficiary_name: string | null;
  beneficiary_country: string | null;
  status: string;
  fx_required: boolean;
  fx_status: string;
  fx_rate: unknown | null;
  fx_provider: string | null;
  fx_reference: string | null;
  review_note: string | null;
  rejection_reason: string | null;
  provider_reference: string | null;
  external_reference: string | null;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
  approved_at: Date | null;
  rejected_at: Date | null;
  processing_at: Date | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
};

type RawWallet = {
  id: string;
  merchant_id: string;
  currency: string;
  balance: unknown;
  available: unknown;
  reserved: unknown;
};

const decimal = (
  value: unknown,
  field: string
): Prisma.Decimal => {
  try {
    const result =
      new Prisma.Decimal(
        String(value)
      );

    if (
      !result.isFinite() ||
      result.lte(0)
    ) {
      throw new Error();
    }

    if (
      result.decimalPlaces() >
      8
    ) {
      throw new Error();
    }

    return result;
  } catch {
    throw new MerchantPayoutError(
      400,
      'INVALID_AMOUNT',
      `${field} deve ser um valor positivo com até 8 casas decimais.`
    );
  }
};

const numberOrNull = (
  value: unknown
): number | null => {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return Number(
    String(value)
  );
};

const normalizeCurrency = (
  value: unknown
): string => {
  const currency =
    String(value ?? '')
      .trim()
      .toUpperCase();

  if (
    !/^[A-Z0-9]{3,12}$/.test(
      currency
    )
  ) {
    throw new MerchantPayoutError(
      400,
      'INVALID_CURRENCY',
      'Moeda inválida.'
    );
  }

  return currency;
};

const allowedMethods =
  new Set([
    'SEPA_INSTANT',
    'PIX',
    'USDT_TRC20',
    'USDT_ERC20',
    'MANUAL'
  ]);

const normalizeMethod = (
  value: unknown
): string => {
  const method =
    String(value ?? '')
      .trim()
      .toUpperCase();

  if (
    !allowedMethods.has(
      method
    )
  ) {
    throw new MerchantPayoutError(
      400,
      'INVALID_PAYOUT_METHOD',
      'Método de Payout inválido.'
    );
  }

  return method;
};

const objectValue = (
  value: unknown
): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new MerchantPayoutError(
      400,
      'INVALID_DESTINATION',
      'O destino do Payout é obrigatório.'
    );
  }

  return value as
    Record<string, unknown>;
};

const requiredDestinationField = (
  destination:
    Record<string, unknown>,
  field: string
): string => {
  const value =
    String(
      destination[field] ??
      ''
    ).trim();

  if (!value) {
    throw new MerchantPayoutError(
      400,
      'INVALID_DESTINATION',
      `Destino incompleto: ${field}.`
    );
  }

  return value;
};

const onlyDigits = (
  value: unknown
): string =>
  String(value ?? '')
    .replace(/\D/g, '');

const normalizeIban = (
  value: unknown
): string =>
  String(value ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();

const normalizeBic = (
  value: unknown
): string =>
  String(value ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();

const isValidIban = (
  value: string
): boolean => {
  const iban =
    normalizeIban(value);

  if (
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(
      iban
    )
  ) {
    return false;
  }

  const rearranged =
    iban.slice(4) +
    iban.slice(0, 4);

  let remainder = 0;

  for (const character of rearranged) {
    const encoded =
      /[A-Z]/.test(character)
        ? String(
            character.charCodeAt(0) -
            55
          )
        : character;

    for (const digit of encoded) {
      remainder =
        (
          remainder * 10 +
          Number(digit)
        ) % 97;
    }
  }

  return remainder === 1;
};

const isValidBic = (
  value: string
): boolean =>
  /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(
    normalizeBic(value)
  );

const allDigitsEqual = (
  value: string
): boolean =>
  /^(\d)\1+$/.test(value);

const calculateCpfDigit = (
  digits: number[],
  factor: number
): number => {
  let total = 0;

  for (const digit of digits) {
    total += digit * factor;
    factor -= 1;
  }

  const remainder =
    (total * 10) % 11;

  return remainder === 10
    ? 0
    : remainder;
};

const isValidCpf = (
  value: string
): boolean => {
  const cpf =
    onlyDigits(value);

  if (
    cpf.length !== 11 ||
    allDigitsEqual(cpf)
  ) {
    return false;
  }

  const digits =
    cpf
      .slice(0, 9)
      .split('')
      .map(Number);

  const firstDigit =
    calculateCpfDigit(
      digits,
      10
    );

  const secondDigit =
    calculateCpfDigit(
      [
        ...digits,
        firstDigit
      ],
      11
    );

  return (
    cpf ===
    `${digits.join('')}${firstDigit}${secondDigit}`
  );
};

const calculateCnpjDigit = (
  digits: number[],
  weights: number[]
): number => {
  const total =
    digits.reduce(
      (
        accumulator,
        digit,
        index
      ) =>
        accumulator +
        digit * weights[index],
      0
    );

  const remainder =
    total % 11;

  return remainder < 2
    ? 0
    : 11 - remainder;
};

const isValidCnpj = (
  value: string
): boolean => {
  const cnpj =
    onlyDigits(value);

  if (
    cnpj.length !== 14 ||
    allDigitsEqual(cnpj)
  ) {
    return false;
  }

  const base =
    cnpj
      .slice(0, 12)
      .split('')
      .map(Number);

  const firstDigit =
    calculateCnpjDigit(
      base,
      [
        5, 4, 3, 2,
        9, 8, 7, 6,
        5, 4, 3, 2
      ]
    );

  const secondDigit =
    calculateCnpjDigit(
      [
        ...base,
        firstDigit
      ],
      [
        6, 5, 4, 3,
        2, 9, 8, 7,
        6, 5, 4, 3,
        2
      ]
    );

  return (
    cnpj ===
    `${base.join('')}${firstDigit}${secondDigit}`
  );
};

const isValidEmail = (
  value: string
): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value
  );

const normalizePhone = (
  value: unknown
): string =>
  String(value ?? '')
    .trim()
    .replace(
      /[\s().-]/g,
      ''
    );

const isValidPhone = (
  value: string
): boolean =>
  /^\+[1-9][0-9]{7,14}$/.test(
    normalizePhone(value)
  );

const isValidPixEvp = (
  value: string
): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const isValidTrc20Address = (
  value: string
): boolean =>
  /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
    value
  );

const isValidErc20Address = (
  value: string
): boolean =>
  /^0x[a-fA-F0-9]{40}$/.test(
    value
  );

const validateDestination = (
  method: string,
  payoutCurrency: string,
  destination:
    Record<string, unknown>
): {
  network: string | null;
} => {
  if (
    method ===
    'SEPA_INSTANT'
  ) {
    if (
      payoutCurrency !==
      'EUR'
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_SEPA_CURRENCY',
        'SEPA Instant exige EUR.'
      );
    }

    const beneficiaryName =
      requiredDestinationField(
        destination,
        'beneficiaryName'
      );

    const iban =
      normalizeIban(
        requiredDestinationField(
          destination,
          'iban'
        )
      );

    if (!isValidIban(iban)) {
      throw new MerchantPayoutError(
        400,
        'INVALID_IBAN',
        'IBAN inválido.'
      );
    }

    const rawBic =
      String(
        destination.bic ??
        ''
      ).trim();

    const bic =
      rawBic
        ? normalizeBic(rawBic)
        : null;

    if (
      bic &&
      !isValidBic(bic)
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_BIC',
        'BIC/SWIFT inválido.'
      );
    }

    destination.beneficiaryName =
      beneficiaryName;

    destination.iban =
      iban;

    if (bic) {
      destination.bic =
        bic;
    }

    destination.network =
      'SEPA_INSTANT';

    return {
      network:
        'SEPA_INSTANT'
    };
  }

  if (method === 'PIX') {
    if (
      payoutCurrency !==
      'BRL'
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_PIX_CURRENCY',
        'PIX exige BRL.'
      );
    }

    const beneficiaryName =
      requiredDestinationField(
        destination,
        'beneficiaryName'
      );

    const keyType =
      requiredDestinationField(
        destination,
        'keyType'
      ).toUpperCase();

    const allowedPixTypes =
      new Set([
        'CPF',
        'CNPJ',
        'EMAIL',
        'PHONE',
        'EVP'
      ]);

    if (
      !allowedPixTypes.has(
        keyType
      )
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_PIX_KEY_TYPE',
        'Tipo de chave PIX inválido.'
      );
    }

    const rawKeyValue =
      requiredDestinationField(
        destination,
        'keyValue'
      );

    let keyValue =
      rawKeyValue;

    if (keyType === 'CPF') {
      keyValue =
        onlyDigits(
          rawKeyValue
        );

      if (
        !isValidCpf(
          keyValue
        )
      ) {
        throw new MerchantPayoutError(
          400,
          'INVALID_PIX_CPF',
          'CPF utilizado como chave PIX é inválido.'
        );
      }
    }

    if (keyType === 'CNPJ') {
      keyValue =
        onlyDigits(
          rawKeyValue
        );

      if (
        !isValidCnpj(
          keyValue
        )
      ) {
        throw new MerchantPayoutError(
          400,
          'INVALID_PIX_CNPJ',
          'CNPJ utilizado como chave PIX é inválido.'
        );
      }
    }

    if (keyType === 'EMAIL') {
      keyValue =
        rawKeyValue
          .trim()
          .toLowerCase();

      if (
        !isValidEmail(
          keyValue
        )
      ) {
        throw new MerchantPayoutError(
          400,
          'INVALID_PIX_EMAIL',
          'Email utilizado como chave PIX é inválido.'
        );
      }
    }

    if (keyType === 'PHONE') {
      keyValue =
        normalizePhone(
          rawKeyValue
        );

      if (
        !isValidPhone(
          keyValue
        )
      ) {
        throw new MerchantPayoutError(
          400,
          'INVALID_PIX_PHONE',
          'Telefone PIX deve utilizar formato internacional, por exemplo +5511999999999.'
        );
      }
    }

    if (keyType === 'EVP') {
      keyValue =
        rawKeyValue
          .trim()
          .toLowerCase();

      if (
        !isValidPixEvp(
          keyValue
        )
      ) {
        throw new MerchantPayoutError(
          400,
          'INVALID_PIX_EVP',
          'Chave PIX aleatória EVP inválida.'
        );
      }
    }

    destination.beneficiaryName =
      beneficiaryName;

    destination.keyType =
      keyType;

    destination.keyValue =
      keyValue;

    destination.network =
      'PIX';

    return {
      network: 'PIX'
    };
  }

  if (
    method ===
    'USDT_TRC20'
  ) {
    if (
      payoutCurrency !==
      'USDT'
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_USDT_CURRENCY',
        'USDT TRC20 exige USDT.'
      );
    }

    const walletAddress =
      requiredDestinationField(
        destination,
        'walletAddress'
      );

    if (
      !isValidTrc20Address(
        walletAddress
      )
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_TRC20_ADDRESS',
        'Endereço USDT TRC20 inválido.'
      );
    }

    destination.walletAddress =
      walletAddress;

    destination.network =
      'TRC20';

    return {
      network: 'TRC20'
    };
  }

  if (
    method ===
    'USDT_ERC20'
  ) {
    if (
      payoutCurrency !==
      'USDT'
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_USDT_CURRENCY',
        'USDT ERC20 exige USDT.'
      );
    }

    const walletAddress =
      requiredDestinationField(
        destination,
        'walletAddress'
      );

    if (
      !isValidErc20Address(
        walletAddress
      )
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_ERC20_ADDRESS',
        'Endereço USDT ERC20 inválido.'
      );
    }

    destination.walletAddress =
      walletAddress;

    destination.network =
      'ERC20';

    return {
      network: 'ERC20'
    };
  }

  const instructions =
    requiredDestinationField(
      destination,
      'instructions'
    );

  destination.instructions =
    instructions;

  const network =
    String(
      destination.network ??
      ''
    ).trim() ||
    null;

  return {
    network
  };
};

const ticketCode = (): string => {
  const date =
    new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '');

  const suffix =
    crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase();

  return `MP-${date}-${suffix}`;
};

const serialize = (
  row: RawPayout
) => ({
  id: row.id,
  ledgerDomain:
    row.ledger_domain,
  ticketCode:
    row.ticket_code,
  merchantId:
    row.merchant_id,
  merchantName:
    row.merchant_name ??
    null,
  merchantEmail:
    row.merchant_email ??
    null,
  walletId:
    row.wallet_id,
  sourceCurrency:
    row.source_currency,
  sourceAmount:
    Number(
      String(
        row.source_amount
      )
    ),
  payoutCurrency:
    row.payout_currency,
  payoutAmount:
    numberOrNull(
      row.payout_amount
    ),
  method:
    row.method,
  network:
    row.network,
  destination:
    row.destination ?? {},
  beneficiaryName:
    row.beneficiary_name,
  beneficiaryCountry:
    row.beneficiary_country,
  status:
    row.status,
  fxRequired:
    row.fx_required,
  fxStatus:
    row.fx_status,
  fxRate:
    numberOrNull(
      row.fx_rate
    ),
  fxProvider:
    row.fx_provider,
  fxReference:
    row.fx_reference,
  reviewNote:
    row.review_note,
  rejectionReason:
    row.rejection_reason,
  providerReference:
    row.provider_reference,
  externalReference:
    row.external_reference,
  idempotencyKey:
    row.idempotency_key,
  createdAt:
    row.created_at,
  updatedAt:
    row.updated_at,
  approvedAt:
    row.approved_at,
  rejectedAt:
    row.rejected_at,
  processingAt:
    row.processing_at,
  paidAt:
    row.paid_at,
  cancelledAt:
    row.cancelled_at
});

const enrichedSelect = `
  SELECT
    p.*,
    m.name AS merchant_name,
    m.email AS merchant_email
  FROM merchant_payout_requests p
  INNER JOIN merchants m
    ON m.id = p.merchant_id
`;

const getRawById = async (
  id: string,
  merchantId?: string
): Promise<RawPayout> => {
  const rows =
    merchantId
      ? await prisma
          .$queryRawUnsafe<
            RawPayout[]
          >(
            `
              ${enrichedSelect}
              WHERE p.id = $1::uuid
                AND p.merchant_id =
                    $2::uuid
              LIMIT 1
            `,
            id,
            merchantId
          )
      : await prisma
          .$queryRawUnsafe<
            RawPayout[]
          >(
            `
              ${enrichedSelect}
              WHERE p.id = $1::uuid
              LIMIT 1
            `,
            id
          );

  if (!rows[0]) {
    throw new MerchantPayoutError(
      404,
      'MERCHANT_PAYOUT_NOT_FOUND',
      'Merchant Payout não encontrado.'
    );
  }

  return rows[0];
};

const insertEvent = async (
  transaction:
    Prisma.TransactionClient,
  payoutId: string,
  eventType: string,
  actorType: string,
  actorId: string | null,
  fromStatus: string | null,
  toStatus: string | null,
  payload: unknown
): Promise<void> => {
  await transaction
    .$executeRawUnsafe(
      `
        INSERT INTO merchant_payout_events (
          id,
          merchant_payout_request_id,
          event_type,
          actor_type,
          actor_id,
          from_status,
          to_status,
          payload,
          created_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::uuid,
          $6,
          $7,
          $8::jsonb,
          NOW()
        )
      `,
      crypto.randomUUID(),
      payoutId,
      eventType,
      actorType,
      actorId,
      fromStatus,
      toStatus,
      JSON.stringify(
        payload ?? {}
      )
    );
};

const insertMovement = async (
  transaction:
    Prisma.TransactionClient,
  options: {
    payoutId: string;
    walletId: string;
    merchantId: string;
    currency: string;
    amount: Prisma.Decimal;
    type: string;
    direction: string;
    reference: string;
    bucket: string;
    idempotencyKey: string;
    metadata: unknown;
  }
): Promise<void> => {
  await transaction
    .$executeRawUnsafe(
      `
        INSERT INTO wallet_movements (
          id,
          wallet_id,
          merchant_id,
          currency,
          type,
          direction,
          amount,
          status,
          reference,
          metadata,
          merchant_payout_request_id,
          bucket,
          idempotency_key,
          created_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6,
          $7::numeric,
          'completed',
          $8,
          $9::jsonb,
          $10::uuid,
          $11,
          $12,
          NOW()
        )
        ON CONFLICT DO NOTHING
      `,
      crypto.randomUUID(),
      options.walletId,
      options.merchantId,
      options.currency,
      options.type,
      options.direction,
      options.amount,
      options.reference,
      JSON.stringify(
        options.metadata ?? {}
      ),
      options.payoutId,
      options.bucket,
      options.idempotencyKey
    );
};

export const validateMerchantPayoutRequest =
  async (
    merchantId: string,
    input: {
      walletId: unknown;
      amount: unknown;
      payoutCurrency: unknown;
      method: unknown;
      destination: unknown;
      beneficiaryName?: unknown;
      beneficiaryCountry?: unknown;
    }
  ) => {
    const walletId =
      String(
        input.walletId ??
        ''
      ).trim();

    if (!walletId) {
      throw new MerchantPayoutError(
        400,
        'WALLET_REQUIRED',
        'Wallet obrigatória.'
      );
    }

    const sourceAmount =
      decimal(
        input.amount,
        'amount'
      );

    const payoutCurrency =
      normalizeCurrency(
        input.payoutCurrency
      );

    const method =
      normalizeMethod(
        input.method
      );

    const destination =
      objectValue(
        structuredClone(
          input.destination
        )
      );

    const {
      network
    } =
      validateDestination(
        method,
        payoutCurrency,
        destination
      );

    const wallets =
      await prisma
        .$queryRawUnsafe<
          RawWallet[]
        >(
          `
            SELECT
              id,
              merchant_id,
              currency,
              balance,
              available,
              reserved
            FROM wallets
            WHERE id = $1::uuid
              AND merchant_id =
                  $2::uuid
            LIMIT 1
          `,
          walletId,
          merchantId
        );

    const wallet =
      wallets[0];

    if (!wallet) {
      throw new MerchantPayoutError(
        404,
        'MERCHANT_WALLET_NOT_FOUND',
        'Merchant Wallet não encontrada.'
      );
    }

    const available =
      new Prisma.Decimal(
        String(
          wallet.available ??
          0
        )
      );

    if (
      available.lt(
        sourceAmount
      )
    ) {
      throw new MerchantPayoutError(
        409,
        'INSUFFICIENT_AVAILABLE_BALANCE',
        'Saldo disponível insuficiente.'
      );
    }

    const sourceCurrency =
      normalizeCurrency(
        wallet.currency
      );

    const fxRequired =
      sourceCurrency !==
      payoutCurrency;

    const beneficiaryName =
      String(
        input.beneficiaryName ??
        destination
          .beneficiaryName ??
        ''
      ).trim() ||
      null;

    const beneficiaryCountry =
      String(
        input.beneficiaryCountry ??
        destination.country ??
        ''
      )
        .trim()
        .toUpperCase()
        .slice(0, 2) ||
      null;

    return {
      valid: true,
      ledgerDomain:
        'merchant_settlement',
      executionMode:
        'manual',
      fxMode:
        'manual',
      wallet: {
        id:
          wallet.id,
        currency:
          sourceCurrency,
        balance:
          Number(
            String(
              wallet.balance ??
              0
            )
          ),
        available:
          Number(
            available.toString()
          ),
        reserved:
          Number(
            String(
              wallet.reserved ??
              0
            )
          ),
        availableAfterReservation:
          Number(
            available
              .minus(
                sourceAmount
              )
              .toString()
          )
      },
      request: {
        sourceCurrency,
        sourceAmount:
          Number(
            sourceAmount.toString()
          ),
        payoutCurrency,
        payoutAmount:
          fxRequired
            ? null
            : Number(
                sourceAmount.toString()
              ),
        method,
        network,
        beneficiaryName,
        beneficiaryCountry,
        destination,
        fxRequired,
        fxStatus:
          fxRequired
            ? 'pending_quote'
            : 'not_required',
        initialStatus:
          fxRequired
            ? 'fx_pending'
            : 'pending_review'
      }
    };
  };

export const createMerchantPayout =
  async (
    merchantId: string,
    input: {
      walletId: unknown;
      amount: unknown;
      payoutCurrency: unknown;
      method: unknown;
      destination: unknown;
      beneficiaryName?: unknown;
      beneficiaryCountry?: unknown;
      idempotencyKey: unknown;
    }
  ) => {
    if (
      String(
        process.env
          .XPAY_PAYOUTS_ENABLED ??
        'false'
      ).toLowerCase() !==
      'true'
    ) {
      throw new MerchantPayoutError(
        503,
        'MERCHANT_PAYOUTS_DISABLED',
        'Merchant Payouts estão desativados.'
      );
    }

    const walletId =
      String(
        input.walletId ??
        ''
      ).trim();

    if (!walletId) {
      throw new MerchantPayoutError(
        400,
        'WALLET_REQUIRED',
        'Wallet obrigatória.'
      );
    }

    const sourceAmount =
      decimal(
        input.amount,
        'amount'
      );

    const payoutCurrency =
      normalizeCurrency(
        input.payoutCurrency
      );

    const method =
      normalizeMethod(
        input.method
      );

    const destination =
      objectValue(
        input.destination
      );

    const {
      network
    } =
      validateDestination(
        method,
        payoutCurrency,
        destination
      );

    const idempotencyKey =
      String(
        input.idempotencyKey ??
        ''
      ).trim();

    if (
      idempotencyKey.length <
        8 ||
      idempotencyKey.length >
        200
    ) {
      throw new MerchantPayoutError(
        400,
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency-Key deve possuir entre 8 e 200 caracteres.'
      );
    }

    const beneficiaryName =
      String(
        input.beneficiaryName ??
        destination
          .beneficiaryName ??
        ''
      ).trim() ||
      null;

    const beneficiaryCountry =
      String(
        input
          .beneficiaryCountry ??
        destination.country ??
        ''
      )
        .trim()
        .toUpperCase()
        .slice(0, 2) ||
      null;

    const result =
      await prisma.$transaction(
        async transaction => {
          const existing =
            await transaction
              .$queryRawUnsafe<
                RawPayout[]
              >(
                `
                  SELECT *
                  FROM merchant_payout_requests
                  WHERE merchant_id =
                        $1::uuid
                    AND idempotency_key =
                        $2
                  LIMIT 1
                `,
                merchantId,
                idempotencyKey
              );

          if (existing[0]) {
            return {
              id:
                existing[0].id,
              created: false
            };
          }

          const wallets =
            await transaction
              .$queryRawUnsafe<
                RawWallet[]
              >(
                `
                  SELECT
                    id,
                    merchant_id,
                    currency,
                    balance,
                    available,
                    reserved
                  FROM wallets
                  WHERE id = $1::uuid
                    AND merchant_id =
                        $2::uuid
                  FOR UPDATE
                `,
                walletId,
                merchantId
              );

          const wallet =
            wallets[0];

          if (!wallet) {
            throw new MerchantPayoutError(
              404,
              'MERCHANT_WALLET_NOT_FOUND',
              'Merchant Wallet não encontrada.'
            );
          }

          const available =
            new Prisma.Decimal(
              String(
                wallet.available ??
                0
              )
            );

          if (
            available.lt(
              sourceAmount
            )
          ) {
            throw new MerchantPayoutError(
              409,
              'INSUFFICIENT_AVAILABLE_BALANCE',
              'Saldo disponível insuficiente.'
            );
          }

          const sourceCurrency =
            normalizeCurrency(
              wallet.currency
            );

          const fxRequired =
            sourceCurrency !==
            payoutCurrency;

          const initialStatus =
            fxRequired
              ? 'fx_pending'
              : 'pending_review';

          const fxStatus =
            fxRequired
              ? 'pending_quote'
              : 'not_required';

          const payoutId =
            crypto.randomUUID();

          const code =
            ticketCode();

          const inserted =
            await transaction
              .$queryRawUnsafe<
                RawPayout[]
              >(
                `
                  INSERT INTO merchant_payout_requests (
                    id,
                    ledger_domain,
                    ticket_code,
                    merchant_id,
                    wallet_id,
                    source_currency,
                    source_amount,
                    payout_currency,
                    payout_amount,
                    method,
                    network,
                    destination,
                    beneficiary_name,
                    beneficiary_country,
                    status,
                    fx_required,
                    fx_status,
                    requested_by,
                    idempotency_key,
                    created_at,
                    updated_at
                  )
                  VALUES (
                    $1::uuid,
                    'merchant_settlement',
                    $2,
                    $3::uuid,
                    $4::uuid,
                    $5,
                    $6::numeric,
                    $7,
                    $8::numeric,
                    $9,
                    $10,
                    $11::jsonb,
                    $12,
                    $13,
                    $14,
                    $15,
                    $16,
                    $3::uuid,
                    $17,
                    NOW(),
                    NOW()
                  )
                  RETURNING *
                `,
                payoutId,
                code,
                merchantId,
                walletId,
                sourceCurrency,
                sourceAmount,
                payoutCurrency,
                fxRequired
                  ? null
                  : sourceAmount,
                method,
                network,
                JSON.stringify(
                  destination
                ),
                beneficiaryName,
                beneficiaryCountry,
                initialStatus,
                fxRequired,
                fxStatus,
                idempotencyKey
              );

          const updatedWallet =
            await transaction
              .$queryRawUnsafe<
                RawWallet[]
              >(
                `
                  UPDATE wallets
                  SET
                    available =
                      available -
                      $1::numeric,
                    reserved =
                      reserved +
                      $1::numeric
                  WHERE id =
                        $2::uuid
                    AND merchant_id =
                        $3::uuid
                    AND available >=
                        $1::numeric
                  RETURNING
                    id,
                    merchant_id,
                    currency,
                    balance,
                    available,
                    reserved
                `,
                sourceAmount,
                walletId,
                merchantId
              );

          if (!updatedWallet[0]) {
            throw new MerchantPayoutError(
              409,
              'INSUFFICIENT_AVAILABLE_BALANCE',
              'Saldo disponível insuficiente.'
            );
          }

          await insertMovement(
            transaction,
            {
              payoutId,
              walletId,
              merchantId,
              currency:
                sourceCurrency,
              amount:
                sourceAmount,
              type:
                'merchant_payout_reserve',
              direction:
                'internal',
              reference:
                code,
              bucket:
                'reserved',
              idempotencyKey:
                `merchant-payout:${payoutId}:reserve`,
              metadata: {
                fromBucket:
                  'available',
                toBucket:
                  'reserved',
                method,
                payoutCurrency,
                fxRequired
              }
            }
          );

          await insertEvent(
            transaction,
            payoutId,
            'requested',
            'merchant',
            merchantId,
            null,
            initialStatus,
            {
              sourceCurrency,
              sourceAmount:
                sourceAmount.toString(),
              payoutCurrency,
              method,
              network,
              destination
            }
          );

          return {
            id:
              inserted[0].id,
            created: true
          };
        }
      );

    const payout =
      serialize(
        await getRawById(
          result.id,
          merchantId
        )
      );

    return {
      payout,
      created:
        result.created
    };
  };

export const listMerchantPayouts =
  async (
    merchantId: string,
    options?: {
      status?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const values:
      unknown[] = [
        merchantId
      ];

    const conditions = [
      'p.merchant_id = $1::uuid'
    ];

    if (options?.status) {
      values.push(
        options.status
      );

      conditions.push(
        `p.status = $${values.length}`
      );
    }

    const limit =
      Math.min(
        Math.max(
          Number(
            options?.limit ??
            50
          ),
          1
        ),
        100
      );

    const offset =
      Math.max(
        Number(
          options?.offset ??
          0
        ),
        0
      );

    values.push(limit);

    const limitPlaceholder =
      `$${values.length}`;

    values.push(offset);

    const offsetPlaceholder =
      `$${values.length}`;

    const rows =
      await prisma
        .$queryRawUnsafe<
          RawPayout[]
        >(
          `
            ${enrichedSelect}
            WHERE ${
              conditions.join(
                ' AND '
              )
            }
            ORDER BY
              p.created_at DESC
            LIMIT ${limitPlaceholder}
            OFFSET ${offsetPlaceholder}
          `,
          ...values
        );

    return rows.map(
      serialize
    );
  };

export const getMerchantPayout =
  async (
    merchantId: string,
    payoutId: string
  ) =>
    serialize(
      await getRawById(
        payoutId,
        merchantId
      )
    );

const releaseReservedFunds =
  async (
    options: {
      payoutId: string;
      actorType: string;
      actorId: string;
      targetStatus:
        'rejected' |
        'cancelled';
      reason?: string;
      merchantId?: string;
    }
  ) => {
    const result =
      await prisma.$transaction(
        async transaction => {
          const values:
            unknown[] = [
              options.payoutId
            ];

          let merchantCondition =
            '';

          if (
            options.merchantId
          ) {
            values.push(
              options.merchantId
            );

            merchantCondition =
              `AND merchant_id = $${values.length}::uuid`;
          }

          const payouts =
            await transaction
              .$queryRawUnsafe<
                RawPayout[]
              >(
                `
                  SELECT *
                  FROM merchant_payout_requests
                  WHERE id = $1::uuid
                  ${merchantCondition}
                  FOR UPDATE
                `,
                ...values
              );

          const payout =
            payouts[0];

          if (!payout) {
            throw new MerchantPayoutError(
              404,
              'MERCHANT_PAYOUT_NOT_FOUND',
              'Merchant Payout não encontrado.'
            );
          }

          if (
            payout.status ===
            options.targetStatus
          ) {
            return {
              id: payout.id,
              alreadyApplied: true
            };
          }

          const allowed =
            options.targetStatus ===
            'cancelled'
              ? [
                  'pending_review',
                  'fx_pending'
                ]
              : [
                  'pending_review',
                  'fx_pending',
                  'approved',
                  'processing'
                ];

          if (
            !allowed.includes(
              payout.status
            )
          ) {
            throw new MerchantPayoutError(
              409,
              'INVALID_PAYOUT_TRANSITION',
              `Não é possível passar de ${payout.status} para ${options.targetStatus}.`
            );
          }

          const amount =
            new Prisma.Decimal(
              String(
                payout.source_amount
              )
            );

          const wallets =
            await transaction
              .$queryRawUnsafe<
                RawWallet[]
              >(
                `
                  UPDATE wallets
                  SET
                    available =
                      available +
                      $1::numeric,
                    reserved =
                      reserved -
                      $1::numeric
                  WHERE id =
                        $2::uuid
                    AND merchant_id =
                        $3::uuid
                    AND reserved >=
                        $1::numeric
                  RETURNING
                    id,
                    merchant_id,
                    currency,
                    balance,
                    available,
                    reserved
                `,
                amount,
                payout.wallet_id,
                payout.merchant_id
              );

          if (!wallets[0]) {
            throw new MerchantPayoutError(
              409,
              'RESERVED_BALANCE_MISMATCH',
              'Saldo reservado inconsistente.'
            );
          }

          await transaction
            .$executeRawUnsafe(
              `
                UPDATE merchant_payout_requests
                SET
                  status = $2,
                  fx_status =
                    CASE
                      WHEN fx_required
                      THEN 'cancelled'
                      ELSE fx_status
                    END,
                  rejection_reason =
                    CASE
                      WHEN $2 = 'rejected'
                      THEN $3
                      ELSE rejection_reason
                    END,
                  review_note =
                    review_note,
                  rejected_by =
                    CASE
                      WHEN $2 = 'rejected'
                      THEN $4::uuid
                      ELSE rejected_by
                    END,
                  rejected_at =
                    CASE
                      WHEN $2 = 'rejected'
                      THEN NOW()
                      ELSE rejected_at
                    END,
                  cancelled_by =
                    CASE
                      WHEN $2 = 'cancelled'
                      THEN $4::uuid
                      ELSE cancelled_by
                    END,
                  cancelled_at =
                    CASE
                      WHEN $2 = 'cancelled'
                      THEN NOW()
                      ELSE cancelled_at
                    END,
                  updated_at = NOW()
                WHERE id = $1::uuid
              `,
              payout.id,
              options.targetStatus,
              options.reason ??
                null,
              options.actorId
            );

          await insertMovement(
            transaction,
            {
              payoutId:
                payout.id,
              walletId:
                payout.wallet_id,
              merchantId:
                payout.merchant_id,
              currency:
                payout.source_currency,
              amount,
              type:
                options.targetStatus ===
                'rejected'
                  ? 'merchant_payout_rejected_release'
                  : 'merchant_payout_cancelled_release',
              direction:
                'internal',
              reference:
                payout.ticket_code,
              bucket:
                'available',
              idempotencyKey:
                `merchant-payout:${payout.id}:${options.targetStatus}`,
              metadata: {
                fromBucket:
                  'reserved',
                toBucket:
                  'available',
                reason:
                  options.reason ??
                  null
              }
            }
          );

          await insertEvent(
            transaction,
            payout.id,
            options.targetStatus,
            options.actorType,
            options.actorId,
            payout.status,
            options.targetStatus,
            {
              reason:
                options.reason ??
                null
            }
          );

          return {
            id:
              payout.id,
            alreadyApplied: false
          };
        }
      );

    return {
      payout:
        serialize(
          await getRawById(
            result.id,
            options.merchantId
          )
        ),
      alreadyApplied:
        result.alreadyApplied
    };
  };

export const cancelMerchantPayout =
  async (
    merchantId: string,
    payoutId: string,
    reason?: string
  ) =>
    releaseReservedFunds({
      payoutId,
      merchantId,
      actorType:
        'merchant',
      actorId:
        merchantId,
      targetStatus:
        'cancelled',
      reason
    });

export const listAdminMerchantPayouts =
  async (
    options?: {
      status?: string;
      merchantId?: string;
      method?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const conditions = [
      '1 = 1'
    ];

    const values:
      unknown[] = [];

    if (options?.status) {
      values.push(
        options.status
      );

      conditions.push(
        `p.status = $${values.length}`
      );
    }

    if (
      options?.merchantId
    ) {
      values.push(
        options.merchantId
      );

      conditions.push(
        `p.merchant_id = $${values.length}::uuid`
      );
    }

    if (options?.method) {
      values.push(
        options.method
      );

      conditions.push(
        `p.method = $${values.length}`
      );
    }

    const limit =
      Math.min(
        Math.max(
          Number(
            options?.limit ??
            50
          ),
          1
        ),
        100
      );

    const offset =
      Math.max(
        Number(
          options?.offset ??
          0
        ),
        0
      );

    values.push(limit);
    const limitPlaceholder =
      `$${values.length}`;

    values.push(offset);
    const offsetPlaceholder =
      `$${values.length}`;

    const rows =
      await prisma
        .$queryRawUnsafe<
          RawPayout[]
        >(
          `
            ${enrichedSelect}
            WHERE ${
              conditions.join(
                ' AND '
              )
            }
            ORDER BY
              p.created_at DESC
            LIMIT ${limitPlaceholder}
            OFFSET ${offsetPlaceholder}
          `,
          ...values
        );

    return rows.map(
      serialize
    );
  };

export const getAdminMerchantPayout =
  async (
    payoutId: string
  ) =>
    serialize(
      await getRawById(
        payoutId
      )
    );

export const quoteMerchantPayoutFx =
  async (
    payoutId: string,
    adminId: string,
    input: {
      payoutAmount: unknown;
      fxRate: unknown;
      fxProvider?: unknown;
      fxReference?: unknown;
      note?: unknown;
    }
  ) => {
    const payoutAmount =
      decimal(
        input.payoutAmount,
        'payoutAmount'
      );

    const fxRate =
      decimal(
        input.fxRate,
        'fxRate'
      );

    await prisma.$transaction(
      async transaction => {
        const payouts =
          await transaction
            .$queryRawUnsafe<
              RawPayout[]
            >(
              `
                SELECT *
                FROM merchant_payout_requests
                WHERE id = $1::uuid
                FOR UPDATE
              `,
              payoutId
            );

        const payout =
          payouts[0];

        if (!payout) {
          throw new MerchantPayoutError(
            404,
            'MERCHANT_PAYOUT_NOT_FOUND',
            'Merchant Payout não encontrado.'
          );
        }

        if (
          !payout.fx_required
        ) {
          throw new MerchantPayoutError(
            409,
            'FX_NOT_REQUIRED',
            'Este Payout não requer câmbio.'
          );
        }

        if (
          ![
            'fx_pending',
            'pending_review'
          ].includes(
            payout.status
          )
        ) {
          throw new MerchantPayoutError(
            409,
            'INVALID_PAYOUT_TRANSITION',
            'Não é possível registar FX neste estado.'
          );
        }

        await transaction
          .$executeRawUnsafe(
            `
              UPDATE merchant_payout_requests
              SET
                payout_amount =
                  $2::numeric,
                fx_rate =
                  $3::numeric,
                fx_provider =
                  $4,
                fx_reference =
                  $5,
                fx_status =
                  'quoted',
                status =
                  'pending_review',
                review_note =
                  COALESCE(
                    $6,
                    review_note
                  ),
                updated_at = NOW()
              WHERE id =
                    $1::uuid
            `,
            payout.id,
            payoutAmount,
            fxRate,
            String(
              input.fxProvider ??
              ''
            ).trim() ||
              null,
            String(
              input.fxReference ??
              ''
            ).trim() ||
              null,
            String(
              input.note ??
              ''
            ).trim() ||
              null
          );

        await insertEvent(
          transaction,
          payout.id,
          'fx_quoted',
          'platform_admin',
          adminId,
          payout.status,
          'pending_review',
          {
            payoutAmount:
              payoutAmount.toString(),
            fxRate:
              fxRate.toString(),
            fxProvider:
              input.fxProvider ??
              null,
            fxReference:
              input.fxReference ??
              null
          }
        );
      }
    );

    return serialize(
      await getRawById(
        payoutId
      )
    );
  };

export const approveMerchantPayout =
  async (
    payoutId: string,
    adminId: string,
    note?: string
  ) => {
    await prisma.$transaction(
      async transaction => {
        const payouts =
          await transaction
            .$queryRawUnsafe<
              RawPayout[]
            >(
              `
                SELECT *
                FROM merchant_payout_requests
                WHERE id = $1::uuid
                FOR UPDATE
              `,
              payoutId
            );

        const payout =
          payouts[0];

        if (!payout) {
          throw new MerchantPayoutError(
            404,
            'MERCHANT_PAYOUT_NOT_FOUND',
            'Merchant Payout não encontrado.'
          );
        }

        if (
          payout.status ===
          'approved'
        ) {
          return;
        }

        if (
          payout.status !==
          'pending_review'
        ) {
          throw new MerchantPayoutError(
            409,
            'INVALID_PAYOUT_TRANSITION',
            `Não é possível aprovar um Payout em ${payout.status}.`
          );
        }

        if (
          payout.fx_required &&
          (
            payout.fx_status !==
              'quoted' ||
            !payout.payout_amount
          )
        ) {
          throw new MerchantPayoutError(
            409,
            'FX_QUOTE_REQUIRED',
            'Registe a cotação FX antes da aprovação.'
          );
        }

        await transaction
          .$executeRawUnsafe(
            `
              UPDATE merchant_payout_requests
              SET
                status =
                  'approved',
                fx_status =
                  CASE
                    WHEN fx_required
                    THEN 'accepted'
                    ELSE fx_status
                  END,
                approved_by =
                  $2::uuid,
                approved_at =
                  NOW(),
                review_note =
                  COALESCE(
                    $3,
                    review_note
                  ),
                updated_at =
                  NOW()
              WHERE id =
                    $1::uuid
            `,
            payout.id,
            adminId,
            note ?? null
          );

        await insertEvent(
          transaction,
          payout.id,
          'approved',
          'platform_admin',
          adminId,
          payout.status,
          'approved',
          {
            note:
              note ??
              null
          }
        );
      }
    );

    return serialize(
      await getRawById(
        payoutId
      )
    );
  };

export const markMerchantPayoutProcessing =
  async (
    payoutId: string,
    adminId: string,
    input?: {
      providerReference?: string;
      externalReference?: string;
      note?: string;
    }
  ) => {
    await prisma.$transaction(
      async transaction => {
        const payouts =
          await transaction
            .$queryRawUnsafe<
              RawPayout[]
            >(
              `
                SELECT *
                FROM merchant_payout_requests
                WHERE id = $1::uuid
                FOR UPDATE
              `,
              payoutId
            );

        const payout =
          payouts[0];

        if (!payout) {
          throw new MerchantPayoutError(
            404,
            'MERCHANT_PAYOUT_NOT_FOUND',
            'Merchant Payout não encontrado.'
          );
        }

        if (
          payout.status ===
          'processing'
        ) {
          return;
        }

        if (
          payout.status !==
          'approved'
        ) {
          throw new MerchantPayoutError(
            409,
            'INVALID_PAYOUT_TRANSITION',
            'O Payout deve estar aprovado.'
          );
        }

        await transaction
          .$executeRawUnsafe(
            `
              UPDATE merchant_payout_requests
              SET
                status =
                  'processing',
                processing_by =
                  $2::uuid,
                processing_at =
                  NOW(),
                provider_reference =
                  COALESCE(
                    $3,
                    provider_reference
                  ),
                external_reference =
                  COALESCE(
                    $4,
                    external_reference
                  ),
                review_note =
                  COALESCE(
                    $5,
                    review_note
                  ),
                updated_at =
                  NOW()
              WHERE id =
                    $1::uuid
            `,
            payout.id,
            adminId,
            input
              ?.providerReference ??
              null,
            input
              ?.externalReference ??
              null,
            input?.note ??
              null
          );

        await insertEvent(
          transaction,
          payout.id,
          'processing',
          'platform_admin',
          adminId,
          payout.status,
          'processing',
          input ?? {}
        );
      }
    );

    return serialize(
      await getRawById(
        payoutId
      )
    );
  };

export const markMerchantPayoutPaid =
  async (
    payoutId: string,
    adminId: string,
    input?: {
      providerReference?: string;
      externalReference?: string;
      note?: string;
    }
  ) => {
    const result =
      await prisma.$transaction(
        async transaction => {
          const payouts =
            await transaction
              .$queryRawUnsafe<
                RawPayout[]
              >(
                `
                  SELECT *
                  FROM merchant_payout_requests
                  WHERE id = $1::uuid
                  FOR UPDATE
                `,
                payoutId
              );

          const payout =
            payouts[0];

          if (!payout) {
            throw new MerchantPayoutError(
              404,
              'MERCHANT_PAYOUT_NOT_FOUND',
              'Merchant Payout não encontrado.'
            );
          }

          if (
            payout.status ===
            'paid'
          ) {
            return {
              alreadyApplied:
                true
            };
          }

          if (
            payout.status !==
            'processing'
          ) {
            throw new MerchantPayoutError(
              409,
              'INVALID_PAYOUT_TRANSITION',
              'O Payout deve estar em processing antes de paid.'
            );
          }

          const amount =
            new Prisma.Decimal(
              String(
                payout.source_amount
              )
            );

          const wallets =
            await transaction
              .$queryRawUnsafe<
                RawWallet[]
              >(
                `
                  UPDATE wallets
                  SET
                    balance =
                      balance -
                      $1::numeric,
                    reserved =
                      reserved -
                      $1::numeric
                  WHERE id =
                        $2::uuid
                    AND merchant_id =
                        $3::uuid
                    AND balance >=
                        $1::numeric
                    AND reserved >=
                        $1::numeric
                  RETURNING
                    id,
                    merchant_id,
                    currency,
                    balance,
                    available,
                    reserved
                `,
                amount,
                payout.wallet_id,
                payout.merchant_id
              );

          if (!wallets[0]) {
            throw new MerchantPayoutError(
              409,
              'RESERVED_BALANCE_MISMATCH',
              'Saldo reservado inconsistente.'
            );
          }

          await transaction
            .$executeRawUnsafe(
              `
                UPDATE merchant_payout_requests
                SET
                  status =
                    'paid',
                  fx_status =
                    CASE
                      WHEN fx_required
                      THEN 'converted'
                      ELSE fx_status
                    END,
                  paid_by =
                    $2::uuid,
                  paid_at =
                    NOW(),
                  provider_reference =
                    COALESCE(
                      $3,
                      provider_reference
                    ),
                  external_reference =
                    COALESCE(
                      $4,
                      external_reference
                    ),
                  review_note =
                    COALESCE(
                      $5,
                      review_note
                    ),
                  updated_at =
                    NOW()
                WHERE id =
                      $1::uuid
              `,
              payout.id,
              adminId,
              input
                ?.providerReference ??
                null,
              input
                ?.externalReference ??
                null,
              input?.note ??
                null
            );

          await insertMovement(
            transaction,
            {
              payoutId:
                payout.id,
              walletId:
                payout.wallet_id,
              merchantId:
                payout.merchant_id,
              currency:
                payout.source_currency,
              amount,
              type:
                'merchant_payout_paid',
              direction:
                'debit',
              reference:
                payout.ticket_code,
              bucket:
                'reserved',
              idempotencyKey:
                `merchant-payout:${payout.id}:paid`,
              metadata: {
                providerReference:
                  input
                    ?.providerReference ??
                  payout
                    .provider_reference,
                externalReference:
                  input
                    ?.externalReference ??
                  payout
                    .external_reference,
                payoutCurrency:
                  payout.payout_currency,
                payoutAmount:
                  payout.payout_amount,
                method:
                  payout.method
              }
            }
          );

          await insertEvent(
            transaction,
            payout.id,
            'paid',
            'platform_admin',
            adminId,
            payout.status,
            'paid',
            input ?? {}
          );

          return {
            alreadyApplied:
              false
          };
        }
      );

    return {
      payout:
        serialize(
          await getRawById(
            payoutId
          )
        ),
      alreadyApplied:
        result.alreadyApplied
    };
  };

export const rejectMerchantPayout =
  async (
    payoutId: string,
    adminId: string,
    reason: string
  ) => {
    if (
      !String(reason)
        .trim()
    ) {
      throw new MerchantPayoutError(
        400,
        'REJECTION_REASON_REQUIRED',
        'Motivo da rejeição obrigatório.'
      );
    }

    return releaseReservedFunds({
      payoutId,
      actorType:
        'platform_admin',
      actorId:
        adminId,
      targetStatus:
        'rejected',
      reason:
        String(reason).trim()
    });
  };
