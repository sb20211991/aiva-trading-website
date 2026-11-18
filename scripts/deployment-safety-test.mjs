import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const workerGuard = spawnSync(process.execPath, ['scripts/worker-preview-guard.mjs'], {
  encoding: 'utf8', env: { PATH: process.env.PATH, WORKERS_CI_BRANCH: 'main' }
});
assert.equal(workerGuard.status, 1);
assert.match(workerGuard.stderr, /production publication is blocked/);
const workerConfig = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
assert.equal(workerConfig.name, 'black-scene-993d');
assert.equal(workerConfig.vars.STRIPE_LIVE_PAYMENTS_APPROVED, 'false');
assert.equal(workerConfig.vars.STRIPE_MODE, 'test');
assert.ok(workerConfig.unsafe.metadata.keep_bindings.includes('d1'));
assert.ok(workerConfig.unsafe.metadata.keep_bindings.includes('secret_text'));
for (const name of ['bind-and-deploy', 'finish-infra', 'reactivate-apex', 'safe-redeploy', 'probe-kv']) {
  const source = readFileSync('.github/workflows/cloudflare-' + name + '.yml', 'utf8');
  assert.match(source, /if: \$\{\{ false \}\}/, 'Legacy infrastructure workflow could mutate resources: ' + name);
}
console.log('PRODUCTION SAFETY CHECKS PASSED — no deployment or configuration mutation attempted.');
