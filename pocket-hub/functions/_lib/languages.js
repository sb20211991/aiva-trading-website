/* Languages offered by Aiva in-app translation. Must match LANG in public/app.js (checked by test/hub-test.mjs). */
export const SOURCES = new Set(['auto', 'en', 'ckb', 'ar', 'tr', 'fa', 'fr', 'de', 'es', 'it', 'zh-CN', 'pt', 'ru', 'ja', 'hi']);
export const TARGETS = new Set([...SOURCES].filter((c) => c !== 'auto'));
