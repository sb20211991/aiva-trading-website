// Real Chromium layout/interaction checks. No external account or payment is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import worker from '../workers/entry.js';

const assets = resolve('.worker-assets');
const chrome = process.env.CHROME_BIN || ['/repl/tools/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(existsSync);
assert.ok(chrome, 'Chromium is required for real mobile-browser checks.');
assert.ok(existsSync(join(assets, 'index.html')), 'Run the asset build first.');
const rules = [];
for (const line of readFileSync(join(assets, '_headers'), 'utf8').split('\n')) {
  if (line.startsWith('/')) rules.push({ pattern: new RegExp('^' + line.trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$'), headers: {} });
  else if (/^\s+\S.*:/.test(line) && rules.length) {
    const index = line.indexOf(':');
    rules.at(-1).headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.txt': 'text/plain', '.xml': 'application/xml' };
const env = { CHECKOUT_PROVIDER: 'stripe', STRIPE_MODE: 'test', STRIPE_LIVE_PAYMENTS_APPROVED: 'false',
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname;
    let file = resolve(assets, '.' + decodeURIComponent(path));
    if (file !== assets && !file.startsWith(assets + sep)) return new Response('', { status: 404 });
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) return new Response('', { status: 404 });
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream' };
    for (const rule of rules) if (rule.pattern.test(path)) Object.assign(headers, rule.headers);
    return new Response(readFileSync(file), { headers });
  } }
};
const server = createServer(async (req, res) => {
  try {
    const request = new Request('http://127.0.0.1:' + server.address().port + req.url, {
      method: req.method, headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' })
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body && req.method !== 'HEAD') Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'aiva-chromium-'));
const browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
let socket;
const errors = [];
try {
  for (let i = 0; i < 200 && !existsSync(join(profile, 'DevToolsActivePort')); i++) {
    if (browser.exitCode !== null) throw Error('Chromium exited before its debugging connection opened.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  let loaded;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result);
    }
    if (message.method === 'Page.loadEventFired') loaded?.();
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.source === 'security') {
      errors.push(message.params.entry.text);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Browser timeout: ' + method)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const viewport = width => send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 1, mobile: width <= 1024
  });
  let checked = 0;
  for (const page of ['index.html', 'shop.html', 'company.html', 'buying-guide.html']) {
    for (const width of [320, 375, 390, 768, 1024, 1280]) {
      await viewport(width);
      const navigation = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Page load timeout: ' + page)), 20000);
        loaded = () => { clearTimeout(timer); resolve(); };
      });
      await send('Page.navigate', { url: origin + '/' + page }); await navigation;
      await evaluate('document.fonts.ready.then(() => true)');
      const layout = await evaluate(`({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        visibleMenu: !document.querySelector('.menu-toggle').hidden &&
          document.querySelector('.menu-toggle').getBoundingClientRect().width > 0,
        overflow: [...document.querySelectorAll('body *')].filter(element =>
          element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(element => ({
            tag: element.tagName, className: element.className,
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width)
          }))
      })`);
      assert.ok(layout.scroll <= layout.width + 1, page + ' overflows at ' + width + 'px: ' + JSON.stringify(layout));
      assert.equal(layout.visibleMenu, width <= 1024, page + ' wrong menu visibility at ' + width);
      if (width <= 1024) {
        const open = await evaluate(`(() => {
          const menu = document.querySelector('.menu-toggle'), nav = document.querySelector('#site-navigation');
          menu.click(); return { expanded: menu.getAttribute('aria-expanded'), hidden: nav.hidden,
            visible: nav.getBoundingClientRect().height > 0,
            targets: [...nav.querySelectorAll('a')].every(a => a.getBoundingClientRect().height >= 44),
            scroll: document.documentElement.scrollWidth, width: innerWidth };
        })()`);
        assert.equal(open.expanded, 'true'); assert.equal(open.hidden, false); assert.equal(open.visible, true);
        assert.equal(open.targets, true, page + ' has small mobile navigation targets at ' + width);
        assert.ok(open.scroll <= open.width + 1, page + ' open navigation overflows at ' + width);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
        assert.equal(await evaluate(`document.querySelector('#site-navigation').hidden &&
          document.activeElement === document.querySelector('.menu-toggle')`), true, 'Escape must close and return focus.');
      }
      checked++;
    }
  }
  assert.deepEqual(errors, [], 'Browser JavaScript or security-policy errors: ' + errors.join('; '));
  console.log('REAL CHROMIUM CHECKS PASSED: ' + checked + ' page/viewport combinations, menu taps, focus, Escape and overflow.');
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await new Promise(resolve => { if (browser.exitCode !== null) resolve(); else browser.once('exit', resolve); });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
