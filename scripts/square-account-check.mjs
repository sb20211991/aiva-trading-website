#!/usr/bin/env node
/**
 * Read-only Square sandbox readiness check. Prints no secret values.
 * Requires SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID + SQUARE_ENVIRONMENT=sandbox.
 */
const present = (n) => typeof process.env[n] === 'string' && process.env[n].trim().length > 0;

async function main() {
  console.log('Square account readiness check (read-only)');
  for (const name of [
    'SQUARE_ACCESS_TOKEN',
    'SQUARE_LOCATION_ID',
    'SQUARE_ENVIRONMENT',
    'SQUARE_WEBHOOK_SIGNATURE_KEY',
    'SQUARE_WEBHOOK_NOTIFICATION_URL'
  ]) {
    console.log(`- ${name}: ${present(name) ? 'SET' : 'MISSING'}`);
  }

  if (!present('SQUARE_ACCESS_TOKEN') || !present('SQUARE_LOCATION_ID') || !present('SQUARE_ENVIRONMENT')) {
    console.log('\nCannot query Square until the three core Square secrets are set.');
    console.log('See MISSING-CONFIG.txt');
    process.exitCode = 2;
    return;
  }

  const env = process.env.SQUARE_ENVIRONMENT.trim().toLowerCase();
  if (env === 'production' || env === 'live') {
    console.log('\nRefusing to run this helper against production from the agent.');
    console.log('Set SQUARE_ENVIRONMENT=sandbox for automated checks.');
    process.exitCode = 2;
    return;
  }

  const base = 'https://connect.squareupsandbox.com';
  const headers = {
    Authorization: 'Bearer ' + process.env.SQUARE_ACCESS_TOKEN.trim(),
    'Square-Version': '2025-10-16'
  };

  const locRes = await fetch(
    base + '/v2/locations/' + encodeURIComponent(process.env.SQUARE_LOCATION_ID.trim()),
    { headers }
  );
  const locData = await locRes.json().catch(() => ({}));
  if (!locRes.ok) {
    console.log('Location lookup failed. HTTP', locRes.status);
    console.log('Check that the sandbox access token and location id match.');
    process.exitCode = 1;
    return;
  }

  const location = locData.location || {};
  console.log('\nSandbox location');
  console.log('- status:', location.status || 'unknown');
  console.log('- country:', location.country || 'n/a');
  console.log('- currency:', location.currency || 'n/a');
  console.log(
    '- capabilities:',
    Array.isArray(location.capabilities) ? location.capabilities.join(', ') : 'n/a'
  );
  console.log(
    '- card processing:',
    Array.isArray(location.capabilities) && location.capabilities.includes('CREDIT_CARD_PROCESSING')
      ? 'YES'
      : 'NO / unknown'
  );

  console.log('\nBank payouts / business verification');
  console.log('- Cannot be confirmed from API tokens alone in this environment.');
  console.log('- Check Square Dashboard → Balances / Banking and any verification prompts.');
  console.log('- Website checkout does NOT require a physical Square card reader.');
  console.log('- Apple Pay / Google Pay appear on Square-hosted Checkout when eligible.');
  console.log('- Tap to Pay on iPhone Active = in-person POS only; it does not configure');
  console.log('  aivatrading.uk Payment Links, webhooks, or Cloudflare Functions by itself.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
