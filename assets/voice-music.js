(() => {
 'use strict';
 if (document.getElementById('aiva-tools')) return;
 const root = document.createElement('aside');
 root.id = 'aiva-tools'; root.setAttribute('aria-label','Voice and relaxing music');
 root.innerHTML = `<button type="button" id="aiva-tools-toggle" aria-expanded="false" aria-controls="aiva-tools-panel">Voice & relaxing music</button>
 <section id="aiva-tools-panel" aria-label="Voice and music controls" hidden>
 <h2>Make yourself comfortable</h2><p>Speak instead of typing, or enjoy a little quiet background music.</p>
 <label for="aiva-voice-language">Speaking language</label><select id="aiva-voice-language"><option value="en-GB">English</option><option value="ar-IQ">Arabic</option><option value="ckb-IQ">Kurdish Sorani — availability varies</option><option value="tr-TR">Turkish</option><option value="zh-CN">Mandarin</option><option value="de-DE">German</option><option value="fr-FR">French</option><option value="es-ES">Spanish</option></select>
 <p id="aiva-voice-target">Select a search or message field first.</p>
 <div class="aiva-tool-actions"><button type="button" id="aiva-dictate">Start speaking</button><button type="button" id="aiva-dictate-stop" disabled>Stop microphone</button><button type="button" id="aiva-read">Read selected field</button><button type="button" id="aiva-read-stop">Stop reading</button></div>
 <p id="aiva-voice-status" role="status">Dictation uses your browser’s speech service and may process speech online. Review your words before sending.</p>
 <hr><h3>Relaxing sounds</h3><p>Soft ambient tones, created in your browser. No vocals or advertisements.</p>
 <div class="aiva-tool-actions"><button type="button" id="aiva-music">Play relaxing sounds</button></div>
 <label for="aiva-volume">Music volume</label><input id="aiva-volume" type="range" min="0" max="100" value="15">
 <p id="aiva-music-status" role="status">Off. Music starts only when you press Play.</p>
 </section>`;
 document.body.append(root);
 const el = id => document.getElementById(id);
 const panel=el('aiva-tools-panel'), toggle=el('aiva-tools-toggle'), note=el('aiva-voice-status');
 function show() { panel.hidden=false; toggle.setAttribute('aria-expanded','true'); }
 toggle.onclick=()=>{ panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden)); };
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
 const eligible=field=>field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && ['text','search'].includes(field.type));
 let selected=null, recognition=null, speechVersion=0;
 const label=field=>field.labels?.[0]?.textContent.trim() || field.getAttribute('aria-label') || field.placeholder || 'text field';
 const active=()=>selected && selected.isConnected && !selected.disabled && !selected.readOnly;
 function stop(message) { const previous=recognition;recognition=null;speechVersion++;try{previous?.abort();}catch{}el('aiva-dictate').disabled=false;el('aiva-dictate-stop').disabled=true;if(message)note.textContent=message; }
 document.addEventListener('focusin',event=>{const field=event.target;if(root.contains(field)||!eligible(field)||field.disabled||field.readOnly)return;if(field!==selected)stop();selected=field;el('aiva-voice-target').textContent='Selected field: '+label(field);});
 document.addEventListener('input',event=>{if(recognition && event.isTrusted && event.target===selected)stop('Typing detected. Microphone stopped; your text is kept.');});
 let audioContext=null, master=null, oscillators=[], playing=false;
 function musicPause(message='Paused. Press Play to continue.') { if(master)master.gain.setTargetAtTime(0,audioContext.currentTime,.15);playing=false;el('aiva-music').textContent='Play relaxing sounds';el('aiva-music-status').textContent=message;if(audioContext)audioContext.suspend().catch(()=>{}); }
 async function musicPlay(){
  if(recognition){el('aiva-music-status').textContent='Stop the microphone before playing music.';return;}
  try {
   if(!audioContext){
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)throw new Error('Audio is unavailable in this browser.');
    audioContext=new Context();master=audioContext.createGain();master.gain.value=0;master.connect(audioContext.destination);
    // A quiet sustained pentatonic chord with slow, independent volume swells.
    [130.8128,196,261.6256,329.6276,392].forEach((frequency,index)=>{
     const tone=audioContext.createOscillator(), envelope=audioContext.createGain(), swell=audioContext.createOscillator(), depth=audioContext.createGain();
     tone.type='sine';tone.frequency.value=frequency;tone.detune.value=index%2?2:-2;
     envelope.gain.value=.07; swell.frequency.value=.025+index*.006;depth.gain.value=.025;
     swell.connect(depth);depth.connect(envelope.gain);tone.connect(envelope);envelope.connect(master);
     tone.start();swell.start();oscillators.push(tone,swell);
    });
   }
   await audioContext.resume();
   master.gain.setTargetAtTime(Number(el('aiva-volume').value)/100,audioContext.currentTime,.5);
   playing=true;el('aiva-music').textContent='Pause relaxing sounds';el('aiva-music-status').textContent='Playing softly. Use volume to adjust.';
  }catch(error){el('aiva-music-status').textContent=error.message||'Audio could not start. Please try again.';}
 }
 el('aiva-music').onclick=()=>playing?musicPause():musicPlay();
 el('aiva-volume').oninput=()=>{if(master&&playing)master.gain.setTargetAtTime(Number(el('aiva-volume').value)/100,audioContext.currentTime,.1);};
 el('aiva-dictate-stop').onclick=()=>stop('Microphone stopped. Review your words before sending.');
 el('aiva-voice-language').onchange=()=>stop('Language changed. Press Start speaking to continue.');
 el('aiva-dictate').onclick=()=>{
  if(!active()){note.textContent='Select a search or message field on the page, then press Start speaking.';return;}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){note.textContent='Direct dictation is unavailable here. Tap the field and use the microphone on your phone keyboard, or try Safari.';return;}
  stop();window.speechSynthesis?.cancel();if(playing)musicPause('Paused for dictation. Press Play when you are ready.');
  const field=selected, version=++speechVersion, instance=recognition=new Recognition();
  instance.lang=el('aiva-voice-language').value;instance.continuous=true;instance.interimResults=true;
  el('aiva-dictate').disabled=true;el('aiva-dictate-stop').disabled=false;
  instance.onstart=()=>{if(version===speechVersion)note.textContent='Listening. Speak naturally, then press Stop microphone.';};
  instance.onresult=event=>{
   if(version!==speechVersion||recognition!==instance||!active()||selected!==field)return;
   let final='',interim='';for(let i=event.resultIndex;i<event.results.length;i++){if(event.results[i].isFinal)final+=event.results[i][0].transcript+' ';else interim+=event.results[i][0].transcript;}
   if(final){const value=[field.value.trimEnd(),final.trim()].filter(Boolean).join(' ');field.value=field.maxLength>=0?value.slice(0,field.maxLength):value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
   note.textContent=interim?'Hearing: '+interim:'Words added to '+label(field)+'. Keep speaking or press Stop microphone.';
  };
  instance.onerror=event=>{if(version!==speechVersion)return;const messages={'not-allowed':'Microphone access was denied. Allow it in your browser or use keyboard dictation.','service-not-allowed':'The browser speech service is unavailable. Use your phone keyboard microphone.','language-not-supported':'This language is unavailable in this speech service. Try another language or keyboard dictation.','audio-capture':'No microphone is available. Check your device.','network':'The speech service could not connect. Try again.','no-speech':'No speech was detected. Press Start speaking to retry.'};stop(messages[event.error]||'Dictation stopped. Your text is kept.');};
  instance.onend=()=>{if(version===speechVersion)stop('Microphone stopped. Review your text or press Start speaking to add more.');};
  try{instance.start();}catch{stop('Microphone could not start. Try your phone keyboard microphone.');}
 };
 el('aiva-read-stop').onclick=()=>window.speechSynthesis?.cancel();
 el('aiva-read').onclick=()=>{
  if(!active()||!selected.value.trim()){note.textContent='Select a field containing text first.';return;}
  if(!window.speechSynthesis){note.textContent='Read-aloud is unavailable in this browser.';return;}
  stop();if(playing)musicPause('Paused for read-aloud. Press Play when you are ready.');window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(selected.value);utterance.lang=el('aiva-voice-language').value;
  utterance.onerror=()=>{note.textContent='Read-aloud stopped or the selected voice is unavailable.';};
  window.speechSynthesis.speak(utterance);note.textContent='Reading the selected field. Press Stop reading to stop.';
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();window.speechSynthesis?.cancel();if(playing)musicPause('Paused while the page is in the background.');}});
 window.addEventListener('pagehide',()=>{stop();window.speechSynthesis?.cancel();oscillators.forEach(node=>{try{node.stop();}catch{}});oscillators=[];audioContext?.close().catch(()=>{});audioContext=null;master=null;playing=false;});
 window.addEventListener('pageshow',()=>{if(!playing)el('aiva-music').textContent='Play relaxing sounds';});
})();
