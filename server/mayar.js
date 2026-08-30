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

// Invoice creation path, and the reason this is not a single constant.
//
// Mayar pluralised the resource between API versions, and only one spelling exists
// per version:
//
//   v1  POST /hl/v1/invoice/create    (singular)
//   v2  POST /hl/v2/invoices/create   (plural)
//
// This code was calling /hl/v2/invoice/create — v2's version with v1's spelling,
// which exists in neither. Mayar's router answered with its generic
// {"messages":"Not Found"}, so every checkout failed with a message that looked like
// a missing customer or product rather than a wrong URL.
//
// v2 is tried first and v1 is the fallback, because a 404 is the one error that
// reliably means "this path is not a route here" rather than anything about the
// request. MAYAR_INVOICE_PATH pins it explicitly once you know which your account
// serves, skipping the probe.
const INVOICE_PATH_V2 = '/hl/v2/invoices/create';
const INVOICE_PATH_V1 = '/hl/v1/invoice/create';
const INVOICE_PATH_OVERRIDE = (process.env.MAYAR_INVOICE_PATH || '').trim();

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

/**
 * Structural check on the API key, without logging any of it.
 *
 * A Mayar key is a JWT: three base64url segments separated by exactly two dots.
 * The failure this catches is a doubled paste — copying the key twice into the
 * same variable yields four dots and a length around twice the real one. Mayar
 * answers that with a 401, which surfaces to the customer as a rejected payment
 * with no hint that the cause is a config typo.
 *
 * Returns a human-readable complaint, or null when the shape is plausible.
 */
export function inspectApiKeyShape(key = API_KEY) {
  if (!key) return null;

  const dots = (key.match(/\./g) || []).length;

  if (dots === 0) {
    return 'it contains no dots, so it is not a JWT. Copy the whole Bearer key from the Mayar dashboard.';
  }
  if (dots === 2) return null; // well-formed

  // A JWT pasted twice end to end has 2 + 2 = 4 dots and an even length whose two
  // halves are identical. Worth naming exactly, because the fix ("paste it once")
  // is not obvious from a dot count.
  if (dots === 4 && key.length % 2 === 0) {
    const half = key.length / 2;
    if (key.slice(0, half) === key.slice(half)) {
      return 'the same key appears twice, end to end. Paste it once.';
    }
  }
  if (dots > 2) {
    return `it has ${dots} dots where a JWT has 2, which usually means the value was pasted more than once or two keys were concatenated.`;
  }
  return `it has ${dots} dot where a JWT has 2, so it looks truncated.`;
}

