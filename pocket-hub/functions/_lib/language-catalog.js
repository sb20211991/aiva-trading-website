/* Aiva Translate world language catalogue.
   Rows: [code, name, region, speech locale for voice input ('' when no browser recognition locale is known)].
   Codes are the translation engine's own codes (Google Translate), so a code here is exactly what the engine is asked
   for. A row is a CANDIDATE only: scripts/verify-languages.mjs asks the live engine to translate into and out of
   every row (and to voice it) before each deploy, and only rows that really work are offered in the app
   (see language-status.js). The 14 original Aiva languages are always offered. */

export const REGIONS = ['Popular', 'Europe', 'Middle East & Central Asia', 'South Asia', 'East Asia',
  'Southeast Asia & Pacific', 'Africa', 'Americas', 'Classical & constructed'];

/* The 14 original Aiva Translate languages, in their original order and with their original names. */
export const CORE = [
  ['en', 'English', 'Popular', 'en-GB'], ['ckb', 'Kurdish Sorani', 'Popular', 'ckb-IQ'], ['ar', 'Arabic', 'Popular', 'ar-SA'],
  ['tr', 'Turkish', 'Popular', 'tr-TR'], ['fa', 'Persian', 'Popular', 'fa-IR'], ['fr', 'French', 'Popular', 'fr-FR'],
  ['de', 'German', 'Popular', 'de-DE'], ['es', 'Spanish', 'Popular', 'es-ES'], ['it', 'Italian', 'Popular', 'it-IT'],
  ['zh-CN', 'Chinese Mandarin', 'Popular', 'zh-CN'], ['pt', 'Portuguese', 'Popular', 'pt-PT'], ['ru', 'Russian', 'Popular', 'ru-RU'],
  ['ja', 'Japanese', 'Popular', 'ja-JP'], ['hi', 'Hindi', 'Popular', 'hi-IN']
];

const E = 'Europe', M = 'Middle East & Central Asia', S = 'South Asia', EA = 'East Asia', SE = 'Southeast Asia & Pacific',
  AF = 'Africa', AM = 'Americas', C = 'Classical & constructed';

