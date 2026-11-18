#!/usr/bin/env node
/* CI only. Uses the existing GitHub secrets; never prints secret values. Sandbox only. */
import { writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SANDBOX = 'https://connect.squareupsandbox.com', PROD = 'https://connect.squareup.com';
const V = '2025-10-16';
const token = (process.env.GH_SQUARE_ACCESS_TOKEN || '').trim();
const wantLoc = (process.env.GH_SQUARE_LOCATION_ID || '').trim();
const hookUrl = process.env.WEBHOOK_URL;
const out = process.env.SECRETS_FILE;
const ghOut = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const mask = (v) => v && console.log('::add-mask::' + v);

async function sq(host, path, init = {}) {
  const r = await fetch(host + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Square-Version': V, 'Content-Type': 'application/json' } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

if (!token) { console.log('GitHub secret SQUARE_ACCESS_TOKEN is empty.'); ghOut('configured', 'false'); process.exit(0); }
const sb = await sq(SANDBOX, '/v2/locations');
const pr = await sq(PROD, '/v2/locations');
console.log(`SQUARE token probe: sandbox HTTP ${sb.status}, production HTTP ${pr.status} (GET /v2/locations, read-only)`);
if (sb.status !== 200) {
  console.log(pr.status === 200 ? 'GitHub SQUARE_ACCESS_TOKEN is a PRODUCTION token. Not used (live payments need owner approval).' : 'GitHub SQUARE_ACCESS_TOKEN is not valid for Square.');
  ghOut('configured', 'false'); ghOut('token_kind', pr.status === 200 ? 'production' : 'invalid'); process.exit(0);
}
ghOut('token_kind', 'sandbox');
const locs = (sb.data.locations || []).filter((l) => l.status === 'ACTIVE');
const loc = locs.find((l) => l.id === wantLoc) || locs.find((l) => l.currency === 'GBP') || locs[0];
if (!loc) { console.log('No active sandbox location.'); ghOut('configured', 'false'); process.exit(0); }
console.log(`Sandbox location ${loc.id} (${loc.country}/${loc.currency}); GitHub SQUARE_LOCATION_ID ${wantLoc === loc.id ? 'matches' : 'not used (missing or not an active sandbox location)'}`);
if (loc.currency !== 'GBP') console.log('WARNING: sandbox location currency is not GBP; GBP checkouts may be rejected.');

const events = ['payment.created', 'payment.updated', 'refund.created', 'refund.updated'];
const subs = await sq(SANDBOX, '/v2/webhooks/subscriptions');
let sub = (subs.data.subscriptions || []).find((s) => s.notification_url === hookUrl);
if (!sub) {
  const c = await sq(SANDBOX, '/v2/webhooks/subscriptions', { method: 'POST', body: JSON.stringify({ idempotency_key: randomBytes(16).toString('hex'), subscription: { name: 'Aiva Trading website', event_types: events, notification_url: hookUrl, api_version: V } }) });
  if (c.status !== 200) { console.log('Webhook create failed HTTP', c.status, JSON.stringify(c.data.errors?.map((e) => e.code))); ghOut('configured', 'false'); process.exit(1); }
  sub = c.data.subscription; console.log('Webhook subscription created', sub.id);
} else {
  const u = await sq(SANDBOX, '/v2/webhooks/subscriptions/' + sub.id, { method: 'PUT', body: JSON.stringify({ subscription: { enabled: true, event_types: events } }) });
  console.log('Webhook subscription reused', sub.id, 'update HTTP', u.status);
}
const k = await sq(SANDBOX, `/v2/webhooks/subscriptions/${sub.id}/signature-key`, { method: 'POST', body: JSON.stringify({ idempotency_key: randomBytes(16).toString('hex') }) });
const sigKey = k.data.signature_key;
if (k.status !== 200 || !sigKey) { console.log('Signature key rotation failed HTTP', k.status); ghOut('configured', 'false'); process.exit(1); }
mask(sigKey);
const merchant = (process.env.GH_MERCHANT_REFUND_SECRET || '').trim().length >= 24 ? process.env.GH_MERCHANT_REFUND_SECRET.trim() : randomBytes(32).toString('hex');
mask(merchant);
writeFileSync(out, JSON.stringify({ SQUARE_ACCESS_TOKEN: token, SQUARE_LOCATION_ID: loc.id, SQUARE_WEBHOOK_SIGNATURE_KEY: sigKey, MERCHANT_ADMIN_KEY: merchant }));
writeFileSync(out + '.e2e', JSON.stringify({ sigKey, merchant, locationId: loc.id }));
console.log('Sandbox secrets prepared: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY, MERCHANT_ADMIN_KEY');
ghOut('configured', 'true');
