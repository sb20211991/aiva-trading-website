#!/usr/bin/env node
/* Pages deploy does not honor .assetsignore. Build an explicit upload directory.
   No deployment, credentials, or configuration changes are performed here. */
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = join(root, '.pages-output');
if (existsSync(join(root, '_worker.js'))) throw Error('Refusing to package a root _worker.js.');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const copy = (relative) => {
  const source = join(root, relative);
  if (!statSync(source).isFile()) throw Error('Expected regular file: ' + relative);
  mkdirSync(resolve(output, relative, '..'), { recursive: true });
  copyFileSync(source, join(output, relative));
};
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && /^[a-z0-9-]+\.html$/.test(entry.name)) copy(entry.name);
}
for (const relative of ['robots.txt', 'sitemap.xml', '_headers', '_routes.json',
  'data/aiva-products.json', 'data/aiva-products.stripe-test.json']) copy(relative);
for (const entry of readdirSync(join(root, 'assets'), { withFileTypes: true })) {
  if (entry.isFile() && /^[a-zA-Z0-9_-]+\.(css|js|svg|webp|png|jpe?g|avif|gif|woff2?)$/.test(entry.name)) {
    copy('assets/' + entry.name);
  }
}
copy('assets/aiva-qr-license.txt');
copyFileSync(fileURLToPath(import.meta.resolve('qrcode-generator')), join(output, 'assets/aiva-qr-encoder.js'));
// Backend and merchant sources are never ordinary public assets. The Pages
// deployment preparer supplies Functions beside, not inside, the asset folder.
for (const excluded of ['.github', '.git', '.dev.vars', '.env', '_archive', 'README.md',
  'STRIPE-TEST-SETUP.md', 'wrangler.toml', 'wrangler.jsonc', 'functions', 'workers', 'merchant-tools',
  'scripts', 'package.json', 'ORDER-DATABASE-SETUP.sql']) {
  assert.equal(existsSync(join(output, excluded)), false, 'Private source copied: ' + excluded);
}
for (const required of ['index.html', 'shop.html', 'assets/aiva-commerce.js', 'assets/aiva-money.js']) {
  assert.ok(existsSync(join(output, required)), 'Missing deployment file: ' + required);
}
console.log('Pages upload directory built and checked: .pages-output (no repository metadata, scripts, docs or archives).');
let revision = process.env.GITHUB_SHA || process.env.WORKERS_CI_COMMIT_SHA || '';
if (!/^[a-f0-9]{40}$/.test(revision)) {
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { revision = 'unreleased'; }
}
writeFileSync(join(output, 'deployment.json'), JSON.stringify({
  revision: /^[a-f0-9]{40}$/.test(revision) ? revision : 'unreleased'
}) + '\n');
