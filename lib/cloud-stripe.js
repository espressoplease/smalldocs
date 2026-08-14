const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_API_BASE = 'https://api.stripe.com';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const PRORATION_BEHAVIORS = new Set(['always_invoice', 'create_prorations', 'none']);
const PAYMENT_BEHAVIORS = new Set(['allow_incomplete', 'default_incomplete', 'error_if_incomplete', 'pending_if_incomplete']);

class StripeError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'StripeError';
    this.code = code;
    if (details) Object.assign(this, details);
  }
}

function requireString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > (maxLength || 2048)) {
    throw new StripeError('invalid_request', name + ' is required');
  }
  return value.trim();
}

function requireId(value, name, prefix) {
  const id = requireString(value, name, 255);
  if (prefix && !id.startsWith(prefix)) throw new StripeError('invalid_request', name + ' is invalid');
  return id;
}

function requireQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new StripeError('invalid_request', 'quantity must be a positive integer');
  }
  return quantity;
}

function requireHttpUrl(value, name) {
  const text = requireString(value, name, 2048);
  let url;
  try { url = new URL(text); } catch (_) { throw new StripeError('invalid_request', name + ' is invalid'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StripeError('invalid_request', name + ' must use HTTP or HTTPS');
  }
  return url.toString();
}

function appendForm(params, key, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(params, key + '[' + index + ']', item));
    return;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((child) => appendForm(params, key + '[' + child + ']', value[child]));
    return;
  }
  params.append(key, typeof value === 'boolean' ? String(value) : String(value));
}

function encodeForm(values) {
  const params = new URLSearchParams();
  Object.keys(values || {}).forEach((key) => appendForm(params, key, values[key]));
  return params.toString();
}

function defaultTransport(input) {
  return new Promise((resolve, reject) => {
    const url = new URL(input.url);
    const requester = url.protocol === 'http:' ? http : https;
    const request = requester.request(url, {
      method: input.method,
      headers: input.headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(input.timeoutMs || DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new StripeError('stripe_timeout', 'Stripe request timed out'));
    });
    request.on('error', reject);
    if (input.body) request.write(input.body);
    request.end();
  });
}

function responseStatus(response) {
  return Number(response && (response.status || response.statusCode));
}

function responseHeader(response, name) {
  const headers = response && response.headers;
  if (!headers) return null;
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  const value = key ? headers[key] : null;
  return Array.isArray(value) ? value[0] : value || null;
}

function parseResponseBody(response) {
  const raw = response && response.body;
  if (raw == null || raw.length === 0) return {};
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  try { return JSON.parse(text); } catch (_) {
    throw new StripeError('invalid_stripe_response', 'Stripe returned invalid JSON', {
      status: responseStatus(response), requestId: responseHeader(response, 'request-id'),
    });
  }
}

function parseSignatureHeader(header) {
  if (typeof header !== 'string' || !header.trim()) {
    throw new StripeError('invalid_webhook_signature', 'Stripe-Signature is required');
  }
  const values = {};
  header.split(',').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!values[key]) values[key] = [];
    values[key].push(value);
  });
  const timestampText = values.t && values.t[0];
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !values.v1 || !values.v1.length) {
    throw new StripeError('invalid_webhook_signature', 'Stripe-Signature is malformed');
  }
  return { timestamp, signatures: values.v1 };
}

function safeHexEqual(expected, candidate) {
  if (!/^[0-9a-f]+$/i.test(candidate) || candidate.length !== expected.length) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const candidateBuffer = Buffer.from(candidate, 'hex');
  return expectedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}

function verifyStripeWebhook(input) {
  input = input || {};
  const secret = requireString(input.secret, 'webhook secret', 1024);
  if (!Buffer.isBuffer(input.rawBody) && typeof input.rawBody !== 'string') {
    throw new StripeError('invalid_webhook_payload', 'rawBody must be a Buffer or string');
  }
  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, 'utf8');
  const parsedHeader = parseSignatureHeader(input.signature);
  const tolerance = input.toleranceSeconds == null
    ? DEFAULT_WEBHOOK_TOLERANCE_SECONDS : Number(input.toleranceSeconds);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new StripeError('invalid_request', 'toleranceSeconds must be non-negative');
  }
  const nowValue = input.now == null ? Date.now() : (typeof input.now === 'function' ? input.now() : input.now);
  const nowSeconds = Math.floor(Number(nowValue) / 1000);
  if (!Number.isFinite(nowSeconds)) throw new StripeError('invalid_request', 'now is invalid');
  if (Math.abs(nowSeconds - parsedHeader.timestamp) > tolerance) {
    throw new StripeError('webhook_timestamp_outside_tolerance', 'Webhook timestamp is outside the tolerance');
  }
  const signedPayload = Buffer.concat([
    Buffer.from(String(parsedHeader.timestamp) + '.', 'utf8'), rawBody,
  ]);
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (!parsedHeader.signatures.some((signature) => safeHexEqual(expected, signature))) {
    throw new StripeError('invalid_webhook_signature', 'Webhook signature does not match');
  }
  try { return JSON.parse(rawBody.toString('utf8')); } catch (_) {
    throw new StripeError('invalid_webhook_payload', 'Webhook payload is not valid JSON');
  }
}