/* Further engine languages (candidates, verified before deploy). */
export const WORLD = [
  // Popular additions shown near the top
  ['ku', 'Kurdish Kurmanji', 'Popular', ''], ['zh-TW', 'Chinese (Traditional)', 'Popular', 'zh-TW'], ['yue', 'Cantonese', 'Popular', 'yue-Hant-HK'],
  ['ur', 'Urdu', 'Popular', 'ur-PK'], ['bn', 'Bengali', 'Popular', 'bn-BD'], ['ko', 'Korean', 'Popular', 'ko-KR'],
  ['fa-AF', 'Dari', 'Popular', ''], ['pt-PT', 'Portuguese (Portugal)', 'Popular', 'pt-PT'], ['fr-CA', 'French (Canada)', 'Popular', 'fr-CA'],
  // Europe
  ['sq', 'Albanian', E, 'sq-AL'], ['eu', 'Basque', E, 'eu-ES'], ['be', 'Belarusian', E, ''], ['bs', 'Bosnian', E, 'bs-BA'],
  ['br', 'Breton', E, ''], ['bg', 'Bulgarian', E, 'bg-BG'], ['ca', 'Catalan', E, 'ca-ES'], ['co', 'Corsican', E, ''],
  ['hr', 'Croatian', E, 'hr-HR'], ['cs', 'Czech', E, 'cs-CZ'], ['da', 'Danish', E, 'da-DK'], ['nl', 'Dutch', E, 'nl-NL'],
  ['et', 'Estonian', E, 'et-EE'], ['fo', 'Faroese', E, ''], ['fi', 'Finnish', E, 'fi-FI'], ['fy', 'Frisian', E, ''],
  ['fur', 'Friulian', E, ''], ['gl', 'Galician', E, 'gl-ES'], ['el', 'Greek', E, 'el-GR'], ['hu', 'Hungarian', E, 'hu-HU'],
  ['is', 'Icelandic', E, 'is-IS'], ['ga', 'Irish', E, ''], ['lv', 'Latvian', E, 'lv-LV'], ['ltg', 'Latgalian', E, ''],
  ['lij', 'Ligurian', E, ''], ['li', 'Limburgish', E, ''], ['lt', 'Lithuanian', E, 'lt-LT'], ['lmo', 'Lombard', E, ''],
  ['lb', 'Luxembourgish', E, ''], ['mk', 'Macedonian', E, 'mk-MK'], ['mt', 'Maltese', E, ''], ['gv', 'Manx', E, ''],
  ['no', 'Norwegian', E, 'nb-NO'], ['oc', 'Occitan', E, ''], ['pl', 'Polish', E, 'pl-PL'], ['rom', 'Romani', E, ''],
  ['ro', 'Romanian', E, 'ro-RO'], ['se', 'Sami (North)', E, ''], ['gd', 'Scots Gaelic', E, ''], ['sr', 'Serbian', E, 'sr-RS'],
  ['scn', 'Sicilian', E, ''], ['szl', 'Silesian', E, ''], ['sk', 'Slovak', E, 'sk-SK'], ['sl', 'Slovenian', E, 'sl-SI'],
  ['sv', 'Swedish', E, 'sv-SE'], ['uk', 'Ukrainian', E, 'uk-UA'], ['vec', 'Venetian', E, ''], ['cy', 'Welsh', E, ''],
  ['yi', 'Yiddish', E, ''], ['ba', 'Bashkir', E, ''], ['cv', 'Chuvash', E, ''], ['kv', 'Komi', E, ''],
  ['chm', 'Meadow Mari', E, ''], ['udm', 'Udmurt', E, ''], ['tt', 'Tatar', E, ''], ['crh', 'Crimean Tatar', E, ''],
  ['os', 'Ossetian', E, ''], ['ce', 'Chechen', E, ''], ['av', 'Avar', E, ''],
  // Middle East & Central Asia
  ['hy', 'Armenian', M, 'hy-AM'], ['az', 'Azerbaijani', M, 'az-AZ'], ['bal', 'Baluchi', M, ''], ['ka', 'Georgian', M, 'ka-GE'],
  ['iw', 'Hebrew', M, 'iw-IL'], ['kk', 'Kazakh', M, 'kk-KZ'], ['ky', 'Kyrgyz', M, ''], ['ps', 'Pashto', M, ''],
  ['tg', 'Tajik', M, ''], ['tk', 'Turkmen', M, ''], ['ug', 'Uyghur', M, ''], ['uz', 'Uzbek', M, 'uz-UZ'],
  ['bua', 'Buryat', M, ''], ['sah', 'Yakut', M, ''], ['tyv', 'Tuvan', M, ''], ['mn', 'Mongolian', M, 'mn-MN'],
  // South Asia
  ['as', 'Assamese', S, ''], ['awa', 'Awadhi', S, ''], ['bho', 'Bhojpuri', S, ''], ['doi', 'Dogri', S, ''],
  ['dz', 'Dzongkha', S, ''], ['gu', 'Gujarati', S, 'gu-IN'], ['kn', 'Kannada', S, 'kn-IN'], ['kha', 'Khasi', S, ''],
  ['trp', 'Kokborok', S, ''], ['gom', 'Konkani', S, ''], ['mai', 'Maithili', S, ''], ['ml', 'Malayalam', S, 'ml-IN'],
  ['mr', 'Marathi', S, 'mr-IN'], ['mwr', 'Marwadi', S, ''], ['mni-Mtei', 'Meiteilon (Manipuri)', S, ''], ['lus', 'Mizo', S, ''],
  ['ne', 'Nepali', S, 'ne-NP'], ['new', 'Nepalbhasa (Newari)', S, ''], ['or', 'Odia (Oriya)', S, ''], ['pa', 'Punjabi (Gurmukhi)', S, 'pa-Guru-IN'],
  ['pa-Arab', 'Punjabi (Shahmukhi)', S, ''], ['sa', 'Sanskrit', S, ''], ['sat', 'Santali', S, ''], ['sd', 'Sindhi', S, ''],
  ['si', 'Sinhala', S, 'si-LK'], ['ta', 'Tamil', S, 'ta-IN'], ['te', 'Telugu', S, 'te-IN'], ['tcy', 'Tulu', S, ''],
  ['bo', 'Tibetan', S, ''], ['dv', 'Dhivehi', S, ''],
  // East Asia
  ['hmn', 'Hmong', EA, ''],
  // Southeast Asia & Pacific
  ['ace', 'Acehnese', SE, ''], ['ban', 'Balinese', SE, ''], ['btx', 'Batak Karo', SE, ''], ['bts', 'Batak Simalungun', SE, ''],
  ['bbc', 'Batak Toba', SE, ''], ['bew', 'Betawi', SE, ''], ['bik', 'Bikol', SE, ''], ['my', 'Burmese (Myanmar)', SE, 'my-MM'],
  ['ceb', 'Cebuano', SE, ''], ['ch', 'Chamorro', SE, ''], ['chk', 'Chuukese', SE, ''], ['fj', 'Fijian', SE, ''],
  ['tl', 'Filipino (Tagalog)', SE, 'fil-PH'], ['cnh', 'Hakha Chin', SE, ''], ['haw', 'Hawaiian', SE, ''], ['hil', 'Hiligaynon', SE, ''],
  ['iba', 'Iban', SE, ''], ['ilo', 'Ilocano', SE, ''], ['id', 'Indonesian', SE, 'id-ID'], ['jw', 'Javanese', SE, 'jv-ID'],
  ['kac', 'Jingpo', SE, ''], ['pam', 'Kapampangan', SE, ''], ['km', 'Khmer', SE, 'km-KH'], ['lo', 'Lao', SE, 'lo-LA'],
  ['mad', 'Madurese', SE, ''], ['mak', 'Makassar', SE, ''], ['ms', 'Malay', SE, 'ms-MY'], ['ms-Arab', 'Malay (Jawi)', SE, ''],
  ['mi', 'Maori', SE, ''], ['mh', 'Marshallese', SE, ''], ['min', 'Minang', SE, ''], ['pag', 'Pangasinan', SE, ''],
  ['sm', 'Samoan', SE, ''], ['shn', 'Shan', SE, ''], ['su', 'Sundanese', SE, 'su-ID'], ['ty', 'Tahitian', SE, ''],
  ['tet', 'Tetum', SE, ''], ['th', 'Thai', SE, 'th-TH'], ['tpi', 'Tok Pisin', SE, ''], ['to', 'Tongan', SE, ''],
  ['vi', 'Vietnamese', SE, 'vi-VN'], ['war', 'Waray', SE, ''],
  // Africa
  ['aa', 'Afar', AF, ''], ['af', 'Afrikaans', AF, 'af-ZA'], ['ach', 'Acholi', AF, ''], ['alz', 'Alur', AF, ''],
  ['am', 'Amharic', AF, 'am-ET'], ['bm', 'Bambara', AF, ''], ['bci', 'Baoulé', AF, ''], ['bem', 'Bemba', AF, ''],
  ['cgg', 'Chiga', AF, ''], ['din', 'Dinka', AF, ''], ['dov', 'Dombe', AF, ''], ['dyu', 'Dyula', AF, ''],
  ['ee', 'Ewe', AF, ''], ['fon', 'Fon', AF, ''], ['ff', 'Fulani', AF, ''], ['gaa', 'Ga', AF, ''],
  ['ha', 'Hausa', AF, ''], ['ig', 'Igbo', AF, ''], ['kr', 'Kanuri', AF, ''], ['kg', 'Kikongo', AF, ''],
  ['rw', 'Kinyarwanda', AF, ''], ['ktu', 'Kituba', AF, ''], ['kri', 'Krio', AF, ''], ['ln', 'Lingala', AF, ''],
  ['lg', 'Luganda', AF, ''], ['luo', 'Luo', AF, ''], ['mg', 'Malagasy', AF, ''], ['mfe', 'Mauritian Creole', AF, ''],
  ['ndc-ZW', 'Ndau', AF, ''], ['nr', 'Ndebele (South)', AF, ''], ['bm-Nkoo', "N'Ko", AF, ''], ['nus', 'Nuer', AF, ''],
  ['ny', 'Chichewa (Nyanja)', AF, ''], ['om', 'Oromo', AF, ''], ['rn', 'Rundi', AF, ''], ['sg', 'Sango', AF, ''],
  ['nso', 'Sepedi', AF, ''], ['st', 'Sesotho', AF, ''], ['crs', 'Seychellois Creole', AF, ''], ['sn', 'Shona', AF, ''],
  ['so', 'Somali', AF, ''], ['sus', 'Susu', AF, ''], ['sw', 'Swahili', AF, 'sw-KE'], ['ss', 'Swati', AF, ''],
  ['ber-Latn', 'Tamazight', AF, ''], ['ber', 'Tamazight (Tifinagh)', AF, ''], ['ti', 'Tigrinya', AF, ''], ['tiv', 'Tiv', AF, ''],
  ['ts', 'Tsonga', AF, ''], ['lua', 'Tshiluba', AF, ''], ['tn', 'Tswana', AF, ''], ['tum', 'Tumbuka', AF, ''],
  ['ak', 'Twi (Akan)', AF, ''], ['ve', 'Venda', AF, ''], ['wo', 'Wolof', AF, ''], ['xh', 'Xhosa', AF, ''],
  ['yo', 'Yoruba', AF, ''], ['zu', 'Zulu', AF, 'zu-ZA'],
  // Americas
  ['ay', 'Aymara', AM, ''], ['gn', 'Guarani', AM, ''], ['ht', 'Haitian Creole', AM, ''], ['hrx', 'Hunsrik', AM, ''],
  ['iu', 'Inuktut (Syllabics)', AM, ''], ['iu-Latn', 'Inuktut (Latin)', AM, ''], ['jam', 'Jamaican Patois', AM, ''], ['kl', 'Kalaallisut', AM, ''],
  ['mam', 'Mam', AM, ''], ['nah', 'Nahuatl (Eastern Huasteca)', AM, ''], ['pap', 'Papiamento', AM, ''], ['kek', "Q'eqchi'", AM, ''],
  ['qu', 'Quechua', AM, ''], ['yua', 'Yucatec Maya', AM, ''], ['zap', 'Zapotec', AM, ''],
  // Classical & constructed
  ['eo', 'Esperanto', C, ''], ['la', 'Latin', C, '']
];

