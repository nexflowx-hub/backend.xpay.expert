import type { Request, Response } from 'express';
import {
  createSecureApiKey,
  listSecureApiKeys,
  revokeSecureApiKey,
  rotateSecureApiKey
} from './developer-api-key.service';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    merchantId?: string;
  };
  merchantId?: string;
};

const merchantIdFrom = (req: AuthenticatedRequest): string =>
  String(
    req.user?.id ??
    req.user?.merchantId ??
    req.merchantId ??
    ''
  ).trim();


const routeParam = (
  value: string | string[] | undefined
): string =>
  Array.isArray(value)
    ? String(value[0] ?? '')
    : String(value ?? '');

const sendError = (res: Response, error: unknown): Response => {
  const code = error instanceof Error ? error.message : 'API_KEY_UNKNOWN_ERROR';

  const status =
    code.includes('NOT_FOUND') ? 404 :
    code.includes('REQUIRED') || code.includes('INVALID') ? 400 :
    code.includes('CONFLICT') ? 409 :
    500;

  return res.status(status).json({
    success: false,
    error: { code, message: code }
  });
};

export const listApiKeysV2 = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const data = await listSecureApiKeys(
      merchantIdFrom(req),
      req.query.storeId ? String(req.query.storeId) : null
    );

    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createApiKeyV2 = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const environment =
      String(req.body?.environment ?? 'test') === 'live'
        ? 'live'
        : 'test';

    const scopes = Array.isArray(req.body?.scopes)
      ? req.body.scopes.map(String)
      : ['payments:write', 'checkout:write'];

    const data = await createSecureApiKey({
      merchantId: merchantIdFrom(req),
      storeId: String(req.body?.storeId ?? ''),
      name: req.body?.name ? String(req.body.name) : null,
      environment,
      scopes,
      securityActionToken: req.get('X-Security-Action') ?? null,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null
    });

    res.setHeader('Cache-Control', 'no-store');

    return res.status(201).json({
      success: true,
      data: {
        ...data,
        revealPolicy: 'one_time_only'
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const rotateApiKeyV2 = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const actionToken = String(req.get('X-Security-Action') ?? '');

    if (!actionToken) {
      throw new Error('SECURITY_ACTION_TOKEN_REQUIRED');
    }

    const data = await rotateSecureApiKey({
      merchantId: merchantIdFrom(req),
      apiKeyId: routeParam(req.params.id),
      securityActionToken: actionToken,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null
    });

    res.setHeader('Cache-Control', 'no-store');

    return res.json({
      success: true,
      data: {
        ...data,
        revealPolicy: 'one_time_only'
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const revokeApiKeyV2 = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    await revokeSecureApiKey({
      merchantId: merchantIdFrom(req),
      apiKeyId: routeParam(req.params.id)
    });

    return res.json({
      success: true,
      data: {
        id: req.params.id,
        status: 'revoked'
      }
    });
  } catch (error) {
    return sendError(res, error);
  }
};
