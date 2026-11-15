#!/usr/bin/env node
/**
 * Automated Square sandbox + Cloudflare Pages preview prep.
 * Never prints secret values. Refuses production/live charges.
 *
 * Usage:
 *   npm run website:go-live-prep
 *
 * Required env (secure secrets form / shell):
 *   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENVIRONMENT=sandbox
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 * Recommended:
 *   SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_NOTIFICATION_URL
 *   MERCHANT_REFUND_SECRET
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = site;
const projectName = process.env.CF_PAGES_PROJECT || 'aiva-trading';

const present = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
};
const missing = (names) => names.filter((n) => !present(n));

function maskStatus(name) {
  return present(name) ? 'SET' : 'MISSING';
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0 && !opts.allowFail) {
    const err = (result.stderr || result.stdout || '').trim().slice(0, 800);
    throw new Error((opts.label || cmd) + ' failed' + (err ? ': ' + err : ''));
  }
  return result;
}

function squareBase() {
  const env = String(process.env.SQUARE_ENVIRONMENT || '').toLowerCase();
  if (env === 'production' || env === 'live') {
    throw new Error('Refusing go-live-prep against production Square. Use sandbox only.');
  }
  return 'https://connect.squareupsandbox.com';
}

async function squareGet(pathname) {
  const response = await fetch(squareBase() + pathname, {
    headers: {
      Authorization: 'Bearer ' + process.env.SQUARE_ACCESS_TOKEN.trim(),
      'Square-Version': '2025-10-16',
      'Content-Type': 'application/json'
    }
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

function printConfigMatrix() {
  console.log('Configuration status (values never printed):');
  const rows = [
    ['SQUARE_ACCESS_TOKEN', 'Square Developer Dashboard → Credentials (Sandbox)'],
    ['SQUARE_LOCATION_ID', 'Square Developer Dashboard → Locations (Sandbox)'],
    ['SQUARE_ENVIRONMENT', 'Set exactly to: sandbox'],
    ['SQUARE_WEBHOOK_SIGNATURE_KEY', 'Square Developer → Webhooks → Signature Key'],
    ['SQUARE_WEBHOOK_NOTIFICATION_URL', 'Use https://aivatrading.uk/api/square-webhook (or preview URL)'],
    ['CLOUDFLARE_ACCOUNT_ID', 'Cloudflare Dashboard → Workers & Pages → Account ID'],
    ['CLOUDFLARE_API_TOKEN', 'Cloudflare → My Profile → API Tokens (Pages Edit + D1 Edit)'],
    ['MERCHANT_REFUND_SECRET', 'Generate any 24+ random string; store only in secrets'],
    ['PAYPAL_CLIENT_ID', 'Optional — PayPal Developer Dashboard'],
    ['PAYPAL_CLIENT_SECRET', 'Optional — PayPal Developer Dashboard'],
    ['PAYPAL_ENVIRONMENT', 'Optional — set to sandbox if using PayPal']
  ];
  for (const [name, where] of rows) {
    console.log(`- ${name}: ${maskStatus(name)} · ${where}`);
  }
}

async function main() {
  console.log('Aiva Trading — Square sandbox go-live prep');
  console.log('Production deploy and live charges are blocked by this script.\n');
  printConfigMatrix();
  console.log('');

  if (existsSync(path.join(site, '_worker.js'))) {
    throw new Error('_worker.js exists. Remove it; Functions path only.');
  }

  const required = [
    'SQUARE_ACCESS_TOKEN',
    'SQUARE_LOCATION_ID',
    'SQUARE_ENVIRONMENT',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN'
  ];
  const need = missing(required);
  if (need.length) {
    console.log('BLOCKED: missing required secrets:', need.join(', '));
    console.log('Add them in the Cursor secure secrets form, then re-run:');
    console.log('  npm run website:go-live-prep');
    console.log('No Cloudflare changes were made.');
    process.exitCode = 2;
    return;
  }

  const squareEnv = String(process.env.SQUARE_ENVIRONMENT).trim().toLowerCase();
  if (squareEnv !== 'sandbox' && squareEnv !== 'test') {
    throw new Error('SQUARE_ENVIRONMENT must be sandbox for this prep script.');
  }

  console.log('1) Verifying Square sandbox location…');
  const loc = await squareGet('/v2/locations/' + encodeURIComponent(process.env.SQUARE_LOCATION_ID.trim()));
  if (!loc.ok) {
    throw new Error('Square location lookup failed (HTTP ' + loc.status + '). Check sandbox token/location id.');
  }
  const location = loc.data?.location;
  console.log(
    '   Location status:',
    location?.status || 'unknown',
    '| currency:',
    location?.currency || 'n/a',
    '| capabilities:',
    Array.isArray(location?.capabilities) ? location.capabilities.join(',') : 'n/a'
  );

  console.log('2) Ensuring Cloudflare D1 database aiva_orders…');
  const listDb = run('npx', ['--yes', 'wrangler@4', 'd1', 'list', '--json'], {
    label: 'wrangler d1 list',
    allowFail: true
  });
  let databaseId = '';
  if (listDb.status === 0) {
    try {
      const parsed = JSON.parse(listDb.stdout || '[]');
      const rows = Array.isArray(parsed) ? parsed : parsed?.result || [];
      const found = rows.find((d) => d.name === 'aiva_orders' || d.name === 'aiva-orders');
      if (found?.uuid || found?.id) databaseId = found.uuid || found.id;
    } catch {
      /* continue to create */
    }
  }
  if (!databaseId) {
    const created = run(
      'npx',
      ['--yes', 'wrangler@4', 'd1', 'create', 'aiva_orders', '--json'],
      { label: 'wrangler d1 create' }
    );
    const parsed = JSON.parse(created.stdout || '{}');
    databaseId = parsed?.uuid || parsed?.id || parsed?.database_id || '';
    if (!databaseId && typeof created.stdout === 'string') {
      const m = created.stdout.match(/database_id\s*=\s*"([^"]+)"/);
      if (m) databaseId = m[1];
    }
  }
  if (!databaseId) throw new Error('Could not resolve D1 database id for aiva_orders.');
  console.log('   D1 aiva_orders id resolved (value not printed).');

  const wranglerPath = path.join(site, 'wrangler.toml');
  writeFileSync(
    wranglerPath,
    `# Cloudflare Pages project for aivatrading.uk
# Generated/updated by scripts/go-live-prep.mjs
name = "aiva-trading"
compatibility_date = "2025-11-01"
pages_build_output_dir = "."

[[d1_databases]]
binding = "ORDERS_DB"
database_name = "aiva_orders"
database_id = "${databaseId}"
`
  );
  console.log('3) Applied ORDERS_DB binding in wrangler.toml');

  console.log('4) Applying ORDER-DATABASE-SETUP.sql…');
  run(
    'npx',
    [
      '--yes',
      'wrangler@4',
      'd1',
      'execute',
      'aiva_orders',
      '--remote',
      '--file=' + path.join(site, 'ORDER-DATABASE-SETUP.sql')
    ],
    { label: 'wrangler d1 execute' }
  );

  console.log('5) Deploying Cloudflare Pages PREVIEW (not production promote)…');
  const deploy = run(
    'npx',
    [
      '--yes',
      'wrangler@4',
      'pages',
      'deploy',
      site,
      '--project-name=' + projectName,
      '--branch=square-sandbox-preview',
      '--commit-dirty=true'
    ],
    { label: 'wrangler pages deploy' }
  );
  const out = (deploy.stdout || '') + '\n' + (deploy.stderr || '');
  const urls = [...out.matchAll(/https:\/\/[a-zA-Z0-9._/-]+/g)].map((m) => m[0]);
  const preview = urls.find((u) => /pages\.dev|workers\.dev|aivatrading/i.test(u)) || urls[0] || '';
  console.log('   Deploy finished.');
  if (preview) console.log('   Preview URL:', preview);

  if (preview) {
    console.log('6) Checking preview /api/shop-status…');
    try {
      const statusRes = await fetch(preview.replace(/\/$/, '') + '/api/shop-status', {
        cache: 'no-store'
      });
      const text = await statusRes.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!statusRes.ok || !json) {
        console.log('   shop-status not ready yet (HTTP ' + statusRes.status + ').');
        console.log('   If HTML 404, wait for Pages Functions propagation and retry.');
      } else {
        console.log(
          '   shop-status OK · provider=',
          json.provider,
          '· ready=',
          json.ready,
          '· mode=',
          json.mode,
          '· shopEnabled=',
          json.shopEnabled
        );
        if (json.ready === true) {
          console.log('   WARNING: ready=true while catalogue should stay closed until you approve.');
        }
      }
    } catch (e) {
      console.log('   Could not reach preview shop-status yet:', String(e.message || e));
    }
  }

  console.log('\nDONE (sandbox prep only).');
  console.log('- Live production was NOT promoted.');
  console.log('- Real card charges were NOT taken.');
  console.log('- Keep data/aiva-products.json shopEnabled=false until real products + your approval.');
  console.log('- Next: open Square sandbox Payment Link from shop on the preview host, then refund via merchant tool.');
  if (!present('SQUARE_WEBHOOK_SIGNATURE_KEY')) {
    console.log('- Still missing SQUARE_WEBHOOK_SIGNATURE_KEY for signed webhook recording.');
  }
  if (!present('MERCHANT_REFUND_SECRET')) {
    console.log('- Still missing MERCHANT_REFUND_SECRET for /api/create-refund.');
  }
}

main().catch((err) => {
  console.error('go-live-prep failed:', err.message || err);
  process.exitCode = 1;
});