/* Regional and dialect entries. They pick the voice-input recogniser for that region; the translation engine has
   no separate text model for them, so text and voice output use the base language shown in `via` (for Arabic
   that is Modern Standard Arabic). The app says so beside each of them. */
export const VARIANTS = [
  ['ar-EG', 'Arabic (Egypt)', 'ar-EG', 'ar'], ['ar-IQ', 'Arabic (Iraq)', 'ar-IQ', 'ar'], ['ar-AE', 'Arabic (UAE)', 'ar-AE', 'ar'],
  ['ar-KW', 'Arabic (Kuwait)', 'ar-KW', 'ar'], ['ar-QA', 'Arabic (Qatar)', 'ar-QA', 'ar'], ['ar-BH', 'Arabic (Bahrain)', 'ar-BH', 'ar'],
  ['ar-OM', 'Arabic (Oman)', 'ar-OM', 'ar'], ['ar-JO', 'Arabic (Jordan)', 'ar-JO', 'ar'], ['ar-LB', 'Arabic (Lebanon)', 'ar-LB', 'ar'],
  ['ar-PS', 'Arabic (Palestine)', 'ar-PS', 'ar'], ['ar-MA', 'Arabic (Morocco)', 'ar-MA', 'ar'], ['ar-DZ', 'Arabic (Algeria)', 'ar-DZ', 'ar'],
  ['ar-TN', 'Arabic (Tunisia)', 'ar-TN', 'ar'],
  ['zh-TW-speech', 'Chinese Mandarin (Taiwan)', 'zh-TW', 'zh-TW'], ['en-US', 'English (US)', 'en-US', 'en'], ['en-IN', 'English (India)', 'en-IN', 'en'],
  ['en-AU', 'English (Australia)', 'en-AU', 'en'], ['es-MX', 'Spanish (Mexico)', 'es-MX', 'es'], ['es-US', 'Spanish (US)', 'es-US', 'es'],
  ['es-AR', 'Spanish (Argentina)', 'es-AR', 'es'], ['pt-BR', 'Portuguese (Brazil)', 'pt-BR', 'pt'], ['de-AT', 'German (Austria)', 'de-AT', 'de'],
  ['de-CH', 'German (Switzerland)', 'de-CH', 'de'], ['fr-BE', 'French (Belgium)', 'fr-BE', 'fr'], ['fr-CH', 'French (Switzerland)', 'fr-CH', 'fr'],
  ['ta-LK', 'Tamil (Sri Lanka)', 'ta-LK', 'ta'], ['sw-TZ', 'Swahili (Tanzania)', 'sw-TZ', 'sw'], ['ur-IN', 'Urdu (India)', 'ur-IN', 'ur'],
  ['bn-IN', 'Bengali (India)', 'bn-IN', 'bn']
];

