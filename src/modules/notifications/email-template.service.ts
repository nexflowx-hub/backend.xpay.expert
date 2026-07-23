export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const shell = (title: string, body: string): string => `
<!doctype html>
<html lang="en">
  <body style="font-family:Inter,Arial,sans-serif;background:#f5f7fb;color:#101828;padding:32px">
    <div style="max-width:620px;margin:0 auto;background:white;border:1px solid #e4e7ec;border-radius:16px;padding:32px">
      <div style="font-weight:800;font-size:18px;margin-bottom:24px">XPAY.Expert</div>
      <h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(title)}</h1>
      ${body}
      <p style="margin-top:28px;color:#667085;font-size:13px">
        This is an operational message from XPAY.Expert.
      </p>
    </div>
  </body>
</html>`;

export const renderEmailTemplate = (
  templateKey: string,
  payload: Record<string, unknown>
): RenderedEmail => {
  switch (templateKey) {
    case 'security-code': {
      const code = escapeHtml(payload.code);
      const purpose = escapeHtml(payload.purpose);

      return {
        subject: 'Your XPAY security code',
        html: shell(
          'Security verification',
          `<p>Use this code to confirm <strong>${purpose}</strong>:</p>
           <div style="font-size:34px;letter-spacing:8px;font-weight:800;margin:24px 0">${code}</div>
           <p>This code expires in 10 minutes. Do not share it.</p>`
        ),
        text: `XPAY security code: ${payload.code}. Purpose: ${payload.purpose}. Expires in 10 minutes.`
      };
    }

    case 'store-created':
      return {
        subject: 'Store created in XPAY',
        html: shell(
          'Store created',
          `<p>Your store <strong>${escapeHtml(payload.storeName)}</strong> was created.</p>
           <p>Store code: <strong>${escapeHtml(payload.storeCode)}</strong></p>
           <p>Status: ${escapeHtml(payload.status)}</p>`
        ),
        text: `Store created: ${payload.storeName}. Code: ${payload.storeCode}. Status: ${payload.status}.`
      };

    case 'api-key-created':
      return {
        subject: 'API key created in XPAY',
        html: shell(
          'API key created',
          `<p>A new ${escapeHtml(payload.environment)} API key was created.</p>
           <p>Key: <strong>${escapeHtml(payload.keyPrefix)}••••${escapeHtml(payload.keyLastFour)}</strong></p>
           <p>The complete secret is only shown once inside the authenticated dashboard.</p>`
        ),
        text: `A new ${payload.environment} API key was created: ${payload.keyPrefix}••••${payload.keyLastFour}.`
      };

    case 'webhook-created':
      return {
        subject: 'Webhook configured in XPAY',
        html: shell(
          'Webhook configured',
          `<p>A Merchant webhook endpoint was configured.</p>
           <p>Endpoint: ${escapeHtml(payload.endpointMasked ?? payload.endpoint)}</p>`
        ),
        text: `A Merchant webhook endpoint was configured: ${payload.endpointMasked ?? payload.endpoint}.`
      };


    case 'payout-status':
      return {
        subject: `XPAY payout ${String(payload.status ?? 'updated')}`,
        html: shell(
          'Payout update',
          `<p>Ticket: <strong>${escapeHtml(payload.ticketCode ?? payload.payoutId)}</strong></p>
           <p>Status: <strong>${escapeHtml(payload.status)}</strong></p>
           <p>Source: ${escapeHtml(payload.sourceAmount)} ${escapeHtml(payload.sourceCurrency)}</p>
           <p>Destination: ${escapeHtml(payload.payoutAmount)} ${escapeHtml(payload.payoutCurrency)}</p>`
        ),
        text: `Payout ${payload.ticketCode ?? payload.payoutId}: ${payload.status}.`
      };

    case 'account-created':
      return {
        subject: 'Welcome to XPAY.Expert',
        html: shell(
          'Account created',
          `<p>Your XPAY.Expert account has been created.</p>
           <p>Complete email verification and security setup before enabling live operations.</p>`
        ),
        text: 'Your XPAY.Expert account has been created.'
      };

    default:
      return {
        subject: 'XPAY operational notification',
        html: shell(
          'Operational notification',
          `<pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`
        ),
        text: JSON.stringify(payload, null, 2)
      };
  }
};
