import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePagesDeployment } from './prepare-pages-deploy.mjs';
const originalWorker = readFileSync('wrangler.jsonc', 'utf8');
execFileSync(process.execPath, ['scripts/build-pages-assets.mjs'], { stdio: 'inherit' });
const directory = mkdtempSync(join(tmpdir(), 'aiva-pages-staging-test-'));
try {
  preparePagesDeployment({ directory, overrides: {
    vars: { STRIPE_TEST_CHECKOUT_ENABLED: 'true', STRIPE_TEST_ORIGIN: 'https://stripe-test.aiva-trading.pages.dev' },
    d1_databases: [{ binding: 'STRIPE_TEST_ORDERS_DB', database_name: 'synthetic_test_database',
      database_id: '00000000-0000-4000-8000-000000000001' }]
  } });
  const config = JSON.parse(readFileSync(join(directory, 'wrangler.json'), 'utf8'));
  assert.equal(config.name, 'aiva-trading');
  assert.equal(config.pages_build_output_dir, 'public');
  assert.equal(config.vars.STRIPE_MODE, 'test');
  assert.equal(config.vars.STRIPE_LIVE_PAYMENTS_APPROVED, 'false');
  assert.ok(config.d1_databases.some(binding => binding.binding === 'ORDERS_DB'));
  assert.ok(config.d1_databases.some(binding => binding.binding === 'STRIPE_TEST_ORDERS_DB'));
  assert.ok(existsSync(join(directory, 'functions/_middleware.js')));
  assert.ok(existsSync(join(directory, 'functions/api/stripe-webhook.js')));
  assert.ok(existsSync(join(directory, 'assets/aiva-money.js')));
  for (const path of ['functions', 'merchant-tools', 'wrangler.jsonc', '.github']) {
    assert.equal(existsSync(join(directory, 'public', path)), false, 'Private staged asset: ' + path);
  }
  assert.equal(readFileSync('wrangler.jsonc', 'utf8'), originalWorker);
  assert.throws(() => preparePagesDeployment({ directory }), /nonempty custom/);
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('PAGES STAGING CHECKS PASSED: normal config discovery, private Functions, preserved bindings and no custom --config flag.');
