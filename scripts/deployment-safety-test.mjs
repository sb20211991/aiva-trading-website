import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verifyProductionTarget } from './promote-production.mjs';
const project = { name: 'aiva-trading', production_branch: 'main', domains: ['aivatrading.uk'] };
const domain = { name: 'aivatrading.uk', status: 'active' };
assert.doesNotThrow(() => verifyProductionTarget(project, domain, 'https://aivatrading.uk'));
for (const [p, d, origin] of [
  [{ ...project, domains: ['app.aivatrading.uk'] }, domain, 'https://aivatrading.uk'],
  [{ ...project, production_branch: 'unexpected' }, domain, 'https://aivatrading.uk'],
  [{ ...project, name: 'other-project' }, domain, 'https://aivatrading.uk'],
  [project, { ...domain, status: 'pending' }, 'https://aivatrading.uk'],
  [project, { ...domain, name: 'app.aivatrading.uk' }, 'https://aivatrading.uk'],
  [project, domain, 'https://foreign.invalid']
]) assert.throws(() => verifyProductionTarget(p, d, origin));
const blocked = spawnSync(process.execPath, ['scripts/promote-production.mjs'], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, APPROVE_PRODUCTION_DEPLOYMENT: 'false' }
});
assert.equal(blocked.status, 1);
assert.match(blocked.stderr, /Owner production-deployment approval is required/);
for (const name of ['bind-and-deploy', 'finish-infra', 'reactivate-apex', 'safe-redeploy', 'probe-kv', 'find-apex', 'domain-status']) {
  assert.equal(existsSync('.github/workflows/cloudflare-' + name + '.yml'), false, 'Legacy infrastructure workflow must stay removed: ' + name);
}
const deploy = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
assert.match(deploy, /branches: \[main\]/, 'Production deploys must run only from main');
assert.match(deploy, /npm test/);
assert.doesNotMatch(deploy, /LIVE_PAYMENTS_APPROVED/, 'The deploy workflow must never approve live payments');
const toml = readFileSync('wrangler.toml', 'utf8');
assert.match(toml, /SHOPIFY_LIVE_PAYMENTS_APPROVED = "false"/, 'Shopify live payments must stay false until the owner approves them');
// Square live payments were approved by the owner on 2026-11-19; they require production mode.
if (/SQUARE_LIVE_PAYMENTS_APPROVED = "true"/.test(toml)) assert.match(toml, /SQUARE_ENVIRONMENT = "production"/);
else assert.match(toml, /SQUARE_LIVE_PAYMENTS_APPROVED = "false"/);
console.log('PRODUCTION SAFETY CHECKS PASSED — no deployment or configuration mutation attempted.');
