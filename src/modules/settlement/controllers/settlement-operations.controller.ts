import {
  Request,
  Response
} from 'express';

import {
  markBatchReadyForPilot,
  releaseSettlementBatch
} from '../services/settlement-release.service';

function resolveMerchantId(
  req: Request
): string {
  const request =
    req as Request & {
      merchantId?: string;

      user?: {
        id?: string;
        merchantId?: string;
      };
    };

  return String(
    request.merchantId ??
    request.user?.id ??
    request.user?.merchantId ??
    ''
  ).trim();
}

export async function pilotMarkReady(
  req: Request,
  res: Response
) {
  try {
    const environment =
      String(
        process.env.APP_ENV ??
        ''
      ).toLowerCase();

    const overrideEnabled =
      String(
        process.env
          .XPAY_PILOT_SETTLEMENT_OVERRIDE ??
        'false'
      ).toLowerCase() === 'true';

    if (
      environment !== 'pilot' ||
      !overrideEnabled
    ) {
      return res.status(403).json({
        success: false,

        error: {
          code:
            'PILOT_OVERRIDE_DISABLED',

          message:
            'Override piloto desativado.'
        }
      });
    }

    const batchId =
      String(
        req.params.id ??
        ''
      ).trim();

    const result =
      await markBatchReadyForPilot(
        batchId
      );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error(
      '[PILOT_SETTLEMENT_READY_ERROR]',
      error
    );

    return res.status(400).json({
      success: false,

      error: {
        code:
          'PILOT_SETTLEMENT_READY_FAILED',

        message:
          error instanceof Error
            ? error.message
            : 'Falha no override piloto.'
      }
    });
  }
}

export async function releaseBatch(
  req: Request,
  res: Response
) {
  try {
    const batchId =
      String(
        req.params.id ??
        ''
      ).trim();

    const releasedBy =
      resolveMerchantId(req);

    const result =
      await releaseSettlementBatch(
        batchId,
        releasedBy
      );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error(
      '[SETTLEMENT_RELEASE_ERROR]',
      error
    );

    return res.status(400).json({
      success: false,

      error: {
        code:
          'SETTLEMENT_RELEASE_FAILED',

        message:
          error instanceof Error
            ? error.message
            : 'Falha no Release.'
      }
    });
  }
}
