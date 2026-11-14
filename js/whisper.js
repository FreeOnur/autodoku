/* AutoDoku – Spracherkennung OHNE Google-Server
 *   whisper : Whisper-KI läuft direkt im Browser (gratis, kein Schlüssel, einmal ~80 MB laden)
 *   local   : Whisper large-v3-turbo mit whisper.cpp auf dem eigenen PC (Desktop-App) – genau, offline,
 *             begrenzte CPU-Kerne + niedrige Priorität, wird nach 10 min Pause beendet
 *   groq    : Whisper large-v3 in der Cloud (Groq, gratis Schlüssel) – sehr genau, schnell, schont den Laptop
 *   gemini  : Audio-Abschnitte an Google Gemini (gratis Schlüssel), gute Qualität, schont den Laptop
 * Nimmt in Abschnitten von ~10–20 s auf (geschnitten an Sprechpausen) und liefert Text
 * über dieselben Callbacks wie LiveTranscriber (onFinal, onInterim, onState, onError). */
(function (root) {
  'use strict';

  // Bibliothek & Modell lokal (Desktop-App / eigener Server), sonst aus dem Netz
  const BASE = new URL('.', location.href).href;
  const TJS = BASE + 'vendor/transformers/transformers.min.js';
  const SR_HZ = 16000;
  const LANG_NAMES = { de: 'german', en: 'english', fr: 'french', it: 'italian', es: 'spanish' };
  // typische Whisper-Halluzinationen bei Stille
  const JUNK = /untertitel|amara\.org|vielen dank für(s| das) zuschauen|copyright|zdf|swr|abonnier|thanks for watching|^\W*$|^\[.*\]$|^\(.*\)$|musik\W*$/i;

  // Whisper wiederholt manchmal dieselbe Phrase endlos -> auf ein Vorkommen kürzen
  function cleanLoops(t) {
    let s = String(t || '').trim(), prev;
    do { prev = s; s = s.replace(/(\b[^]{4,120}?)(?:[\s,.]*\1){2,}/giu, '$1'); } while (s !== prev && s.length);
    return s.trim();
  }

  // ---------- Whisper-Worker ----------
  let worker = null, workerReady = null, jobId = 0;
  const pending = new Map();
  const status = { state: 'idle', progress: 0, file: '' };

  function workerCode() {
    return `
      import { pipeline, env, Tensor } from '${TJS}';
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.localModelPath = '${BASE}models/';
      env.backends.onnx.wasm.wasmPaths = '${BASE}vendor/transformers/';
      if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      let asr = null;
      // Sprache erkennen (Deutsch oder Englisch): beide Varianten transkribieren und die wahrscheinlichere nehmen
      // (Whisper im Browser kann die Sprache nicht selbst bestimmen)
      async function scoreText(feats, code, text) {
        const cfg = asr.model.generation_config;
        const toks = Array.from(asr.tokenizer.encode(text, { add_special_tokens: false })).slice(0, 96);
        if (!toks.length) return -99;
        const pre = [cfg.decoder_start_token_id, cfg.lang_to_id['<|' + code + '|>'], cfg.task_to_id.transcribe, cfg.no_timestamps_token_id];
        const seq = pre.concat(toks);
        const ids = new Tensor('int64', BigInt64Array.from(seq.map(BigInt)), [1, seq.length]);
        const out = await asr.model({ input_features: feats.input_features, decoder_input_ids: ids });
        const V = out.logits.dims[2], data = out.logits.data;
        let sum = 0;
        for (let r = pre.length - 1; r < seq.length - 1; r++) {
          let mx = -1e9; for (let k = 0; k < V; k++) if (data[r * V + k] > mx) mx = data[r * V + k];
          let z = 0; for (let k = 0; k < V; k++) z += Math.exp(data[r * V + k] - mx);
          sum += data[r * V + seq[r + 1]] - mx - Math.log(z);
        }
        return sum / toks.length;
      }
      async function detect(audio) {
        const de = ((await asr(audio.slice(), { language: 'german', task: 'transcribe', return_timestamps: false })) || {}).text || '';
        const en = ((await asr(audio.slice(), { language: 'english', task: 'transcribe', return_timestamps: false })) || {}).text || '';
        const feats = await asr.processor(audio.slice());
        // Halluzinations-Schleifen ("the x plus the x plus …") sind sehr "wahrscheinlich" -> bestrafen
        const rep = (t) => { const w = t.toLowerCase().match(/[\\p{L}\\d]+/gu) || []; if (w.length < 6) return 0; const u = new Set(w).size / w.length; return u < 0.4 ? 50 : (1 - u) * 1.5; };
        const sde = (await scoreText(feats, 'de', de)) - rep(de), sen = (await scoreText(feats, 'en', en)) - rep(en);
        const lang = sen > sde + 0.12 ? 'english' : 'german';
        return { lang, text: lang === 'english' ? en : de, sde, sen, de: de.slice(0, 80), en: en.slice(0, 80) };
      }
      let autoLang = null, autoCount = 0;
      self.onmessage = async (e) => {
        const d = e.data;
        try {
          if (d.type === 'load') {
            const files = {};
            const cb = (p) => {
              if (p.status === 'progress' && p.file) {
                files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
                let l = 0, t = 0; for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
                self.postMessage({ type: 'progress', progress: t ? l / t : 0, loaded: l, total: t });
              }
            };
            let device = 'wasm';
            let adapter = null;
            if (d.webgpu && self.navigator.gpu) { try { adapter = await self.navigator.gpu.requestAdapter(); } catch (e) { adapter = null; } }
            if (adapter) {
              try {
                asr = await pipeline('automatic-speech-recognition', d.model, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback: cb });
                device = 'webgpu';
              } catch (err) { asr = null; }
            }
            if (!asr) asr = await pipeline('automatic-speech-recognition', d.model, { device: 'wasm', dtype: 'q8', progress_callback: cb });
            self.postMessage({ type: 'ready', device });
          } else if (d.type === 'probe') {
            const r = await detect(d.audio);
            self.postMessage({ type: 'result', id: d.id, text: JSON.stringify(r) });
          } else if (d.type === 'run') {
            const opt = { task: 'transcribe', return_timestamps: false };
            if (d.reset) { autoLang = null; autoCount = 0; }
            let lang = d.language, out = null;
            if (!lang) {
              // automatisch: Sprache beim ersten Abschnitt (und dann alle 6 Abschnitte) prüfen
              if (!autoLang || ++autoCount % 6 === 0) {
                try { const r = await detect(d.audio); autoLang = r.lang; out = { text: r.text }; } catch (err) { autoLang = autoLang || 'german'; }
              }
              lang = autoLang;
            }
            if (!out) out = await asr(d.audio, Object.assign(opt, { language: lang }));
            // Whisper bricht manchmal nach einem Wort ab -> bei viel zu kurzem Ergebnis nochmal versuchen
            const secs = d.audio.length / 16000, nw = ((out && out.text) || '').trim().split(/\s+/).filter(Boolean).length;
            if (secs > 5 && nw < secs * 0.15) { const again = await asr(d.audio, Object.assign({}, opt, { language: lang })); if (again && (again.text || '').length > ((out && out.text) || '').length) out = again; }
            self.postMessage({ type: 'result', id: d.id, text: (out && out.text) || '', lang });
          }
        } catch (err) {
          self.postMessage({ type: 'error', id: d.id, message: String(err && err.message || err) });
        }
      };`;
  }

  // Modell: base (schnell, ~80 MB) oder small (genauer bei Fachbegriffen, ~250 MB)
  const modelName = () => {
    try { return (JSON.parse(localStorage.getItem('autodoku.settings') || '{}').whisperModel === 'small') ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base'; } catch (e) { return 'onnx-community/whisper-base'; }
  };
  let loadedModel = null;
  function loadWhisper(onProgress, noGpu) {
    if (workerReady && loadedModel !== modelName() && !pending.size) { try { worker.terminate(); } catch (e) { /* egal */ } workerReady = null; status.state = 'idle'; }
    if (workerReady) return workerReady;
    loadedModel = modelName();
    status.state = 'loading';
    workerReady = new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([workerCode()], { type: 'text/javascript' }));
      worker = new Worker(url, { type: 'module' });
      const fail = (msg) => {
        try { worker.terminate(); } catch (e) { /* egal */ }
        workerReady = null;
        // laufende Aufträge nicht ewig hängen lassen
        for (const [id, p] of pending) { pending.delete(id); try { p.reject(new Error(msg || 'Whisper abgestürzt')); } catch (e) { /* egal */ } }
        // Grafikkarte macht Probleme -> nochmal nur mit CPU
        if (!noGpu) { loadWhisper(onProgress, true).then(resolve, reject); return; }
        status.state = 'error'; status.error = msg; reject(new Error(msg));
      };
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') { status.progress = d.progress; onProgress && onProgress(d); }
        else if (d.type === 'ready') { status.state = 'ready'; status.device = d.device; resolve(); }
        else if (d.type === 'result' || (d.type === 'error' && d.id != null)) {
          const p = pending.get(d.id); pending.delete(d.id);
          if (p) d.type === 'result' ? p.resolve(d.text) : p.reject(new Error(d.message));
        } else if (d.type === 'error') fail(d.message);
      };
      worker.onerror = (e) => fail(e.message || 'Whisper konnte nicht starten');
      worker.postMessage({ type: 'load', model: loadedModel, webgpu: !noGpu && !!navigator.gpu });
    });
    return workerReady;
  }

  let resetAuto = true; // neue Aufnahme/Datei -> Sprache neu bestimmen
  function whisperRun(audio, langCode) {
    const id = ++jobId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const reset = resetAuto; resetAuto = false;
      worker.postMessage({ type: 'run', id, audio, reset, language: langCode === 'auto' ? null : (LANG_NAMES[langCode] || 'german') }, [audio.buffer]);
    });
  }

  // Leiseste Stelle (50-ms-Fenster) zwischen from und to finden – dort schneiden, damit kein Wort zerteilt wird
  function quietestCut(f32, from, to) {
    const win = 800; // 50 ms
    from = Math.max(0, Math.floor(from)); to = Math.min(f32.length, Math.floor(to));
    let best = to, bestE = Infinity;
    for (let j = from; j + win <= to; j += win / 2) {
      let e = 0; for (let k = j; k < j + win; k++) e += f32[k] * f32[k];
      if (e < bestE) { bestE = e; best = j + win / 2; }
    }
    return Math.round(best);
  }
  const rmsOf = (a) => { let s = 0, n = 0; for (let k = 0; k < a.length; k += 8) { s += a[k] * a[k]; n++; } return n ? Math.sqrt(s / n) : 0; };

  // Lange Aufnahmen (Videos, Audiodateien) in ~28-s-Stücken transkribieren
  // opts.keepTail: Rest nach der letzten Pause NICHT transkribieren, sondern zurückgeben (für Handy-Stücke)
  async function transcribeLong(f32, langCode, onProgress, opts) {
    const cloud = cloudEngine();
    if (!cloud) await loadWhisper();
    if (!opts || !opts.continued) resetAuto = true;
    const step = 28 * SR_HZ, out = [];
    let tail = null;
    let limit = f32.length;
    if (opts && opts.keepTail && f32.length > 4 * SR_HZ) {
      // die letzten 2,5 s nach einer Pause durchsuchen; was danach kommt, gehört zum nächsten Stück
      limit = quietestCut(f32, f32.length - 2.5 * SR_HZ, f32.length);
      if (limit < f32.length - 800) tail = f32.slice(limit); else limit = f32.length;
    }
    for (let i = 0; i < limit; i += step) {
      // an einer leisen Stelle schneiden (±2 s um die Grenze)
      let end = Math.min(limit, i + step);
      if (end < limit) end = quietestCut(f32, end - 2 * SR_HZ, Math.min(limit, end + 1.5 * SR_HZ));
      const chunk = f32.slice(i, end);
      if (rmsOf(chunk) > 0.004) {
        let text;
        if (cloud) {
          // Cloud: bei Limit/Netzproblem kurz warten und nochmal, notfalls offline
          for (let k = 0; ; k++) {
            try { text = cleanLoops(await runEngine(cloud, chunk, langCode, { context: out.length ? out[out.length - 1].text.slice(-200) : '' })); break; }
            catch (e) { if (e.fatal || k >= 3) { await loadWhisper(); text = cleanLoops(await whisperRun(chunk, langCode)); break; } await new Promise(r => setTimeout(r, 5000 * (k + 1))); }
          }
        } else text = cleanLoops(await whisperRun(chunk, langCode));
        if (text && !JUNK.test(text)) out.push({ t: Math.round(i / SR_HZ), text });
      }
      onProgress && onProgress(Math.min(1, end / limit));
      i = end - step;
    }
    if (opts && opts.keepTail) out.tail = tail;
    return out;
  }

  // Audio aus einer Datei (Video/Audio) als 16-kHz-Mono
  async function decodeFile(bytes) {
    const ctx = new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(1, SR_HZ, SR_HZ);
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const n = Math.ceil(buf.duration * SR_HZ);
    const off = new OfflineAudioContext(1, n, SR_HZ);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const r = await off.startRendering();
    return r.getChannelData(0);
  }

  // ---------- Gemini-Transkription ----------
  function toWavBase64(f32) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR_HZ, true);
    v.setUint32(28, SR_HZ * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function geminiRun(audio, langCode, hint) {
    const terms = [hint && hint.glossary, root.Prompts ? root.Prompts.HTL_TERMS.split(', ').slice(0, 40).join(', ') : 'Interface, ArrayList, JSON, SQL'].filter(Boolean).join(', ');
    const r = await root.AI.call({
      tier: 'live', model: 'transcribe', maxTokens: 1500, temperature: 0,
      system: 'Du transkribierst Unterrichts-Audio einer HTL (höhere technische Schule, Österreich)' + (hint && hint.subject ? `, Fach: ${hint.subject}` : '') + '. Gib NUR den gesprochenen Text wörtlich wieder (mit Satzzeichen), ohne Kommentare, ohne Sprecher-Namen. Es wird meist Deutsch mit vielen englischen Fachbegriffen gesprochen: Fachbegriffe korrekt schreiben (z. B. ' + terms + ').' + (hint && hint.context ? ` Zuletzt wurde gesagt: "…${hint.context}" (nur Kontext, nicht wiederholen).` : '') + ' Ist nichts Verständliches zu hören, gib nichts aus.',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'audio/wav', data: toWavBase64(audio) } },
        { type: 'text', text: langCode === 'auto' ? 'Transkribiere (Sprache automatisch erkennen, meist Deutsch mit englischen Fachbegriffen).' : `Transkribiere (Sprache: ${langCode}).` },
      ] }],
    }, { forceProvider: 'gemini' });
    return r.text;
  }

  // ---------- Groq: Whisper large-v3 in der Cloud ----------
  const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
  const settings = () => (root.Store && root.Store.Settings ? root.Store.Settings.get() : {});
  // ---------- Lokal: whisper.cpp in der Desktop-App ----------
  const isDesktop = () => location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && !!(root.AUTODOKU_INFO && root.AUTODOKU_INFO.desktop);
  const local = { checked: false, installed: false, running: false, model: '', threads: 0, cores: 0, install: { state: 'idle', progress: 0 } };
  const powerQ = () => 'power=' + encodeURIComponent(settings().localPower || 'normal');
  async function checkLocal() {
    if (!isDesktop()) { local.checked = true; return local; }
    try { const r = await fetch('/stt/status?' + powerQ(), { cache: 'no-store' }); Object.assign(local, await r.json(), { checked: true }); }
    catch (e) { local.checked = true; local.installed = false; }
    return local;
  }
  async function installLocal(onProgress) {
    await fetch('/stt/install', { method: 'POST' });
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      await checkLocal();
      onProgress && onProgress(local.install);
      if (local.install.state === 'done') return local;
      if (local.install.state === 'error') throw new Error(local.install.error || 'Einrichten fehlgeschlagen');
    }
  }
  async function localRun(audio, langCode, hint) {
    const fd = new FormData();
    fd.append('file', wavBlob(audio), 'abschnitt.wav');
    fd.append('language', langCode && langCode !== 'auto' ? langCode : 'auto');
    fd.append('temperature', '0');
    fd.append('response_format', 'json');
    fd.append('prompt', whisperPrompt(hint, 300));
    let res;
    try { res = await fetch('/stt/inference?' + powerQ(), { method: 'POST', body: fd }); }
    catch (e) { throw new Error('Lokale Spracherkennung nicht erreichbar.'); }
    const b = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((b && b.error) || ('Lokale Spracherkennung: Fehler ' + res.status));
      if (/nicht eingerichtet/.test(err.message)) err.fatal = true;
      throw err;
    }
    return String((b && b.text) || '').replace(/\s+/g, ' ').trim();
  }
  if (isDesktop()) checkLocal();

  // Whisper-"Prompt": Fach, Fachbegriffe, zuletzt Gesagtes -> richtige Schreibweise (Whisper liest max. ~224 Tokens)
  function whisperPrompt(hint, maxTerms) {
    const terms = [hint && hint.glossary, root.Prompts ? root.Prompts.HTL_TERMS : ''].filter(Boolean).join(', ').slice(0, maxTerms || 450);
    const ctx = (hint && hint.context ? hint.context : '').slice(-250);
    return [hint && hint.subject ? `Unterricht ${hint.subject}.` : 'Unterricht an einer HTL.', terms ? `Fachbegriffe: ${terms}.` : '', ctx].filter(Boolean).join(' ');
  }

  // Schnelle Erkennung (statt Browser-Whisper) – auch für Handy-Stücke & Video-Umwandlung
  function cloudEngine() {
    const s = settings(), e = s.speechEngine || 'auto';
    if (e === 'whisper') return null;
    if ((e === 'local' || e === 'auto') && local.installed) return 'local';
    if (s.groqKey && e !== 'gemini') return 'groq';
    if (s.geminiKey) return 'gemini';
    return null;
  }

  function wavBlob(f32) {
    const b64 = toWavBase64(f32), bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'audio/wav' });
  }

  async function groqRun(audio, langCode, hint) {
    const key = settings().groqKey;
    if (!key) throw new Error('Kein Groq-Schlüssel (⚙️ → Spracherkennung).');
    const fd = new FormData();
    fd.append('file', wavBlob(audio), 'abschnitt.wav');
    fd.append('model', settings().groqModel || 'whisper-large-v3');
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    if (langCode && langCode !== 'auto') fd.append('language', langCode);
    fd.append('prompt', whisperPrompt(hint));
    const desktop = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && root.AUTODOKU_INFO && root.AUTODOKU_INFO.desktop;
    let res;
    try {
      res = desktop
        ? await fetch(location.origin + '/aiproxy', { method: 'POST', headers: { 'x-target-url': GROQ_URL, authorization: 'Bearer ' + key }, body: fd })
        : await fetch(GROQ_URL, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd });
    } catch (e) { throw new Error('Groq nicht erreichbar (Internet?)'); }
    const b = await res.json().catch(() => null);
    if (!res.ok) {
      const m = (b && b.error && (b.error.message || b.error)) || ('Fehler ' + res.status);
      if (res.status === 401) throw Object.assign(new Error('Groq-Schlüssel ungültig – in ⚙️ prüfen.'), { fatal: true });
      if (res.status === 429) throw new Error('Groq-Gratislimit kurz erreicht – wird gleich nochmal versucht.');
      throw new Error('Groq: ' + m);
    }
    return (b && b.text) || '';
  }

  // Ein Abschnitt mit der gewählten Erkennung
  function runEngine(engine, audio, langCode, hint) {
    if (engine === 'local') return localRun(audio, langCode, hint);
    if (engine === 'groq') return groqRun(audio, langCode, hint);
    if (engine === 'gemini') return geminiRun(audio, langCode, hint);
    return loadWhisper().then(() => whisperRun(audio, langCode));
  }

  // ---------- Aufnahme in Abschnitten ----------
  // Schneidet an Sprechpausen (Schwelle passt sich dem Raum an), nie mitten im Wort,
  // verwirft bei Rückstau nichts und wartet beim Stoppen, bis alles transkribiert ist.
  const MAX_SEC = 22, MIN_SEC = 7, PAUSE_MS = 550, MAX_QUEUE = 90;
  class ChunkTranscriber {
    constructor(h, engine) {
      this.h = h || {};
      this.engine = engine; // 'whisper' | 'gemini' | 'groq'
      this.want = false;
      this.local = engine === 'whisper' || engine === 'local';
      this.queue = [];
      this.busy = false;
      this.idleWaiters = [];
      this.level = 0; this.floor = 0.004; this.recent = [];
      this.dropped = 0;
      this.hint = {};
    }

    _state(s) { this.state = s; this.h.onState && this.h.onState(s); }

    // Fach + Fachbegriffe für Groq/Gemini (Whisper im Browser kann keine Hinweise)
    setHint(h) { this.hint = Object.assign({}, this.hint, h || {}); }

    get backlog() { return this.queue.length + (this.busy ? 1 : 0); }

    async start(lang, opts) {
      resetAuto = true;
      opts = opts || {};
      if (opts.hint) this.setHint(opts.hint);
      this.lang = lang === 'auto' ? 'auto' : (lang || 'de-AT').split('-')[0];
      this.want = true;
      const audio = { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true };
      if (opts.micId) audio.deviceId = { ideal: opts.micId };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (e) {
        this.want = false;
        this.h.onError && this.h.onError(e && e.name === 'NotFoundError' ? 'Kein Mikrofon gefunden.' : 'Mikrofon blockiert. Klick auf 🔒/🎤 in der Adressleiste → Mikrofon „Zulassen“.', true);
        return false;
      }
      // Mikrofon abgesteckt / von Windows weggenommen -> melden statt still nichts aufzunehmen
      this.stream.getAudioTracks().forEach(t => { t.onended = () => { if (this.want) this.h.onError && this.h.onError('Das Mikrofon wurde getrennt – Aufnahme gestoppt. Bitte neu starten.', true); }; });
      this.ctx = new (root.AudioContext || root.webkitAudioContext)({ sampleRate: SR_HZ });
      try { await this.ctx.resume(); } catch (e) { /* egal */ }
      const src = this.ctx.createMediaStreamSource(this.stream);
      const proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this._reset([]);
      proc.onaudioprocess = (e) => { if (this.want) this._feed(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(proc);
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      proc.connect(mute); mute.connect(this.ctx.destination);
      this.proc = proc; this.src = src;

      if (this.engine === 'whisper' && (!workerReady || status.state !== 'ready')) {
        this._state('loading');
        this.h.onInterim && this.h.onInterim('⏳ Lade Offline-Spracherkennung (einmalig) … die Aufnahme läuft schon mit.');
        loadWhisper((p) => {
          this.h.onInterim && this.h.onInterim(`⏳ Lade Offline-Spracherkennung … ${Math.round(p.progress * 100)} % (es wird schon aufgenommen)`);
          this.h.onLoad && this.h.onLoad(p.progress);
        }).then(() => {
          if (this.want) this._state('listening-local');
          this.h.onInterim && this.h.onInterim('');
          this._drain();
        }).catch((e) => {
          this.h.onError && this.h.onError('Offline-Spracherkennung konnte nicht geladen werden: ' + e.message, true);
        });
      } else {
        this._state(this.local ? 'listening-local' : 'listening');
      }
      return true;
    }

    _reset(blocks) {
      this.buf = blocks; this.bufLen = blocks.reduce((n, b) => n + b.length, 0);
      this.quietMs = 0;
      this.speechMs = 0;
      this.bufAt = Date.now() - this.bufLen / SR_HZ * 1000; // Wanduhr-Zeit des ersten Samples
    }

    _feed(data) {
      const rms = rmsOf(data);
      const ms = data.length / SR_HZ * 1000;
      // Grundrauschen = leisester Block der letzten ~10 s; Sprache = deutlich darüber
      this.recent.push(rms); if (this.recent.length > 40) this.recent.shift();
      this.floor = Math.max(0.0015, Math.min.apply(null, this.recent));
      const thr = Math.min(0.02, Math.max(0.0045, this.floor * 2.6));
      const speaking = rms > thr;
      this.level = rms; this.thr = thr;
      if (!this.buf.length) this.bufAt = Date.now() - ms;
      this.buf.push(data); this.bufLen += data.length;
      if (speaking) { this.quietMs = 0; this.speechMs += ms; } else this.quietMs += ms;
      this.h.onLevel && this.h.onLevel(rms, thr, speaking);
      const sec = this.bufLen / SR_HZ;
      if (sec >= MIN_SEC && this.quietMs >= PAUSE_MS) this._cut(false);
      else if (sec >= MAX_SEC) this._cut(true);
    }

    // forced: keine Pause gefunden -> an der leisesten Stelle der letzten 4 s schneiden, Rest bleibt für den nächsten Abschnitt
    _cut(forced) {
      if (!this.bufLen) return;
      const all = new Float32Array(this.bufLen);
      let o = 0; for (const b of this.buf) { all.set(b, o); o += b.length; }
      const at = this.bufAt, speech = this.speechMs;
      let chunk = all, rest = null;
      if (forced && all.length > 6 * SR_HZ) {
        const cut = quietestCut(all, all.length - 4 * SR_HZ, all.length);
        if (cut < all.length - 1600) { chunk = all.subarray(0, cut).slice(); rest = all.slice(cut); }
      }
      this._reset(rest ? [rest] : []);
      if (rest) this.speechMs = Math.min(speech, rest.length / SR_HZ * 1000);
      // nur wegwerfen, wenn wirklich fast nur Stille drin ist (leiser Lehrer in lautem Raum zählt nicht als Stille)
      if (speech < 450 && rmsOf(chunk) < Math.max(0.004, this.floor * 1.6)) return;
      this.queue.push({ audio: chunk, at });
      if (this.queue.length > MAX_QUEUE) {
        // Laptop kommt gar nicht mehr nach (> ~25 min Rückstand) -> erst jetzt Ältestes verwerfen
        this.queue.shift(); this.dropped++;
        if (this.dropped === 1) this.h.onError && this.h.onError('Der Laptop kommt mit der Spracherkennung nicht nach. ⚙️ → Offline-Erkennung „base“ wählen oder eine schnellere KI nehmen.', false);
      }
      this.h.onBacklog && this.h.onBacklog(this.backlog);
      this._drain();
    }

    async _drain() {
      if (this.busy) return;
      if (!this.queue.length) { this._idle(); return; }
      if (this.engine === 'whisper' && status.state !== 'ready') {
        // Whisper lädt (neu) – danach weitermachen, auch wenn nichts mehr aufgenommen wird
        if (!this.waitLoad) { this.waitLoad = true; loadWhisper().then(() => { this.waitLoad = false; this._drain(); }, () => { this.waitLoad = false; }); }
        return;
      }
      this.busy = true;
      const job = this.queue.shift();
      const n = this.queue.length;
      this.h.onInterim && this.h.onInterim(n ? `✍️ … (${n} Abschnitt${n > 1 ? 'e' : ''} warten)` : '✍️ …');
      try {
        const raw = this.engine === 'whisper' ? await whisperRun(job.audio, this.lang) : await runEngine(this.engine, job.audio, this.lang, this.hint);
        const text = cleanLoops(raw);
        if (text && !JUNK.test(text)) {
          this.hint.context = text.slice(-200);
          this.h.onFinal && this.h.onFinal(text, { at: job.at });
        }
      } catch (e) {
        // Schlüssel ungültig -> nicht jeden Abschnitt verlieren: ab jetzt offline weiter
        if (e.fatal && this.engine !== 'whisper') {
          this.h.onError && this.h.onError(e.message + ' Bis dahin läuft die Offline-Erkennung (langsamer).', false);
          this.engine = this.engine !== 'local' && local.installed ? 'local' : 'whisper'; this.local = true;
          this.queue.unshift(job); this.busy = false;
          this._drain();
          return;
        }
        // Limit / kurz offline -> Abschnitt nicht verlieren, später nochmal
        job.tries = (job.tries || 0) + 1;
        if (!e.fatal && job.tries < (this.engine === 'whisper' ? 2 : 5)) {
          this.queue.unshift(job);
          this.busy = false;
          this.h.onInterim && this.h.onInterim('⏳ Spracherkennung wartet kurz …');
          setTimeout(() => this._drain(), 4000 * job.tries);
          return;
        }
        this.h.onError && this.h.onError('Spracherkennung: ' + e.message, false);
      }
      this.busy = false;
      this.h.onInterim && this.h.onInterim('');
      this.h.onBacklog && this.h.onBacklog(this.backlog);
      this._drain();
    }

    _idle() {
      if (this.busy || this.queue.length) return;
      const w = this.idleWaiters; this.idleWaiters = [];
      w.forEach(f => f());
    }

    // Promise, das erfüllt ist, sobald alles Aufgenommene transkribiert wurde (höchstens maxMs warten)
    whenIdle(maxMs) {
      if (!this.busy && !this.queue.length) return Promise.resolve(true);
      return new Promise((res) => {
        const t = setTimeout(() => res(false), maxMs || 120000);
        this.idleWaiters.push(() => { clearTimeout(t); res(true); });
      });
    }

    stop() {
      this.want = false;
      this._cut(false);
      try { this.proc && this.proc.disconnect(); this.src && this.src.disconnect(); } catch (e) { /* egal */ }
      try { this.stream && this.stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); } catch (e) { /* egal */ }
      try { this.ctx && this.ctx.close(); } catch (e) { /* egal */ }
      this.level = 0;
      this._state('stopped');
      if (!this.queue.length && !this.busy) this._idle();
    }
  }
  root.ChunkTranscriber = ChunkTranscriber;
  function probe(audio) { const id = ++jobId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ type: 'probe', id, audio }); }); }
  root.Whisper = { probe, cleanLoops, cloudEngine, groqRun, localRun, checkLocal, installLocal, localState: local, isDesktop, run: (a, l) => loadWhisper().then(() => whisperRun(a, l)), load: loadWhisper, status, transcribeLong, decodeFile, model: modelName };
})(window);