function createStripeClient(options) {
  options = options || {};
  const secretKey = requireString(options.secretKey, 'secretKey', 1024);
  const apiBase = requireHttpUrl(options.apiBase || DEFAULT_API_BASE, 'apiBase').replace(/\/$/, '');
  const transport = options.transport || defaultTransport;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  async function stripeRequest(method, path, values, requestOptions) {
    const body = method === 'GET' ? null : encodeForm(values);
    const headers = {
      Authorization: 'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
      Accept: 'application/json',
      'User-Agent': 'SmallDocs Cloud Stripe Adapter',
    };
    if (body != null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    if (options.apiVersion) headers['Stripe-Version'] = options.apiVersion;
    if (requestOptions && requestOptions.idempotencyKey) {
      headers['Idempotency-Key'] = requireString(requestOptions.idempotencyKey, 'idempotencyKey', 255);
    }
    let response;
    try {
      response = await transport({ method, url: apiBase + path, headers, body, timeoutMs });
    } catch (error) {
      if (error instanceof StripeError) throw error;
      throw new StripeError('stripe_network_error', 'Stripe request failed', { cause: error });
    }
    const status = responseStatus(response);
    const parsed = parseResponseBody(response);
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      const stripeError = parsed && parsed.error;
      throw new StripeError('stripe_api_error', stripeError && stripeError.message
        ? stripeError.message : 'Stripe request failed', {
        status,
        type: stripeError && stripeError.type,
        declineCode: stripeError && stripeError.decline_code,
        param: stripeError && stripeError.param,
        requestId: responseHeader(response, 'request-id'),
        response: parsed,
      });
    }
    return parsed;
  }

  return {
    async createCheckoutSubscriptionSession(input) {
      input = input || {};
      const workspaceId = requireString(input.workspaceId, 'workspaceId', 255);
      const plan = requireString(input.plan, 'plan', 255);
      const metadata = Object.assign({}, input.metadata || {}, {
        workspace_id: workspaceId,
        plan,
      });
      const values = {
        mode: 'subscription',
        line_items: [{ price: requireId(input.priceId, 'priceId', 'price_'), quantity: requireQuantity(input.quantity) }],
        success_url: requireHttpUrl(input.successUrl, 'successUrl'),
        cancel_url: requireHttpUrl(input.cancelUrl, 'cancelUrl'),
        client_reference_id: workspaceId,
        payment_method_collection: 'always',
        metadata,
        subscription_data: { metadata },
      };
      if (input.customerId) values.customer = requireId(input.customerId, 'customerId', 'cus_');
      else if (input.customerEmail) values.customer_email = requireString(input.customerEmail, 'customerEmail', 254);
      return stripeRequest('POST', '/v1/checkout/sessions', values, input);
    },

    async createBillingPortalSession(input) {
      input = input || {};
      const values = {
        customer: requireId(input.customerId, 'customerId', 'cus_'),
        return_url: requireHttpUrl(input.returnUrl, 'returnUrl'),
      };
      if (input.configurationId) {
        values.configuration = requireId(input.configurationId, 'configurationId', 'bpc_');
      }
      return stripeRequest('POST', '/v1/billing_portal/sessions', values, input);
    },

    async updateSubscriptionItemQuantity(input) {
      input = input || {};
      const itemId = requireId(input.subscriptionItemId, 'subscriptionItemId', 'si_');
      const prorationBehavior = input.prorationBehavior || 'create_prorations';
      if (!PRORATION_BEHAVIORS.has(prorationBehavior)) {
        throw new StripeError('invalid_request', 'prorationBehavior is invalid');
      }
      const values = { quantity: requireQuantity(input.quantity), proration_behavior: prorationBehavior };
      if (input.paymentBehavior) {
        if (!PAYMENT_BEHAVIORS.has(input.paymentBehavior)) {
          throw new StripeError('invalid_request', 'paymentBehavior is invalid');
        }
        values.payment_behavior = input.paymentBehavior;
      }
      return stripeRequest('POST', '/v1/subscription_items/' + encodeURIComponent(itemId), values, input);
    },

    async retrieveSubscription(input) {
      input = input || {};
      const subscriptionId = requireId(input.subscriptionId, 'subscriptionId', 'sub_');
      return stripeRequest('GET', '/v1/subscriptions/' + encodeURIComponent(subscriptionId), null, input);
    },

    verifyWebhook(rawBody, signature, verifyOptions) {
      return verifyStripeWebhook(Object.assign({}, verifyOptions || {}, {
        rawBody, signature, secret: (verifyOptions && verifyOptions.secret) || options.webhookSecret,
      }));
    },
  };
}

module.exports = {
  StripeError,
  createStripeClient,
  defaultTransport,
  encodeForm,
  verifyStripeWebhook,
};
