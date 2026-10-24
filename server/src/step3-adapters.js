import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

function secretBuffer(value, name) {
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) {
    const error = new Error(`${name} must be configured as a 32-byte hex value.`);
    error.statusCode = 503;
    throw error;
  }
  return Buffer.from(value, 'hex');
}

function canonicalEvent(event) {
  return [
    event.eventId,
    event.transactionReference,
    event.orderId,
    String(event.amountFen),
    event.outcome,
    event.createdAt,
  ].join('|');
}

function signatureFor(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function createSandboxPaymentAdapter(config) {
  return Object.freeze({
    code: 'sandbox',
    createIntent({ orderId, amountFen }) {
      return {
        reference: `sandbox_${randomUUID()}`,
        checkoutUrl: `sandbox-pay://checkout/${encodeURIComponent(orderId)}`,
        amountFen,
      };
    },
    signCallback(event) {
      return signatureFor(secretBuffer(config.paymentSandboxSecretHex, 'PAYMENT_SANDBOX_SECRET_HEX'), canonicalEvent(event));
    },
    verifyCallback(event, signature) {
      if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) return false;
      const secret = secretBuffer(config.paymentSandboxSecretHex, 'PAYMENT_SANDBOX_SECRET_HEX');
      const expected = Buffer.from(signatureFor(secret, canonicalEvent(event)), 'hex');
      const provided = Buffer.from(signature, 'hex');
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    },
    buildCallback({ transactionReference, orderId, amountFen, outcome }) {
      const event = {
        eventId: randomUUID(),
        transactionReference,
        orderId,
        amountFen,
        outcome,
        createdAt: new Date().toISOString(),
      };
      return { event, signature: this.signCallback(event) };
    },
  });
}

export function createSandboxInsuranceAdapter(config) {
  return Object.freeze({
    code: 'sandbox',
    createCheckout({ policyId, orderNumber }) {
      const secret = secretBuffer(config.insuranceSandboxSecretHex, 'INSURANCE_SANDBOX_SECRET_HEX');
      const proof = signatureFor(secret, `${policyId}|${orderNumber}`);
      const query = new URLSearchParams({ policyId, orderNumber, proof });
      return `https://insurance-sandbox.invalid/checkout?${query}`;
    },
  });
}
