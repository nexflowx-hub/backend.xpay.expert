import {
  Response
} from 'express';

import {
  AuthRequest
} from '../../../middleware/auth.middleware';

import {
  approveMerchantPayout,
  getAdminMerchantPayout,
  listAdminMerchantPayouts,
  markMerchantPayoutPaid,
  markMerchantPayoutProcessing,
  MerchantPayoutError,
  quoteMerchantPayoutFx,
  rejectMerchantPayout
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
    '[ADMIN_MERCHANT_PAYOUT_ERROR]',
    error
  );

  return res
    .status(500)
    .json({
      success: false,
      error: {
        code:
          'ADMIN_MERCHANT_PAYOUT_ERROR',
        message:
          'Não foi possível processar o Merchant Payout.'
      }
    });
};

const adminId = (
  req: AuthRequest
): string => {
  const value =
    req.user?.id;

  if (!value) {
    throw new MerchantPayoutError(
      401,
      'UNAUTHORIZED',
      'Sessão Admin não autenticada.'
    );
  }

  return value;
};

export const list =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const items =
        await listAdminMerchantPayouts({
          status:
            typeof
              req.query
                .status ===
            'string'
              ? req.query
                  .status
              : undefined,

          merchantId:
            typeof
              req.query
                .merchantId ===
            'string'
              ? req.query
                  .merchantId
              : undefined,

          method:
            typeof
              req.query
                .method ===
            'string'
              ? req.query
                  .method
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
        });

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
      const payout =
        await getAdminMerchantPayout(
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

export const quoteFx =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const payout =
        await quoteMerchantPayoutFx(
          routeParam(req.params.id),
          adminId(req),
          req.body ?? {}
        );

      await notifyMerchantPayout(
        payout,
        'fx_quoted'
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

export const approve =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const payout =
        await approveMerchantPayout(
          routeParam(req.params.id),
          adminId(req),
          String(
            req.body?.note ??
            ''
          ).trim() ||
            undefined
        );

      await notifyMerchantPayout(
        payout,
        'approved'
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

export const processing =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const payout =
        await markMerchantPayoutProcessing(
          routeParam(req.params.id),
          adminId(req),
          req.body ?? {}
        );

      await notifyMerchantPayout(
        payout,
        'processing'
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

export const paid =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const result =
        await markMerchantPayoutPaid(
          routeParam(req.params.id),
          adminId(req),
          req.body ?? {}
        );

      if (
        !result.alreadyApplied
      ) {
        await notifyMerchantPayout(
          result.payout,
          'paid'
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

export const reject =
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      const result =
        await rejectMerchantPayout(
          routeParam(req.params.id),
          adminId(req),
          String(
            req.body?.reason ??
            ''
          )
        );

      if (
        !result.alreadyApplied
      ) {
        await notifyMerchantPayout(
          result.payout,
          'rejected'
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
