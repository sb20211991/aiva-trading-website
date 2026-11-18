// Package the same website for the existing Worker, without exposing Functions.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/build-pages-assets.mjs'], { cwd: root, stdio: 'inherit' });
const output = join(root, '.worker-assets');
rmSync(output, { recursive: true, force: true });
mkdirSync(output);
for (const entry of readdirSync(join(root, '.pages-output'), { withFileTypes: true })) {
  if (entry.name === 'functions' || entry.name === '_routes.json') continue;
  cpSync(join(root, '.pages-output', entry.name), join(output, entry.name), { recursive: true });
}
for (const privatePath of ['functions', 'workers', 'scripts', 'merchant-tools', '.git',
  '.github', '.env', '.dev.vars', 'wrangler.toml', 'wrangler.jsonc']) {
  assert.equal(existsSync(join(output, privatePath)), false, 'Private Worker asset: ' + privatePath);
}
console.log('Worker assets built from the existing website; administration and backend source excluded.');
