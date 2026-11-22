/* Ride-hailing apps with a well-known service in each country (ISO 3166-1 alpha-2). Coverage differs by city and
   airport, so the app labels these as "operates in this country" and never shows a fare it has not received. */
const RIDES = {
  gb: ['Uber', 'Bolt', 'FREENOW'], ie: ['Uber', 'Bolt', 'FREENOW'], fr: ['Uber', 'Bolt', 'Heetch', 'FREENOW'], de: ['Uber', 'Bolt', 'FREENOW'],
  es: ['Uber', 'Bolt', 'Cabify', 'FREENOW'], pt: ['Uber', 'Bolt'], it: ['Uber', 'FREENOW'], nl: ['Uber', 'Bolt'], be: ['Uber', 'Bolt'],
  ch: ['Uber'], at: ['Uber', 'Bolt'], pl: ['Uber', 'Bolt', 'FREENOW'], no: ['Uber', 'Bolt'], se: ['Uber', 'Bolt'], fi: ['Uber', 'Bolt'],
  cz: ['Uber', 'Bolt'], gr: ['Uber', 'FREENOW'], us: ['Uber', 'Lyft'], ca: ['Uber', 'Lyft'], mx: ['Uber', 'DiDi'], br: ['Uber', '99'],
  ae: ['Uber', 'Careem'], sa: ['Uber', 'Careem'], qa: ['Uber', 'Careem'], eg: ['Uber', 'Careem'], in: ['Uber', 'Ola'], cn: ['DiDi'],
  hk: ['Uber'], jp: ['GO', 'Uber'], kr: ['Kakao T'], sg: ['Grab', 'Gojek'], my: ['Grab'], th: ['Grab', 'Bolt'], id: ['Grab', 'Gojek'],
  vn: ['Grab'], ph: ['Grab'], au: ['Uber', 'DiDi'], nz: ['Uber'], za: ['Uber', 'Bolt'], ng: ['Uber', 'Bolt'], ke: ['Uber', 'Bolt'], tr: ['BiTaksi', 'Uber']
};
export const rideHailing = (cc) => RIDES[String(cc || '').toLowerCase()] || [];