/* Languages the speech recogniser used for video and live-camera translation (OpenAI Whisper, run on Cloudflare
   Workers AI or OpenAI) officially lists, mapped to engine codes. Kurdish (Sorani and Kurmanji) is not among them. */
export const WHISPER = {
  af: 'af', am: 'am', ar: 'ar', as: 'as', az: 'az', ba: 'ba', be: 'be', bg: 'bg', bn: 'bn', bo: 'bo', br: 'br', bs: 'bs',
  ca: 'ca', cs: 'cs', cy: 'cy', da: 'da', de: 'de', el: 'el', en: 'en', es: 'es', et: 'et', eu: 'eu', fa: 'fa', fi: 'fi',
  fo: 'fo', fr: 'fr', gl: 'gl', gu: 'gu', ha: 'ha', haw: 'haw', he: 'iw', hi: 'hi', hr: 'hr', ht: 'ht', hu: 'hu', hy: 'hy',
  id: 'id', is: 'is', it: 'it', ja: 'ja', jw: 'jw', jv: 'jw', ka: 'ka', kk: 'kk', km: 'km', kn: 'kn', ko: 'ko', la: 'la',
  lb: 'lb', ln: 'ln', lo: 'lo', lt: 'lt', lv: 'lv', mg: 'mg', mi: 'mi', mk: 'mk', ml: 'ml', mn: 'mn', mr: 'mr', ms: 'ms',
  mt: 'mt', my: 'my', ne: 'ne', nl: 'nl', nn: 'no', no: 'no', oc: 'oc', pa: 'pa', pl: 'pl', ps: 'ps', pt: 'pt', ro: 'ro',
  ru: 'ru', sa: 'sa', sd: 'sd', si: 'si', sk: 'sk', sl: 'sl', sn: 'sn', so: 'so', sq: 'sq', sr: 'sr', su: 'su', sv: 'sv',
  sw: 'sw', ta: 'ta', te: 'te', tg: 'tg', th: 'th', tk: 'tk', tl: 'tl', tr: 'tr', tt: 'tt', uk: 'uk', ur: 'ur', uz: 'uz',
  vi: 'vi', yi: 'yi', yo: 'yo', zh: 'zh-CN', yue: 'yue',
  // Whisper also answers with full English names on some hosts
  english: 'en', arabic: 'ar', persian: 'fa', turkish: 'tr', chinese: 'zh-CN', french: 'fr', german: 'de', spanish: 'es'
};
