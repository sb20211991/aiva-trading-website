/* Code mapping between Aiva's engine codes (Google Translate) and Microsoft Translator, used only for the optional
   Microsoft fallback. Codes that are identical in both are passed through; codes Microsoft does not publish are
   absent from MS_ONLY_KNOWN and return '' so the fallback is skipped instead of guessing. */
const TO_MS = {
  ckb: 'ku', ku: 'kmr', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', iw: 'he', tl: 'fil', 'fa-AF': 'prs', 'pt-PT': 'pt-pt',
  'fr-CA': 'fr-ca', sr: 'sr-Cyrl', mn: 'mn-Cyrl', no: 'nb', 'mni-Mtei': 'mni', ny: 'nya', rn: 'run', lg: 'lug',
  'iu-Latn': 'iu-Latn', pt: 'pt'
};
/* Microsoft Translator text languages (published list), in Microsoft codes. */
const MS = new Set(('af am ar as az ba bg bho bn bo brx bs ca cs cy da de doi dsb dv el en es et eu fa fi fil fj fo fr fr-ca ga gl gom gu ha he hi hne hr hsb ht hu hy id ig ikt is it iu iu-Latn ja ka kk km kmr kn ko ks ku ky lb ln lo lt lug lv lzh mai mg mi mk ml mn-Cyrl mn-Mong mni mr ms mt mww my nb ne nl nso nya or otq pa pl prs ps pt pt-pt ro ru run rw sd si sk sl sm sn so sq sr-Cyrl sr-Latn st sv sw ta te th ti tk tlh-Latn tn to tr tt ty ug uk ur uz vi xh yo yua yue zh-Hans zh-Hant zu').split(' '));
const FROM_MS = Object.fromEntries(Object.entries(TO_MS).map(([g, m]) => [m.toLowerCase(), g]));

export function microsoftCode(code) {
  const m = TO_MS[code] || code;
  return MS.has(m) ? m : '';
}
export function fromMicrosoft(code) {
  const c = String(code || '');
  return FROM_MS[c.toLowerCase()] || (c === 'zh-Hans' ? 'zh-CN' : c);
}
export const MICROSOFT_LANGUAGES = MS;
