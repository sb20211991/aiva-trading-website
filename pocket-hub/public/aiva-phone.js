/* Aiva international phone numbers: a country picker shown as "🇬🇧 +44" (flag and ITU dialling code) and a number
   field that is normalised to the international form (+44 7700 900123): spaces and dashes removed, the national trunk
   prefix 0 dropped (except Italy, San Marino and the Vatican, whose numbers keep it), and a typed +code or 00code
   understood. Display grouping follows each country's usual pattern where one is set, otherwise groups of 3-4. */
(() => {
  /* ITU-T E.164 country calling codes by ISO 3166-1 alpha-2. NANP countries share +1. */
  const DIAL = {
    AF:'93',AX:'358',AL:'355',DZ:'213',AS:'1',AD:'376',AO:'244',AI:'1',AG:'1',AR:'54',AM:'374',AW:'297',AU:'61',AT:'43',AZ:'994',
    BS:'1',BH:'973',BD:'880',BB:'1',BY:'375',BE:'32',BZ:'501',BJ:'229',BM:'1',BT:'975',BO:'591',BQ:'599',BA:'387',BW:'267',BR:'55',
    IO:'246',VG:'1',BN:'673',BG:'359',BF:'226',BI:'257',KH:'855',CM:'237',CA:'1',CV:'238',KY:'1',CF:'236',TD:'235',CL:'56',CN:'86',
    CX:'61',CC:'61',CO:'57',KM:'269',CG:'242',CD:'243',CK:'682',CR:'506',CI:'225',HR:'385',CU:'53',CW:'599',CY:'357',CZ:'420',
    DK:'45',DJ:'253',DM:'1',DO:'1',EC:'593',EG:'20',SV:'503',GQ:'240',ER:'291',EE:'372',SZ:'268',ET:'251',FK:'500',FO:'298',FJ:'679',
    FI:'358',FR:'33',GF:'594',PF:'689',GA:'241',GM:'220',GE:'995',DE:'49',GH:'233',GI:'350',GR:'30',GL:'299',GD:'1',GP:'590',GU:'1',
    GT:'502',GG:'44',GN:'224',GW:'245',GY:'592',HT:'509',VA:'39',HN:'504',HK:'852',HU:'36',IS:'354',IN:'91',ID:'62',IR:'98',IQ:'964',
    IE:'353',IM:'44',IL:'972',IT:'39',JM:'1',JP:'81',JE:'44',JO:'962',KZ:'7',KE:'254',KI:'686',XK:'383',KW:'965',KG:'996',LA:'856',
    LV:'371',LB:'961',LS:'266',LR:'231',LY:'218',LI:'423',LT:'370',LU:'352',MO:'853',MG:'261',MW:'265',MY:'60',MV:'960',ML:'223',
    MT:'356',MH:'692',MQ:'596',MR:'222',MU:'230',YT:'262',MX:'52',FM:'691',MD:'373',MC:'377',MN:'976',ME:'382',MS:'1',MA:'212',
    MZ:'258',MM:'95',NA:'264',NR:'674',NP:'977',NL:'31',NC:'687',NZ:'64',NI:'505',NE:'227',NG:'234',NU:'683',NF:'672',KP:'850',
    MK:'389',MP:'1',NO:'47',OM:'968',PK:'92',PW:'680',PS:'970',PA:'507',PG:'675',PY:'595',PE:'51',PH:'63',PL:'48',PT:'351',PR:'1',
    QA:'974',RE:'262',RO:'40',RU:'7',RW:'250',BL:'590',SH:'290',KN:'1',LC:'1',MF:'590',PM:'508',VC:'1',WS:'685',SM:'378',ST:'239',
    SA:'966',SN:'221',RS:'381',SC:'248',SL:'232',SG:'65',SX:'1',SK:'421',SI:'386',SB:'677',SO:'252',ZA:'27',KR:'82',SS:'211',ES:'34',
    LK:'94',SD:'249',SR:'597',SJ:'47',SE:'46',CH:'41',SY:'963',TW:'886',TJ:'992',TZ:'255',TH:'66',TL:'670',TG:'228',TK:'690',TO:'676',
    TT:'1',TN:'216',TR:'90',TM:'993',TC:'1',TV:'688',UG:'256',UA:'380',AE:'971',GB:'44',US:'1',UY:'598',UZ:'998',VU:'678',VE:'58',
    VN:'84',VI:'1',WF:'681',EH:'212',YE:'967',ZM:'260',ZW:'263',
  };
  const NAMES = { XK: 'Kosovo', GB: 'United Kingdom', US: 'United States' };
  const KEEP_ZERO = new Set(['39', '378']);
  /* Usual grouping of the national number, by country (digit counts). Others: groups of 3 and a final 4. */
  const GROUP = {
    GB: (n) => (/^7/.test(n) ? [4, 6] : /^(20|23|24|28|29)/.test(n) ? [2, 4, 4] : /^1\d1|^11/.test(n) ? [3, 3, 4] : [4, 6]),
    '1': () => [3, 3, 4], FR: () => [1, 2, 2, 2, 2], DE: (n) => (/^1[5-7]/.test(n) ? [3, 8] : [3, 8]), ES: () => [3, 3, 3], IT: () => [3, 3, 4],
    IE: () => [2, 3, 4], NL: () => [1, 4, 4], BE: () => [3, 2, 2, 2], PT: () => [3, 3, 3], CH: () => [2, 3, 2, 2], AT: () => [3, 7],
    SE: () => [2, 3, 2, 2], NO: () => [3, 2, 3], DK: () => [2, 2, 2, 2], PL: () => [3, 3, 3], TR: () => [3, 3, 2, 2], IQ: () => [3, 3, 4],
    AE: () => [2, 3, 4], SA: () => [2, 3, 4], IN: () => [5, 5], PK: () => [3, 7], CN: () => [3, 4, 4], AU: () => [3, 3, 3], NZ: () => [2, 3, 4],
    JP: () => [2, 4, 4], KR: () => [2, 4, 4], BR: () => [2, 5, 4], MX: () => [2, 4, 4], ZA: () => [2, 3, 4], NG: () => [3, 3, 4], EG: () => [3, 3, 4],
  };
  const flag = (cc) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  const nameOf = (cc, fallback) => NAMES[cc] || fallback?.[cc]?.name || (() => { try { return regionNames?.of(cc); } catch { return ''; } })() || cc;

  /* Number as typed -> digits of the national significant number for this calling code. */
  function national(code, typed) {
    const raw = String(typed || '').trim();
    let d = raw.replace(/\D/g, '');
    if (raw.startsWith('+') && d.startsWith(code)) d = d.slice(code.length);
    else if (d.startsWith('00' + code)) d = d.slice(2 + code.length);
    if (!KEEP_ZERO.has(code)) d = d.replace(/^0+/, '');
    return d.slice(0, 15 - code.length);
  }
  function format(iso, code, n) {
    if (!n) return `+${code}`;
    const g = (GROUP[iso] || GROUP[code])?.(n) || (n.length > 7 ? [n.length - 7, 3, 4] : n.length > 4 ? [n.length - 4, 4] : [n.length]);
    const parts = []; let i = 0;
    for (const len of g) { if (i >= n.length) break; parts.push(n.slice(i, i + len)); i += len; }
    if (i < n.length) parts.push(n.slice(i));
    return `+${code} ${parts.filter(Boolean).join(' ')}`;
  }
  const valid = (code, n) => n.length >= 4 && code.length + n.length <= 15 && (code !== '44' || n.length >= 9) && (code !== '1' || n.length === 10);

  /* <select> options: "🇬🇧 +44" shown, full country name for screen readers and the open list. Value is the ISO code. */
  function options(selected, db) {
    const sel = String(selected || '').toUpperCase();
    return Object.keys(DIAL).map((cc) => [cc, nameOf(cc, db)]).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([cc, nm]) => `<option value="${cc}" data-dial="${DIAL[cc]}" label="${flag(cc)} +${DIAL[cc]}"${cc === sel ? ' selected' : ''}>${flag(cc)} ${nm.replace(/[<&"]/g, '')} (+${DIAL[cc]})</option>`).join('');
  }
  /* Best default country: the one saved, else the old saved dialling code, else the browser region, else GB. */
  function guess(saved, savedCode) {
    const s = String(saved || '').toUpperCase();
    if (DIAL[s]) return s;
    const c = String(savedCode || '').replace(/\D/g, '');
    if (c) { const pref = { '1': 'US', '44': 'GB', '7': 'RU', '39': 'IT', '47': 'NO', '61': 'AU', '212': 'MA', '262': 'RE', '358': 'FI', '590': 'GP', '599': 'CW' }[c]; const hit = pref || Object.keys(DIAL).find((k) => DIAL[k] === c); if (hit) return hit; }
    const reg = (navigator.language || '').split('-')[1]?.toUpperCase();
    return DIAL[reg] ? reg : 'GB';
  }
  /* Wires a country <select> and number <input> pair: the closed select shows "🇬🇧 +44", the hint shows the full number. */
  function bind(select, input, hint) {
    if (!select || !input) return;
    const paint = () => {
      const iso = select.value, code = DIAL[iso] || '';
      [...select.options].forEach((o) => { o.textContent = o.selected ? `${flag(o.value)} +${o.dataset.dial}` : `${flag(o.value)} ${nameOf(o.value)} (+${o.dataset.dial})`; });
      const n = national(code, input.value);
      if (hint) { hint.textContent = input.value.trim() ? (valid(code, n) ? `International format: ${format(iso, code, n)}` : `Check the number: ${format(iso, code, n)}`) : `Mobile number with country code +${code}`; hint.classList.toggle('bad', !!input.value.trim() && !valid(code, n)); }
    };
    select.addEventListener('focus', () => [...select.options].forEach((o) => { o.textContent = `${flag(o.value)} ${nameOf(o.value)} (+${o.dataset.dial})`; }));
    select.addEventListener('blur', paint);
    select.addEventListener('change', paint);
    input.addEventListener('input', paint);
    input.addEventListener('blur', () => {
      const code = DIAL[select.value] || '', raw = input.value.trim();
      /* A number pasted with a different +code switches the country (first match for shared codes). */
      if (raw.startsWith('+') && !raw.replace(/\D/g, '').startsWith(code)) {
        const d = raw.replace(/\D/g, ''), hit = Object.keys(DIAL).filter((k) => d.startsWith(DIAL[k])).sort((a, b) => DIAL[b].length - DIAL[a].length)[0];
        if (hit) select.value = hit === 'US' || DIAL[hit] !== '1' ? hit : 'US';
      }
      const c2 = DIAL[select.value] || '', n = national(c2, input.value);
      if (n) input.value = format(select.value, c2, n).replace(/^\+\d+\s/, '');
      paint();
    });
    paint();
  }
  window.aivaPhone = { DIAL, flag, options, guess, bind, national, format, valid, code: (iso) => DIAL[String(iso || '').toUpperCase()] || '' };
})();
