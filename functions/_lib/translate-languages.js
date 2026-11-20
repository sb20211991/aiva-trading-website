/* Aiva Translate language catalogue, shared by /api/translate and scripts/i18n-build.mjs
   (which embeds it into assets/language-switcher.js). Codes are the translation engine target codes. */
/* The 50 offered languages (English + 49), most widely used first within each group. */
export const LANGUAGES = [
  ['ckb', 'Kurdish (Sorani)'], ['ku', 'Kurdish (Kurmanji)'], ['ar', 'Arabic'], ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'], ['yue', 'Cantonese'], ['hi', 'Hindi'], ['ur', 'Urdu'], ['bn', 'Bengali'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['ru', 'Russian'], ['tr', 'Turkish'], ['fa', 'Persian'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['pl', 'Polish'], ['uk', 'Ukrainian'], ['nl', 'Dutch'], ['el', 'Greek'], ['sv', 'Swedish'],
  ['ro', 'Romanian'], ['iw', 'Hebrew'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'],
  ['ms', 'Malay'], ['sw', 'Swahili'], ['am', 'Amharic'], ['ha', 'Hausa'], ['yo', 'Yoruba'], ['ig', 'Igbo'],
  ['zu', 'Zulu'], ['so', 'Somali'], ['om', 'Oromo'], ['af', 'Afrikaans'], ['pa', 'Punjabi'], ['ta', 'Tamil'],
  ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['tl', 'Filipino'], ['ps', 'Pashto'],
  ['cs', 'Czech'], ['hu', 'Hungarian'], ['uz', 'Uzbek']
];

/* Shown first in the selector under "Popular". */
export const POPULAR = ['en', 'ckb', 'ku', 'ar', 'zh-CN', 'yue', 'hi', 'ur', 'bn', 'es', 'fr', 'de', 'it', 'pt',
  'ru', 'tr', 'fa', 'ja', 'ko'];

/* Expected writing system per language: used by the build to verify output really is in that language. */
export const SCRIPT = {
  ckb: 'Arabic', ar: 'Arabic', ur: 'Arabic', fa: 'Arabic', ps: 'Arabic', 'zh-CN': 'Han', 'zh-TW': 'Han',
  yue: 'Han', hi: 'Devanagari', mr: 'Devanagari', bn: 'Bengali', ru: 'Cyrillic', uk: 'Cyrillic',
  ja: 'Han|Hiragana|Katakana', ko: 'Hangul', el: 'Greek', iw: 'Hebrew', th: 'Thai', am: 'Ethiopic',
  pa: 'Gurmukhi', ta: 'Tamil', te: 'Telugu', gu: 'Gujarati'
};

export const RTL = new Set(['ar', 'ckb', 'fa', 'iw', 'ur', 'ps']);

/* Engine code -> BCP 47 tag written to <html lang>. */
export const HTML_LANG = { iw: 'he', tl: 'fil', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', pt: 'pt' };

export const NATIVE = {
  en: 'English', ckb: 'کوردی (سۆرانی)', ku: 'Kurdî (Kurmancî)', ar: 'العربية', 'zh-CN': '简体中文',
  'zh-TW': '繁體中文', yue: '粵語 (廣東話)', hi: 'हिन्दी', ur: 'اردو', bn: 'বাংলা', es: 'Español',
  fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português', ru: 'Русский', tr: 'Türkçe', fa: 'فارسی',
  ja: '日本語', ko: '한국어', pl: 'Polski', uk: 'Українська', nl: 'Nederlands', el: 'Ελληνικά', sv: 'Svenska',
  ro: 'Română', iw: 'עברית', th: 'ไทย', vi: 'Tiếng Việt', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
  sw: 'Kiswahili', am: 'አማርኛ', ha: 'Hausa', yo: 'Yorùbá', ig: 'Igbo', zu: 'isiZulu', so: 'Soomaali',
  om: 'Afaan Oromoo', af: 'Afrikaans', pa: 'ਪੰਜਾਬੀ', ta: 'தமிழ்', te: 'తెలుగు', mr: 'मराठी', gu: 'ગુજરાતી',
  tl: 'Filipino', ps: 'پښتو', cs: 'Čeština', hu: 'Magyar', uz: 'Oʻzbekcha'
};
