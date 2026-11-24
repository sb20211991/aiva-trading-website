/* The transfers and journey-planner replies describe every mode, including a comparison-site link for car hire.
   Aiva now prices and books car hire itself, so the /api middleware must strip every outbound booking link for
   car hire as well as for train, tram and metro, and must leave taxi, ride-hailing, bus and walking alone. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';

const link = (mode) => ({ label: `${mode} link`, url: `https://example.com/${mode}`, kind: 'book' });
const reply = () => ({
  links: { car: { book: [link('car')], tip: 'bring a licence' }, taxi: { book: [link('taxi')], tip: 'metered' } },
  modes: {
    car: { book: [link('car')], tip: 'bring a licence', minutes: 40 },
    train: { book: [link('train')], tip: '' },
    metro: { book: [link('metro')], tip: '' },
    tram: { book: [link('tram')], tip: '' },
    bus: { book: [link('bus')], tip: 'pay on board' }
  }
});

const run = async (path, body) => {
  const ctx = {
    request: new Request('https://app.aivatrading.uk' + path),
    next: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  };
  return (await onRequest(ctx)).json();
};

test('car hire leaves no outbound booking link, taxi and bus keep theirs', async () => {
  for (const path of ['/api/travel/transfers', '/api/emergency/plan']) {
    const out = await run(path, reply());
    assert.deepEqual(out.links.car.book, [], `${path} links.car`);
    assert.equal(out.links.car.tip, '', `${path} links.car tip`);
    for (const mode of ['car', 'train', 'metro', 'tram']) {
      assert.deepEqual(out.modes[mode].book, [], `${path} modes.${mode}`);
      assert.equal(out.modes[mode].tip, '', `${path} modes.${mode} tip`);
    }
    assert.equal(out.modes.car.minutes, 40, 'the driving estimate stays');
    assert.equal(out.links.taxi.book.length, 1);
    assert.equal(out.modes.bus.book.length, 1);
    assert.equal(out.modes.bus.tip, 'pay on board');
  }
});

test('other routes and non-JSON replies pass through untouched', async () => {
  const out = await run('/api/shop-status', reply());
  assert.equal(out.links.car.book.length, 1);
  const ctx = { request: new Request('https://app.aivatrading.uk/api/travel/transfers'), next: async () => new Response('plain', { headers: { 'content-type': 'text/plain' } }) };
  assert.equal(await (await onRequest(ctx)).text(), 'plain');
});
