/* GET /api/hub-languages -> the languages Aiva Translate offers right now, and what each one supports.
   text      translation in and out (verified against the live engine before deploy)
   voiceOut  read aloud with a natural server voice (otherwise the phone's own voice, if it has one)
   voiceIn   a speech-recognition locale exists for the browser microphone (actual support depends on the phone)
   video     the video recogniser can listen to this language (needs the recogniser to be switched on)
   Counts are computed from the same data, so the app never advertises more than the server will do. */
import { LANGUAGES, STATUS, engineCode } from '../_lib/languages.js';
import { onRequestGet as ttsInfo } from './hub-tts.js';
import { providers as sttProviders, RECOGNISED } from './hub-stt.js';

// Locales the browser recognisers (Chrome on Android, Safari on iPhone) publish. Kurdish is not among them.
const BROWSER_SPEECH = /^(af|am|ar|bg|bn|bs|ca|cs|da|de|el|en|es|et|eu|fa|fi|fil|fr|gl|gu|hi|hr|hu|hy|id|is|it|iw|ja|jv|ka|kk|km|kn|ko|lo|lt|lv|mk|ml|mn|mr|ms|my|nb|ne|nl|pa|pl|pt|ro|ru|si|sk|sl|sq|sr|su|sv|sw|ta|te|th|tr|uk|ur|uz|vi|yue|zh|zu)(-|$)/;

export async function onRequestGet(context) {
  const { request, env = {} } = context;
  const info = await (await ttsInfo({ request: new Request(new URL('/api/hub-tts?info=1', request.url), { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env })).json();
  const voices = new Set(info.voices || []);
  const stt = sttProviders(env);
  const heard = new Set(RECOGNISED);
  const languages = LANGUAGES.map((l) => {
    const video = stt.length > 0 && heard.has(engineCode(l.code));
    return {
      code: l.code, name: l.name, region: l.region, core: l.core, variant: !!l.variant, via: l.variant ? l.engine : undefined,
      speech: l.speech || '', text: true, voiceOut: voices.has(l.code), voiceIn: BROWSER_SPEECH.test(l.speech || ''),
      video, dub: video && voices.has(l.code)
    };
  });
  const count = (k) => languages.filter((l) => l[k]).length;
  const base = languages.filter((l) => !l.variant);
  return new Response(JSON.stringify({
    verifiedAt: STATUS.checkedAt, languages,
    counts: {
      text: base.length, variants: languages.length - base.length, voiceOut: base.filter((l) => l.voiceOut).length,
      voiceIn: base.filter((l) => l.voiceIn).length, voiceInLocales: count('voiceIn'), video: base.filter((l) => l.video).length, dub: base.filter((l) => l.dub).length,
      subtitleTargets: stt.length ? base.length : 0
    },
    providers: { text: ['google', env.GOOGLE_TRANSLATE_API_KEY ? 'google-cloud' : '', env.AZURE_TRANSLATOR_KEY ? 'microsoft' : ''].filter(Boolean),
      voice: [...new Set(Object.values(info.providers || {}).flat())], speech: stt },
    signLanguage: false
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
