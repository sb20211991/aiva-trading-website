// Pages rejects --config. Give it an isolated working directory containing its
// normal config, Functions and public assets, separate from the existing Worker.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function preparePagesDeployment({ directory = join(root, '.pages-deploy'), overrides = {} } = {}) {
  directory = resolve(directory);
  if (directory !== resolve(root, '.pages-deploy') &&
      existsSync(directory) && readdirSync(directory).length) {
    throw Error('Refusing to replace a nonempty custom deployment directory.');
  }
  const config = JSON.parse(execFileSync('python3', ['-c',
    'import json,tomllib; print(json.dumps(tomllib.load(open("wrangler.toml","rb"))))'
  ], { cwd: root, encoding: 'utf8' }));
  const vars = { ...config.vars, ...overrides.vars };
  const databases = [...new Map([...(config.d1_databases || []), ...(overrides.d1_databases || [])]
    .map(binding => [binding.binding, binding])).values()];
  Object.assign(config, overrides, { vars, d1_databases: databases, pages_build_output_dir: 'public' });
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  cpSync(join(root, '.pages-output'), join(directory, 'public'), { recursive: true });
  cpSync(join(root, 'functions'), join(directory, 'functions'), { recursive: true });
  mkdirSync(join(directory, 'assets'));
  cpSync(join(root, 'assets/aiva-money.js'), join(directory, 'assets/aiva-money.js'));
  writeFileSync(join(directory, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  if (existsSync(join(directory, 'public/functions')) || existsSync(join(directory, 'public/merchant-tools'))) {
    throw Error('Refusing a Pages upload containing backend or merchant-administration files.');
  }
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePagesDeployment();
  console.log('Isolated Pages deployment prepared; existing Worker configuration is unchanged.');
}