// Warn loudly at startup rather than at the first payment attempt.
export function reportMayarConfig() {
  if (!mayarConfig.isConfigured) {
    console.warn('[Mayar] Not configured — MAYAR_API_KEY is unset, so checkout is disabled.');
    return;
  }
  console.log(`[Mayar] Configured against ${API_BASE}${mayarConfig.isSandbox ? ' (SANDBOX)' : ''}`);

  const keyProblem = inspectApiKeyShape();
  if (keyProblem) {
    // Length only. Never the value, not even truncated.
    console.error(
      `[Mayar] MAYAR_API_KEY looks malformed (${API_KEY.length} chars): ${keyProblem}\n` +
      '        Every checkout will fail with a 401 until this is fixed. Re-paste the key in .env ' +
      'on ONE line and restart.'
    );
  }

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
  name, email, mobile, description, items, extraData, expiresInHours = 24,
}) {
  if (!API_KEY) {
    throw Object.assign(new Error('Mayar API key is not configured'), { code: 'mayar_not_configured' });
  }

  // Mayar sums the items array, so a base line plus an add-on line bills a
  // variable quantity as ONE payment while still itemising it on the invoice.
  const lines = (Array.isArray(items) ? items : [])
    .map(line => ({
      quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
      rate: Math.round(Number(line.rate) || 0),
      description: String(line.description || 'Item').slice(0, 200),
    }))
    .filter(line => line.rate !== 0);

  if (lines.length === 0) {
    throw Object.assign(new Error('Invoice needs at least one line item'), { code: 'invalid_amount' });
  }

  const total = lines.reduce((sum, line) => sum + line.rate * line.quantity, 0);
  if (total <= 0) {
    // Mayar rejects this too, with "Invoice total must be greater than zero".
    throw Object.assign(new Error('Invoice total must be greater than zero'), { code: 'invalid_amount' });
  }

  const body = {
    name: String(name || 'Customer').slice(0, 120),
    email: String(email || ''),
    // Mobile is required by the API and an empty string is rejected.
    mobile: String(mobile || '').replace(/[^\d+]/g, '') || '08000000000',
    items: lines,
    description: String(description || '').slice(0, 500),
    expiredAt: new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString(),
    ...(extraData ? { extraData } : {}),
  };

  const post = async (path) => {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      return { response, body: await response.json().catch(() => null) };
    } catch (err) {
      // Network or timeout. Deliberately does not include the request headers.
      throw Object.assign(
        new Error(`Could not reach Mayar: ${err.message}`),
        { code: 'mayar_unreachable' }
      );
    }
  };

  const attempts = INVOICE_PATH_OVERRIDE
    ? [INVOICE_PATH_OVERRIDE]
    : [INVOICE_PATH_V2, INVOICE_PATH_V1];

  let res;
  let payload;
  let usedPath;

  for (const path of attempts) {
    ({ response: res, body: payload } = await post(path));
    usedPath = path;

    // Only a 404 justifies trying the other spelling. Any other status is a real
    // answer about this request and must not be retried — re-posting a 429
    // "duplicate request" or a 409 "already exist" would make things worse.
    if (res.status !== 404) break;

    if (path !== attempts[attempts.length - 1]) {
      console.warn(`[Mayar] ${path} returned 404; trying the other API version.`);
    }
  }

  if (res.ok && usedPath !== attempts[0]) {
    console.warn(
      `[Mayar] Invoices are being created via ${usedPath}, not ${attempts[0]}. ` +
      `Set MAYAR_INVOICE_PATH=${usedPath} to skip the failed probe on every checkout.`
    );
  }

  if (!res.ok) {
    // Mayar returns { statusCode, messages }. Surface its message, never the key.
    const detail = payload?.messages || payload?.message || `HTTP ${res.status}`;
    console.error(`[Mayar] invoice/create failed: ${res.status} ${JSON.stringify(detail)}`);

    // A 401/403 is never something the customer can act on, and reporting it as
    // "the provider rejected your request" sends them looking for a problem with
    // their card. It means our key is wrong.
    if (res.status === 401 || res.status === 403) {
      const shape = inspectApiKeyShape();
      console.error(
        `[Mayar] The API key was refused (${API_KEY.length} chars).` +
        (shape ? ` It also looks malformed: ${shape}` : ' Check it is the live key for this API base and has not been revoked.')
      );
      throw Object.assign(
        new Error('the payment gateway refused our credentials'),
        { code: 'mayar_auth_failed', status: res.status }
      );
    }

    // A 404 after every candidate path has been tried is a configuration problem,
    // not a rejected payment. Mayar's own body here is the bare "Not Found" from its
    // router, which reads like a missing customer and sends you looking in the wrong
    // place — so say what it actually means.
    if (res.status === 404) {
      throw Object.assign(
        new Error(
          `no invoice endpoint responded at ${API_BASE} (tried ${attempts.join(' and ')}). ` +
          'Check MAYAR_API_BASE, and MAYAR_INVOICE_PATH if your account uses a different path.'
        ),
        { code: 'mayar_endpoint_missing', status: 404 }
      );
    }

    // Documented: Mayar debounces identical create requests for a minute.
    if (res.status === 429) {
      throw Object.assign(
        new Error('the payment provider is rate limiting duplicate requests — wait a minute and try again'),
        { code: 'mayar_duplicate', status: 429 }
      );
    }

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
    // How many agents were paid for, so the webhook grants the right number.
    agents: extra.agents ? Number(extra.agents) : null,
    mayarTransactionId: data.transactionId || data.id || payload.id || null,
    email: data.customerEmail || data.email || payload.customerEmail || null,
    amount: Number(data.amount ?? payload.amount ?? 0) || 0,
  };
}
