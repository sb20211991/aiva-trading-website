/* Ferry ticket sales for Aiva Ferry. Aiva does not sell ferry tickets yet: sales need a signed B2B agreement with
   an authorised ferry distributor. Two official partner programmes exist:
     - Ferryhopper's B2B ferry API (FerryhAPI), which states it covers schedules, prices and booking/ticketing,
       across 130+ operators in 30+ countries.
     - Direct Ferries Connect, the B2B partner brand of Direct Ferries, which lists 230 operators and 4,000+ routes,
       joined through its partner programme.
   Public pages are not an integration: there is no scraping of either site.

   Until a contract is signed, salesStatus() reports unavailable, and the app shows ferry times with no price and no
   payment button. When the contract exists, two bindings connect it, following the same pattern as Aiva Train:
     FERRY_SALES_GATEWAY_URL   https origin of the distributor gateway
     FERRY_SALES_GATEWAY_KEY   secret sent as the X-API-Key header (Cloudflare Pages secret) */
export const FERRY_DISTRIBUTORS = [
  { name: 'Ferryhopper', product: 'FerryhAPI (B2B ferry API)', scope: '130+ operators across 30+ countries', url: 'https://partners.ferryhopper.com/ferryhapi' },
  { name: 'Direct Ferries Connect', product: 'Partner API and agent portal', scope: '230 operators and 4,000+ routes', url: 'https://fca.directferries.com/affiliate.htm' }
];

/* What a ferry distributor must return before Aiva sells a crossing, so the traveller sees the real terms before paying. */
export const FERRY_REQUIRED_DATA = ['price and currency per passenger type', 'live availability', 'luggage and baggage allowance', 'vehicle options and prices', 'cabin and seat options', 'ticket conditions (changes, cancellation, refund)', 'ticket or boarding pass delivery'];

export function salesStatus(env) {
  const url = String(env?.FERRY_SALES_GATEWAY_URL || '').trim();
  const key = String(env?.FERRY_SALES_GATEWAY_KEY || '').trim();
  if (url && key && /^https:\/\//.test(url)) {
    return { available: true, provider: String(env?.FERRY_SALES_PROVIDER || 'ferry distributor').slice(0, 80), paymentMethods: ['card', 'apple_pay', 'google_pay'] };
  }
  return {
    available: false, provider: '', paymentMethods: [],
    reason: 'Ferry prices and sales need an authorised ferry distributor. Aiva shows ferry times without a price until that agreement and its API credentials exist.',
    requirement: 'A signed B2B agreement and its API credentials, set as FERRY_SALES_GATEWAY_URL and the FERRY_SALES_GATEWAY_KEY secret.',
    distributors: FERRY_DISTRIBUTORS, requiredData: FERRY_REQUIRED_DATA
  };
}
