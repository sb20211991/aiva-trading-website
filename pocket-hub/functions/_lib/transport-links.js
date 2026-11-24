/* Hand-off links for booking transport with the operator that actually sells it (Aiva does not resell taxis or tickets).
   Directions open in Amap in mainland China, where Google Maps is unavailable, and in Google Maps everywhere else. */
const enc = encodeURIComponent;

const RAIL = {
  cn: ['China Railway 12306', 'https://www.12306.cn/en/index.html'],
  hk: ['MTR', 'https://www.mtr.com.hk/en/customer/main/index.html'],
  gb: ['National Rail', 'https://www.nationalrail.co.uk/'],
  ie: ['Irish Rail', 'https://www.irishrail.ie/'],
  fr: ['SNCF Connect', 'https://www.sncf-connect.com/en-en/'],
  de: ['Deutsche Bahn', 'https://int.bahn.de/en'],
  it: ['Trenitalia', 'https://www.trenitalia.com/en.html'],
  es: ['Renfe', 'https://www.renfe.com/es/en'],
  pt: ['CP Comboios de Portugal', 'https://www.cp.pt/'],
  nl: ['NS', 'https://www.ns.nl/en'],
  be: ['SNCB', 'https://www.belgiantrain.be/en'],
  ch: ['SBB', 'https://www.sbb.ch/en'],
  at: ['ÖBB', 'https://www.oebb.at/en/'],
  dk: ['DSB', 'https://www.dsb.dk/en/'],
  se: ['SJ', 'https://www.sj.se/en'],
  no: ['Vy', 'https://www.vy.no/en'],
  pl: ['PKP Intercity', 'https://www.intercity.pl/en/'],
  us: ['Amtrak', 'https://www.amtrak.com/'],
  in: ['IRCTC', 'https://www.irctc.co.in/'],
  kr: ['Korail', 'https://www.letskorail.com/']
};

const RIDE_SITE = {
  DiDi: 'https://www.didiglobal.com/', Grab: 'https://www.grab.com/', Bolt: 'https://bolt.eu/', Careem: 'https://www.careem.com/',
  FREENOW: 'https://www.free-now.com/', Ola: 'https://www.olacabs.com/', Cabify: 'https://cabify.com/', Gojek: 'https://www.gojek.com/',
  Heetch: 'https://www.heetch.com/', BiTaksi: 'https://www.bitaksi.com/', 'Kakao T': 'https://www.kakaomobility.com/', GO: 'https://go.goinc.jp/'
};

export function rideLink(name, a, b, dest = '') {
  if (name === 'Uber') return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${a.lat}&pickup[longitude]=${a.lon}&dropoff[latitude]=${b.lat}&dropoff[longitude]=${b.lon}&dropoff[nickname]=${enc(dest)}`;
  if (name === 'Lyft') return `https://lyft.com/ride?id=lyft&pickup[latitude]=${a.lat}&pickup[longitude]=${a.lon}&destination[latitude]=${b.lat}&destination[longitude]=${b.lon}`;
  return RIDE_SITE[name] || '';
}

const AMAP = { drive: 'car', transit: 'bus', walk: 'walk' };
const GMAP = { drive: 'driving', transit: 'transit', walk: 'walking' };
const GSUB = { train: 'train', metro: 'subway', tram: 'tram', bus: 'bus' };

export function directionsLink(cc, a, b, how, sub, names = {}) {
  if (String(cc).toLowerCase() === 'cn')
    return `https://uri.amap.com/navigation?from=${a.lon},${a.lat},${enc(names.from || 'Start')}&to=${b.lon},${b.lat},${enc(names.to || 'Destination')}&mode=${AMAP[how]}&policy=1&coordinate=wgs84&callnative=1&src=aiva`;
  return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=${GMAP[how]}${sub && GSUB[sub] ? `&transit_mode=${GSUB[sub]}` : ''}`;
}

/* { mode: { book: [{ label, url, kind: 'book' | 'directions' }], tip } } for every transport mode */
export function transportLinks(cc, a, b, names = {}, rides = []) {
  cc = String(cc || '').toLowerCase();
  const cn = cc === 'cn', app = cn ? 'Amap' : 'Google Maps';
  const dir = (how, sub, label) => ({ label: label || `Route & live times in ${app}`, url: directionsLink(cc, a, b, how, sub, names), kind: 'directions' });
  const ride = rides.map((n) => ({ label: `Book with ${n}`, url: rideLink(n, a, b, names.to), kind: 'book' })).filter((x) => x.url);
  if (cn) ride.push({ label: 'Book a taxi in Amap', url: directionsLink(cc, a, b, 'drive', '', names), kind: 'book' });
  const rail = RAIL[cc], pay = cn ? 'Pay at the gate with Alipay or WeChat Pay, or buy a single ticket at the station machine.' : '';
  return {
    taxi: { book: [...ride, dir('drive', '', `Driving route in ${app}`)], tip: 'Official taxis queue at the airport taxi rank; the fare is metered. Ride apps show the price before you book.' },
    ride: { book: ride, tip: 'The app shows the exact fare and the airport pick-up point before you confirm.' },
    car: { book: [...(cn ? [] : [{ label: 'Compare car hire', url: 'https://www.rentalcars.com/', kind: 'book' }]), dir('drive', '', `Driving route in ${app}`)], tip: cn ? 'Driving in mainland China requires a Chinese driving licence; foreign and international permits are not accepted. Book a taxi or DiDi instead.' : 'Bring your driving licence and a credit card in the driver’s name.' },
    train: { book: [...(rail ? [{ label: `Buy tickets: ${rail[0]}`, url: rail[1], kind: 'book' }] : []), dir('transit', 'train')], tip: pay },
    metro: { book: [dir('transit', 'metro')], tip: pay },
    tram: { book: [dir('transit', 'tram')], tip: pay },
    bus: { book: [dir('transit', 'bus')], tip: pay },
    walk: { book: [dir('walk', '', `Walking directions in ${app}`)], tip: '' }
  };
}
