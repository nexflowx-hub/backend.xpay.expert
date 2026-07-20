import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { executePayment } from '../../payments/services/payment.service';
import crypto from 'crypto';

const prisma = new PrismaClient();

const PAYMENT_LABELS: Record<string, string> = {
  card: 'Cartão',
  mb_way: 'MB WAY',
  multibanco: 'Multibanco',
  bizum: 'Bizum',
  pix: 'PIX',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay'
};

export const createSession = async (req: Request, res: Response) => {
  try {
    const { amount, currency = 'EUR', reference, customerEmail, metadata } = req.body;
    const apiKey = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'API Key não fornecida.' });
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { store: true }
    });

    if (!keyRecord || keyRecord.store.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Acesso negado.' });
    }

    // Converter cêntimos para Euros (ex: 2500 -> 25.00)
    const amountInEur = Number(amount) / 100;
    const sessionId = crypto.randomUUID();

    const checkoutBaseUrl =
      String(
        process.env.CHECKOUT_BASE_URL ??
        'https://checkout.xpay.expert'
      ).replace(/\/+$/, '');

    const checkoutUrl =
      `${checkoutBaseUrl}/pay/${sessionId}`;

    const session = await prisma.checkoutSession.create({
      data: {
        id: sessionId,
        merchantId: keyRecord.store.merchantId,
        storeId: keyRecord.store.id,
        amount: amountInEur,
        checkoutUrl: checkoutUrl,
        currency,
        reference: reference || `CHK-${Date.now()}`,
        customerEmail,
        metadata: {
          ...(
            metadata &&
            typeof metadata === 'object'
              ? metadata
              : {}
          ),

          /*
           * Contexto exclusivamente interno.
           * A API Key nunca é guardada na sessão,
           * apenas o seu ID e ambiente.
           */
          _xpay: {
            apiKeyId: keyRecord.id,
            environment: keyRecord.environment
          }
        },
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        checkoutUrl: session.checkoutUrl
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

export const loadSession = async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId);
    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { store: true }
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Sessão não encontrada.' });
    }

    const store = (session as any).store;
    const routingRules = (store?.routingRules as Record<string, string>) || {};

    const paymentMethods = Object.entries(routingRules).map(([code, provider]) => ({
      code,
      label: PAYMENT_LABELS[code] || code,
      provider
    }));

    return res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        storeName: store?.name || 'Store',
        amount: Number(session.amount),
        currency: session.currency,
        reference: session.reference,
        logoUrl: store?.logoUrl || null,
        theme: store?.theme || 'light',
        paymentMethods
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
};

export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const { sessionId, paymentMethod, customer } = req.body;

    if (!sessionId || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    const session = await prisma.checkoutSession.findUnique({
      where: { id: String(sessionId) }
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Sessão inválida.' });
    }

    if (
      session.expiresAt.getTime() <
      Date.now()
    ) {
      return res.status(410).json({
        success: false,
        message: 'Sessão expirada.'
      });
    }

    const sessionMetadata: Record<
      string,
      any
    > =
      session.metadata &&
      typeof session.metadata === 'object' &&
      !Array.isArray(session.metadata)
        ? {
            ...(session.metadata as Record<
              string,
              any
            >)
          }
        : {};

    /*
     * Contexto interno definido quando a sessão
     * foi criada. Nunca é enviado ao frontend
     * nem ao provider.
     */
    const internalContext =
      sessionMetadata._xpay ?? {};

    delete sessionMetadata._xpay;

    let sessionApiKey =
      internalContext.apiKeyId
        ? await prisma.apiKey.findUnique({
            where: {
              id: String(
                internalContext.apiKeyId
              )
            }
          })
        : null;

    /*
     * Garante que uma sessão nunca utilize
     * uma API Key pertencente a outra Store.
     */
    if (
      sessionApiKey &&
      sessionApiKey.storeId !==
        session.storeId
    ) {
      sessionApiKey = null;
    }

    /*
     * Compatibilidade para sessões criadas
     * antes desta atualização.
     *
     * Em Lab/Test escolhe uma chave Test.
     * Em Production escolhe uma chave Live.
     */
    if (!sessionApiKey) {
      const appEnvironment =
        String(
          process.env.APP_ENV ??
          process.env.NODE_ENV ??
          'lab'
        ).toLowerCase();

      const preferredEnvironment =
        [
          'production',
          'prod',
          'live'
        ].includes(appEnvironment)
          ? 'live'
          : 'test';

      sessionApiKey =
        await prisma.apiKey.findFirst({
          where: {
            storeId:
              session.storeId,

            environment:
              preferredEnvironment
          },

          orderBy: {
            createdAt: 'desc'
          }
        });
    }

    /*
     * Último fallback apenas para sessões
     * legadas sem contexto de ambiente.
     */
    if (!sessionApiKey) {
      sessionApiKey =
        await prisma.apiKey.findFirst({
          where: {
            storeId:
              session.storeId
          },

          orderBy: {
            createdAt: 'desc'
          }
        });
    }

    if (!sessionApiKey) {
      return res.status(409).json({
        success: false,
        message:
          'Nenhuma API Key configurada para esta Store.'
      });
    }

    const merchantReference =
      session.reference ||
      `CHK-${session.id}`;

    /*
     * Reconverte o valor Decimal da sessão
     * para cêntimos.
     */
    const amountInCents =
      Math.round(
        Number(session.amount) *
        100
      );

    const customerInput =
      customer &&
      typeof customer === 'object'
        ? customer
        : {};

    const result =
      await executePayment(
        sessionApiKey.key,
        {
          amount:
            amountInCents,

          currency:
            session.currency,

          payment_method_types: [
            paymentMethod
          ],

          customer: {
            name:
              customerInput.name,

            email:
              customerInput.email ??
              session.customerEmail ??
              undefined,

            phone:
              customerInput.phone
          },

          metadata: {
            ...sessionMetadata,

            order_id:
              merchantReference,

            reference:
              merchantReference,

            return_url:
              customerInput.return_url ??
              sessionMetadata.return_url ??
              'https://xpay.expert/payment/complete'
          }
        }
      );

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error(error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao iniciar pagamento.'
    });
  }
};
