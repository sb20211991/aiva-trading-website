#!/usr/bin/env node
/* Explicit, preview-only deployment. Never called by npm test or on push.
   Credentials are inherited from the environment and never printed. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const origin = process.env.STRIPE_TEST_ORIGIN || '';
const databaseId = process.env.STRIPE_TEST_ORDERS_DB_ID || '';
const project = 'aiva-trading';
const branch = 'stripe-test';
const fail = message => { console.error(message); process.exit(1); };
if (process.env.APPROVE_STRIPE_TEST_PREVIEW !== 'true') {
  fail('No deployment attempted. Set APPROVE_STRIPE_TEST_PREVIEW=true only after approval of the isolated test preview.');
}
let preview;
try { preview = new URL(origin); } catch { fail('STRIPE_TEST_ORIGIN must be an exact HTTPS Pages preview origin.'); }
if (preview.origin !== origin || preview.protocol !== 'https:' ||
  !preview.hostname.endsWith('.pages.dev')) {
  fail('STRIPE_TEST_ORIGIN must be an exact HTTPS Pages preview origin.');
}
if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId) || databaseId === 'd6791133-c5f2-4209-a9ab-91573e123939') {
  fail('STRIPE_TEST_ORDERS_DB_ID must identify a separate test D1 database, not the existing order database.');
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
  fail('Cloudflare deployment credentials are missing. Supply them through encrypted secrets, never chat.');
}
if (!/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID)) fail('Invalid Cloudflare account ID format.');
// Read-only verification: an explicit --branch is not safe if it IS the production branch.
let pages;
try {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' +
    process.env.CLOUDFLARE_ACCOUNT_ID + '/pages/projects/' + project, {
    headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) throw Error('CLOUDFLARE_READ_FAILED');
  pages = payload.result;
} catch { fail('Cannot verify the Cloudflare Pages production branch. No deployment attempted.'); }
if (pages?.name !== project || typeof pages.production_branch !== 'string' || !pages.production_branch ||
  pages.production_branch === branch) fail('Cannot guarantee preview-only deployment. No deployment attempted.');
if (!/^[a-z0-9-]+\.pages\.dev$/.test(pages.subdomain) ||
  origin !== `https://${branch}.${pages.subdomain}`) {
  fail('Preview origin does not match the verified Pages project subdomain. No deployment attempted.');
}
const configs = pages.deployment_configs || {};
const existingIds = [
  ...Object.values(configs.production?.d1_databases || {}).map(value => value?.id),
  configs.preview?.d1_databases?.ORDERS_DB?.id
].filter(Boolean);
if (existingIds.includes(databaseId)) fail('Test database is already used by production or Square. No deployment attempted.');
for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
  if (configs.preview?.env_vars?.[name]?.type !== 'secret_text') {
    fail(`Missing encrypted PREVIEW secret ${name}. No deployment attempted.`);
  }
}
const directory = mkdtempSync(join(tmpdir(), 'aiva-stripe-preview-'));
try {
  const config = join(directory, 'wrangler.toml');
  writeFileSync(config, [
    `name = "${project}"`,
    'compatibility_date = "2025-11-01"',
    `pages_build_output_dir = ${JSON.stringify(root)}`,
    '[vars]',
    'CHECKOUT_PROVIDER = "stripe"',
    'STRIPE_TEST_CHECKOUT_ENABLED = "true"',
    `STRIPE_TEST_ORIGIN = ${JSON.stringify(origin)}`,
    '[[d1_databases]]',
    'binding = "STRIPE_TEST_ORDERS_DB"',
    'database_name = "aiva_stripe_test_orders"',
    `database_id = ${JSON.stringify(databaseId)}`
  ].join('\n') + '\n', { mode: 0o600 });
  const result = spawnSync('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', root,
    '--config', config, `--project-name=${project}`, `--branch=${branch}`,
    '--commit-dirty=true'], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.error || result.status !== 0) fail('Stripe test preview deployment failed. Production was not requested.');
  console.log('Stripe preview deployed. Verify the preview endpoints; production was not requested.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
