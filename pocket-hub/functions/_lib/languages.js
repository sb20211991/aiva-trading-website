/* Languages offered by Aiva in-app translation.
   The 14 original languages (CORE, matching LANG in public/app.js, checked by test/hub-test.mjs) are always offered.
   Every other catalogue language is offered only once scripts/verify-languages.mjs has confirmed, against the live
   engine before deploy, that it really translates (STATUS.text) and, for voice output, really speaks (STATUS.voice).
   Regional and dialect entries (VARIANTS) are offered when their base language is. */
import { CORE, WORLD, VARIANTS, REGIONS, WHISPER } from './language-catalog.js';
import { STATUS } from './language-status.js';

export { CORE, WORLD, VARIANTS, REGIONS, WHISPER, STATUS };
export const CORE_CODES = CORE.map((r) => r[0]);

/* Builds the offered sets from a verification status (exported so tests can check any status). */
export function buildLanguages(status = STATUS) {
  const verified = new Set(status && Array.isArray(status.text) ? status.text : []);
  const rows = [];
  for (const [code, name, region, speech] of CORE) rows.push({ code, name, region, speech, engine: code, core: true });
  for (const [code, name, region, speech] of WORLD) {
    if (verified.has(code) && !CORE_CODES.includes(code)) rows.push({ code, name, region, speech, engine: code, core: false });
  }
  const offered = new Set(rows.map((r) => r.engine));
  for (const [code, name, speech, via] of VARIANTS) {
    if (offered.has(via)) rows.push({ code, name, region: rows.find((r) => r.engine === via).region, speech, engine: via, core: false, variant: true });
  }
  const targets = new Set(rows.map((r) => r.code));
  return { rows, targets, sources: new Set(['auto', ...targets]), engine: Object.fromEntries(rows.map((r) => [r.code, r.engine])) };
}

const BUILT = buildLanguages();
export const LANGUAGES = BUILT.rows;
export const SOURCES = BUILT.sources;
export const TARGETS = BUILT.targets;
/* Engine code for an offered code (a dialect entry translates through its base language). */
export const engineCode = (code) => (code === 'auto' ? 'auto' : BUILT.engine[code] || code);
