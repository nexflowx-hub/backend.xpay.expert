import {
  Response
} from 'express';

import {
  AuthRequest
} from '../../../middleware/auth.middleware';

import {
  cancelMerchantPayout,
  createMerchantPayout,
  getMerchantPayout,
  listMerchantPayouts,
  MerchantPayoutError,
  validateMerchantPayoutRequest
} from '../services/merchant-payout.service';

import {
  notifyMerchantPayout
} from '../services/payout-notification.service';


const routeParam = (
  value:
    | string
    | string[]
    | undefined
): string => {
  const normalized =
    Array.isArray(value)
      ? value[0]
      : value;

  const result =
    String(
      normalized ?? ''
    ).trim();

  if (!result) {
    throw new MerchantPayoutError(
      400,
      'INVALID_ROUTE_PARAMETER',
      'Identificador do Merchant Payout inválido.'
    );
  }

  return result;
};

const handleError = (
  error: unknown,
  res: Response
) => {
  if (
    error instanceof
    MerchantPayoutError
  ) {
    return res
      .status(
        error.statusCode
      )
      .json({
        success: false,
        error: {
          code:
            error.code,
          message:
            error.message
        }
      });
  }

  console.error(
    '[MERCHANT_PAYOUT_CONTROLLER_ERROR]',
    error
  );

  return res
    .status(500)
    .json({
      success: false,
      error: {
        code:
          'MERCHANT_PAYOUT_ERROR',
        message:
          'Não foi possível processar o Merchant Payout.'
      }
    });
};

export const options =
  async (
    _req: AuthRequest,
    res: Response
  ) => {
    return res.json({
      success: true,
      data: {
        ledgerDomain:
          'merchant_settlement',

        executionMode:
          'manual',

        fxMode:
          'manual',

        automaticExecution:
          false,

        automaticFx:
          false,

        methods: [
          {
            code:
              'SEPA_INSTANT',
            payoutCurrency:
              'EUR',
            destinationFields: [
              'beneficiaryName',
              'iban',
              'bic',
              'bankName',
              'country',
              'paymentReference'
            ]
          },
          {
            code:
              'PIX',
            payoutCurrency:
              'BRL',
            pixKeyTypes: [
              'CPF',
              'CNPJ',
              'EMAIL',
              'PHONE',
              'EVP'
            ],
            destinationFields: [
              'beneficiaryName',
              'keyType',
              'keyValue',
              'taxId',
              'bankName',
              'country'
            ]
          },
          {
            code:
              'USDT_TRC20',
            payoutCurrency:
              'USDT',
            network:
              'TRC20',
            destinationFields: [
              'beneficiaryName',
              'walletAddress'
            ]
          },
          {
            code:
              'USDT_ERC20',
            payoutCurrency:
              'USDT',
            network:
              'ERC20',
            destinationFields: [
              'beneficiaryName',
              'walletAddress'
            ]
          },
          {
            code:
              'MANUAL',
            payoutCurrency:
              'ANY',
            destinationFields: [
              'beneficiaryName',
              'country',
              'network',
              'instructions'
            ]
          }
        ]
      }
    });
  };

export const validate =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        req.user?.id;

      if (!merchantId) {
        return res
          .status(401)
          .json({
            success: false,
            error: {
              code:
                'UNAUTHORIZED',
              message:
                'Sessão não autenticada.'
            }
          });
      }

      const validation =
        await validateMerchantPayoutRequest(
          merchantId,
          req.body ?? {}
        );

      return res.json({
        success: true,
        data: {
          validation
        }
      });
    } catch (error) {
      return handleError(
        error,
        res
      );
    }
  };

export const create =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        req.user?.id;

      if (!merchantId) {
        return res
          .status(401)
          .json({
            success: false,
            error: {
              code:
                'UNAUTHORIZED',
              message:
                'Sessão não autenticada.'
            }
          });
      }

      const idempotencyKey =
        req.get(
          'Idempotency-Key'
        ) ??
        req.body
          ?.idempotencyKey;

      const result =
        await createMerchantPayout(
          merchantId,
          {
            ...req.body,
            idempotencyKey
          }
        );

      if (result.created) {
        await notifyMerchantPayout(
          result.payout,
          'requested'
        );
      }

      return res
        .status(
          result.created
            ? 201
            : 200
        )
        .json({
          success: true,
          data: {
            payout:
              result.payout,
            idempotentReplay:
              !result.created
          }
        });
    } catch (error) {
      return handleError(
        error,
        res
      );
    }
  };

export const list =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        req.user?.id;

      if (!merchantId) {
        return res
          .status(401)
          .json({
            success: false,
            error: {
              code:
                'UNAUTHORIZED',
              message:
                'Sessão não autenticada.'
            }
          });
      }

      const items =
        await listMerchantPayouts(
          merchantId,
          {
            status:
              typeof
                req.query
                  .status ===
              'string'
                ? req.query
                    .status
                : undefined,

            limit:
              Number(
                req.query
                  .limit ??
                50
              ),

            offset:
              Number(
                req.query
                  .offset ??
                0
              )
          }
        );

      return res.json({
        success: true,
        data: {
          items
        }
      });
    } catch (error) {
      return handleError(
        error,
        res
      );
    }
  };

export const getOne =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        req.user?.id;

      if (!merchantId) {
        return res
          .status(401)
          .json({
            success: false,
            error: {
              code:
                'UNAUTHORIZED',
              message:
                'Sessão não autenticada.'
            }
          });
      }

      const payout =
        await getMerchantPayout(
          merchantId,
          routeParam(req.params.id)
        );

      return res.json({
        success: true,
        data: {
          payout
        }
      });
    } catch (error) {
      return handleError(
        error,
        res
      );
    }
  };

export const cancel =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const merchantId =
        req.user?.id;

      if (!merchantId) {
        return res
          .status(401)
          .json({
            success: false,
            error: {
              code:
                'UNAUTHORIZED',
              message:
                'Sessão não autenticada.'
            }
          });
      }

      const result =
        await cancelMerchantPayout(
          merchantId,
          routeParam(req.params.id),
          String(
            req.body?.reason ??
            ''
          ).trim() ||
            undefined
        );

      if (
        !result.alreadyApplied
      ) {
        await notifyMerchantPayout(
          result.payout,
          'cancelled'
        );
      }

      return res.json({
        success: true,
        data: result
      });
    } catch (error) {
      return handleError(
        error,
        res
      );
    }
  };
