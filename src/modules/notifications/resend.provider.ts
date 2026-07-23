import { renderEmailTemplate } from './email-template.service';

interface SendResendEmailInput {
  to: string;
  templateKey: string;
  payload: Record<string, unknown>;
}

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

export const sendResendEmail = async (
  input: SendResendEmailInput
): Promise<{ providerMessageId: string | null }> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.XPAY_EMAIL_FROM;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  if (!from) {
    throw new Error('XPAY_EMAIL_FROM is not configured.');
  }

  const rendered = renderEmailTemplate(input.templateKey, input.payload);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    })
  });

  const data = (await response.json()) as ResendResponse;

  if (!response.ok) {
    throw new Error(
      `RESEND_${response.status}: ${data.message ?? data.name ?? 'Unknown Resend error'}`
    );
  }

  return {
    providerMessageId: data.id ?? null
  };
};
