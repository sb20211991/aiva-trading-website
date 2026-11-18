/* Explicit, reviewed CLOSED-SHOP release only. Never changes DNS or enables payments. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyProductionTarget(project, domain, origin) {
  assert.equal(origin, 'https://aivatrading.uk', 'Only the owner-requested root website is permitted.');
  assert.equal(project.name, 'aiva-trading', 'Unexpected Pages project.');
  assert.equal(project.production_branch, 'main', 'Production branch changed; review the deployment setup.');
  assert.ok(project.domains?.includes('aivatrading.uk'), 'Root domain is not attached to this Pages project.');
  assert.equal(domain.name, 'aivatrading.uk', 'Custom domain does not match.');
  assert.equal(domain.status, 'active', 'Root custom domain is not active.');
}

async function main() {
  const env = process.env;
  assert.equal(env.APPROVE_PRODUCTION_DEPLOYMENT, 'true', 'Owner production-deployment approval is required.');
  const sha = env.REVIEWED_COMMIT_SHA || '';
  assert.match(sha, /^[a-f0-9]{40}$/, 'Specify the exact reviewed commit.');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha,
    'Checkout differs from the reviewed commit.');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '',
    'Uncommitted files are not covered by approval.');
  const config = JSON.parse(execFileSync('python3', ['-c',
    'import json,tomllib; print(json.dumps(tomllib.load(open("wrangler.toml","rb"))))'
  ], { encoding: 'utf8' }));
  assert.equal(config.name, 'aiva-trading');
  assert.equal(config.vars?.STRIPE_MODE, 'test');
  assert.equal(config.vars?.STRIPE_LIVE_PAYMENTS_APPROVED, 'false');
  assert.equal(config.vars?.STRIPE_TEST_CHECKOUT_ENABLED, 'false');
  const catalogue = JSON.parse(readFileSync('data/aiva-products.json', 'utf8'));
  assert.equal(catalogue.shopEnabled, false, 'This initial production release must keep sales closed.');
  assert.deepEqual(catalogue.products, [], 'Do not replace or publish a populated catalogue with this closed-shop release.');
  assert.match(env.CLOUDFLARE_ACCOUNT_ID || '', /^[a-fA-F0-9]{32}$/);
  assert.ok(env.CLOUDFLARE_API_TOKEN, 'Cloudflare encrypted deployment secret missing.');
  const api = 'https://api.cloudflare.com/client/v4/accounts/' +
    env.CLOUDFLARE_ACCOUNT_ID + '/pages/projects/aiva-trading';
  async function get(url) {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN },
      signal: AbortSignal.timeout(20000)
    });
    assert.ok(response.ok, 'Cloudflare target verification failed: HTTP ' + response.status);
    const payload = await response.json();
    assert.equal(payload.success, true, 'Cloudflare did not confirm the target.');
    return payload.result;
  }
  const project = await get(api);
  const domain = await get(api + '/domains/aivatrading.uk');
  verifyProductionTarget(project, domain, env.EXPECTED_PRODUCTION_ORIGIN || '');
  const previous = project.deployment_configs?.production?.env_vars || {};
  assert.notEqual(previous.STRIPE_LIVE_PAYMENTS_APPROVED?.value, 'true',
    'Production already has live-payment approval; do not overwrite it with this initial release.');
  execFileSync('node', ['scripts/build-pages-assets.mjs'], {
    stdio: 'inherit', env: { ...env, GITHUB_SHA: sha }
  });
  execFileSync('npx', ['--yes', 'wrangler@4.164.0', 'pages', 'deploy', '.pages-output',
    '--project-name=aiva-trading', '--branch=' + project.production_branch,
    '--commit-hash=' + sha, '--commit-message=Approved closed-shop release',
    '--commit-dirty=false'], { stdio: 'inherit' });
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    try {
      const proof = await fetch('https://aivatrading.uk/deployment.json?revision=' + sha,
        { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const status = await fetch('https://aivatrading.uk/api/shop-status',
        { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const metadata = await proof.json();
      const data = await status.json();
      if (proof.ok && status.ok && metadata.revision === sha && data.ready === false &&
        data.shopEnabled === false && data.publishedProducts === 0 && data.mode !== 'live') {
        console.log('VERIFIED: reviewed revision serves the root website; public checkout and real charges remain disabled.');
        return;
      }
    } catch { /* A previous route or cache can still be serving. Never claim success from HTTP 200 alone. */ }
  }
  throw Error('Pages upload finished, but the reviewed revision is NOT verified on aivatrading.uk. Inspect routing; do not enable payments.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('PRODUCTION RELEASE BLOCKED:', error.message); process.exitCode = 1; });
}
