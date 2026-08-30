// Mayar payment gateway client.
//
// Docs: https://mayar.mintlify.app/api-reference-v2/introduction
//
// Security rules this module exists to enforce:
//
//  1. The API key is read from the environment only. It must never appear in a
//     VITE_ variable, because Vite inlines those into the browser bundle where
//     anyone can read them. A read+write Mayar key can create charges.
//  2. The key is never logged, not even truncated.
//  3. Prices are never taken from the client. The caller passes a plan id and
//     this module is given the amount the server looked up, so a tampered
//     request cannot buy Premium for 1 rupiah.
//  4. extraData carries our own uid and planId through the payment and comes
//     back on the webhook, so fulfilment is deterministic rather than inferred.

const API_KEY = (process.env.MAYAR_API_KEY || '').trim();
const WEBHOOK_TOKEN = (process.env.MAYAR_WEBHOOK_TOKEN || '').trim();

// Production is api.mayar.id; the sandbox at web.mayar.io issues its own keys.
// Point MAYAR_API_BASE at the sandbox to test without moving real money.
const API_BASE = (process.env.MAYAR_API_BASE || 'https://api.mayar.id').trim().replace(/\/+$/, '');

// Static payment link fallback, for accounts not using the headless API.
const PAYMENT_LINK = (process.env.MAYAR_PAYMENT_LINK || '').trim();

export const mayarConfig = {
  get hasApiKey() { return Boolean(API_KEY); },
  get hasWebhookToken() { return Boolean(WEBHOOK_TOKEN); },
  get hasPaymentLink() { return Boolean(PAYMENT_LINK); },
  get isConfigured() { return Boolean(API_KEY || PAYMENT_LINK); },
  get apiBase() { return API_BASE; },
  get isSandbox() { return API_BASE.includes('mayar.io'); },
  get paymentLink() { return PAYMENT_LINK; },
};

// Warn loudly at startup rather than at the first payment attempt.
export function reportMayarConfig() {
  if (!mayarConfig.isConfigured) {
    console.warn('[Mayar] Not configured — MAYAR_API_KEY is unset, so checkout is disabled.');
    return;
  }
  console.log(`[Mayar] Configured against ${API_BASE}${mayarConfig.isSandbox ? ' (SANDBOX)' : ''}`);
  if (!mayarConfig.hasWebhookToken) {
    console.warn('[Mayar] MAYAR_WEBHOOK_TOKEN is unset — the webhook will reject every call. Set it to enable fulfilment.');
  }
}

/**
 * Constant-time comparison of the webhook's shared token.
 *
 * The previous check used `token.includes(SECRET)`, which accepts any string
 * that merely contains the token and leaks length through timing. This compares
 * the whole value at fixed cost.
 */
export async function verifyWebhookToken(rawHeaderValue) {
  if (!WEBHOOK_TOKEN) return false;

  const presented = String(rawHeaderValue || '').replace(/^Bearer\s+/i, '').trim();
  if (!presented) return false;

  const crypto = await import('crypto');
  // Hash both sides first so timingSafeEqual always gets equal-length buffers,
  // which it requires, without revealing the expected length.
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(WEBHOOK_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Create an invoice and return a payment link.
 *
 * `amountMinor` must be the price the SERVER resolved for the plan, in rupiah.
 * `extraData` is echoed back verbatim on the webhook.
 */
export async function createInvoice({
  name, email, mobile, description, amount, itemDescription, extraData, expiresInHours = 24,
}) {
  if (!API_KEY) {
    throw Object.assign(new Error('Mayar API key is not configured'), { code: 'mayar_not_configured' });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw Object.assign(new Error('Invoice amount must be a positive number'), { code: 'invalid_amount' });
  }

  const body = {
    name: String(name || 'Customer').slice(0, 120),
    email: String(email || ''),
    // Mobile is required by the API. Mayar rejects an empty string, so callers
    // must supply something; this is the documented placeholder shape.
    mobile: String(mobile || '').replace(/[^\d+]/g, '') || '08000000000',
    items: [
      {
        quantity: 1,
        rate: Math.round(numericAmount),
        description: String(itemDescription || description || 'Subscription').slice(0, 200),
      },
    ],
    description: String(description || '').slice(0, 500),
    expiredAt: new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString(),
    ...(extraData ? { extraData } : {}),
  };

  let res;
  try {
    res = await fetch(`${API_BASE}/hl/v2/invoice/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    // Network or timeout. Deliberately does not include the request headers.
    throw Object.assign(
      new Error(`Could not reach Mayar: ${err.message}`),
      { code: 'mayar_unreachable' }
    );
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    // Mayar returns { statusCode, messages }. Surface its message, never the key.
    const detail = payload?.messages || payload?.message || `HTTP ${res.status}`;
    console.error(`[Mayar] invoice/create failed: ${res.status} ${JSON.stringify(detail)}`);
    throw Object.assign(
      new Error(typeof detail === 'string' ? detail : 'Mayar rejected the invoice request'),
      { code: 'mayar_rejected', status: res.status }
    );
  }

  const data = payload?.data || {};
  const link = data.link || data.url || '';

  if (!link) {
    console.error('[Mayar] invoice/create returned no payment link:', JSON.stringify(payload));
    throw Object.assign(new Error('Mayar did not return a payment link'), { code: 'mayar_no_link' });
  }

  return {
    invoiceId: data.id || null,
    mayarTransactionId: data.transactionId || null,
    link,
    expiredAt: data.expiredAt || null,
    raw: payload,
  };
}

/**
 * Normalise a webhook body into the fields we act on.
 *
 * Mayar has sent these under slightly different shapes across versions, so each
 * field is read from a few plausible locations rather than assuming one.
 */
export function parseWebhookEvent(payload = {}) {
  const data = payload.data || payload;
  const extra = data.extraData || payload.extraData || {};

  const statusRaw = String(payload.event || payload.status || data.status || '').toUpperCase();
  const isPaid = /PAID|SUCCESS|SETTLED|PAYMENT\.RECEIVED/.test(statusRaw);

  return {
    status: statusRaw || 'UNKNOWN',
    isPaid,
    // Our own id, round-tripped through extraData. This is the reliable join key.
    localTransactionId: extra.localTransactionId || extra.ref || null,
    uid: extra.uid || null,
    planId: extra.planId || null,
    mayarTransactionId: data.transactionId || data.id || payload.id || null,
    email: data.customerEmail || data.email || payload.customerEmail || null,
    amount: Number(data.amount ?? payload.amount ?? 0) || 0,
  };
}
