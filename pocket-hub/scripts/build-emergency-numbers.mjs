/* Builds public/emergency-numbers.json from Wikipedia's "List of emergency telephone numbers" (each row cites ITU-T E.129,
   embassies or national authorities). Run: node scripts/build-emergency-numbers.mjs. Numbers are copied, never guessed. */
import { writeFileSync } from 'node:fs';

const PAGE = 'List_of_emergency_telephone_numbers';
const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${PAGE}&prop=wikitext|revid&format=json&formatversion=2`;
const res = await fetch(api, { headers: { 'User-Agent': 'AivaPocketHub/1.1 (+https://app.aivatrading.uk)' } });
const { parse } = await res.json();
let t = parse.wikitext.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');

const names = new Intl.DisplayNames(['en'], { type: 'region' });
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^the /, '').replace(/[^a-z]/g, '');
const byName = {};
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const c = String.fromCharCode(a, b), n = names.of(c);
  if (n && n !== c && !/^(EU|EZ|UN|QO|XA|XB|ZZ|FX|AN|BU|CS|DD|NT|SU|TP|YD|YU|ZR|RH|NH|VD|DY|HV|AC|CP|DG|EA|IC|TA|CQ)$/.test(c) && !byName[norm(n)]) byName[norm(n)] = c;
}
const ALIAS = { unitedstatesofamerica: 'US', peoplesrepublicofchina: 'CN', republicofchina: 'TW', taiwan: 'TW', republicofkorea: 'KR', southkorea: 'KR', northkorea: 'KP',
  democraticpeoplesrepublicofkorea: 'KP', russia: 'RU', czechrepublic: 'CZ', czechia: 'CZ', ivorycoast: 'CI', cotedivoire: 'CI', vatican: 'VA', vaticancity: 'VA', holysee: 'VA',
  republicofthecongo: 'CG', congo: 'CG', democraticrepublicofthecongo: 'CD', burma: 'MM', myanmar: 'MM', eswatini: 'SZ', swaziland: 'SZ', turkey: 'TR', turkiye: 'TR',
  macau: 'MO', macao: 'MO', hongkong: 'HK', palestine: 'PS', stateofpalestine: 'PS', easttimor: 'TL', timorleste: 'TL', capeverde: 'CV', caboverde: 'CV', northmacedonia: 'MK',
  micronesia: 'FM', federatedstatesofmicronesia: 'FM', bahamas: 'BS', gambia: 'GM', netherlands: 'NL', kingdomofthenetherlands: 'NL', unitedkingdom: 'GB',
  saintkittsandnevis: 'KN', saintlucia: 'LC', saintvincentandthegrenadines: 'VC', saotomeandprincipe: 'ST', bosniaandherzegovina: 'BA', trinidadandtobago: 'TT',
  antiguaandbarbuda: 'AG', caribbeannetherlands: 'BQ', curacao: 'CW', sintmaarten: 'SX', usvirginislands: 'VI', unitedstatesvirginislands: 'VI', britishvirginislands: 'VG',
  falklandislands: 'FK', faroeislands: 'FO', laos: 'LA', moldova: 'MD', syria: 'SY', iran: 'IR', vietnam: 'VN', brunei: 'BN', bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ', kosovo: 'XK',
  republicofcongo: 'CG', democraticrepublicofcongo: 'CD', turksandcaicos: 'TC', turksandcaicosislands: 'TC', saintbarthelemy: 'BL', saintmartin: 'MF', sainthelena: 'SH',
  wallisandfutuna: 'WF', saintpierreandmiquelon: 'PM', cocoskeelingislands: 'CC', norfolkisland: 'NF', pitcairnislands: 'PN', svalbard: 'SJ', svalbardandjanmayen: 'SJ' };
const code = (n) => ALIAS[norm(n)] || byName[norm(n)] || '';

const plain = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^{}]*\}\}/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/'''?/g, '');
const numbers = (s) => [...new Set([...String(s).matchAll(/'''([^']+)'''/g)].flatMap((m) => plain(m[1]).split(/\s*(?:or|,|\/|;)\s*/))
  .map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => /^[#*]?\d[\d ]{1,9}\d$|^\d{2,3}$/.test(x)))].slice(0, 4);

const out = {}, skipped = [];
for (const row of t.split('\n|-')) {
  const cells = [];
  for (const line of row.split('\n')) {
    if (line.startsWith('|}')) break;
    if (line.startsWith('!')) { cells.length = 0; break; }
    if (line.startsWith('|') && !/^\|[}+]/.test(line)) cells.push(...line.slice(1).split('||'));
    else if (cells.length) cells[cells.length - 1] += '\n' + line;
  }
  if (cells.length < 3) continue;
  const m = /\{\{\s*(?:flag(?:icon|country|u)?)\s*\|([^}|]+)/i.exec(cells[0]);
  const name = m?.[1]?.trim(), cc = name && code(name);
  if (!cc) { skipped.push(plain(cells[0]).trim().slice(0, 40)); continue; }
  const vals = [];
  for (const c of cells.slice(1)) {
    const a = /^\s*([^|[\]{}]*=[^|]*?)\|(?!\|)([\s\S]*)$/.exec(c), attrs = a && /style|colspan|align|rowspan/.test(a[1]) ? a[1] : '';
    const span = Number(/colspan\s*=\s*"?(\d)/.exec(attrs)?.[1] || 1);
    for (let i = 0; i < span; i++) vals.push(attrs ? a[2] : c);
  }
  if (vals.length < 3) continue;
  const [police, ambulance, fire] = vals.slice(0, 3).map(numbers);
  if (!police.length && !ambulance.length && !fire.length) { skipped.push(name); continue; }
  if (out[cc]) continue;
  const general = police.filter((n) => ambulance.includes(n) && fire.includes(n));
  out[cc] = { name: names.of(cc) || name, police, ambulance, fire, ...(general.length ? { general } : {}) };
}
const data = { source: `Wikipedia: List of emergency telephone numbers (revision ${parse.revid}; rows cite ITU-T E.129, embassies and national authorities)`,
  url: `https://en.wikipedia.org/w/index.php?title=${PAGE}&oldid=${parse.revid}`, retrieved: new Date().toISOString().slice(0, 10), countries: out };
writeFileSync(new URL('../public/emergency-numbers.json', import.meta.url), JSON.stringify(data));
console.log(Object.keys(out).length, 'countries; skipped:', skipped.join(' | '));
