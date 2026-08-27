import {
  NextFunction,
  Request,
  Response
} from 'express';

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

export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const merchantId =
    resolveMerchantId(req);

  const admins =
    String(
      process.env
        .XPAY_ADMIN_MERCHANT_IDS ??
      ''
    )
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

  if (
    !merchantId ||
    !admins.includes(merchantId)
  ) {
    return res.status(403).json({
      success: false,

      error: {
        code:
          'PLATFORM_ADMIN_REQUIRED',

        message:
          'Acesso reservado ao administrador da plataforma.'
      }
    });
  }

  next();
}
