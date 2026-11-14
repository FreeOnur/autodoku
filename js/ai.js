/*
 * AutoDoku – KI-Anbieter
 *   chrome : eingebaute Chrome-KI (Gemini Nano) – läuft lokal, gratis, ohne Schlüssel
 *   gemini : Google Gemini API – Gratis-Kontingent mit kostenlosem Schlüssel (aistudio.google.com)
 *   claude : Claude API mit eigenem Schlüssel (kostenpflichtig)
 *   openai : OpenAI-kompatible API (OpenAI, Groq, Mistral, OpenRouter …)
 *   ollama : Ollama auf dem eigenen PC – gratis, offline. In der Desktop-App verwaltet AutoDoku Ollama selbst
 *            (installieren, bei Bedarf starten, beim Beenden schließen)
 *   auto   : Claude wenn ein Schlüssel da ist, sonst Gemini, sonst Ollama, sonst Chrome-KI
 * Gleiche Schnittstelle wie Claude.call / Claude.stream.
 */
(function (root) {
  'use strict';

  const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
  const S = () => root.Store.Settings.get();
  const Err = root.Claude.ClaudeError;

  // ---------- Chrome-KI ----------
  const LM = () => root.LanguageModel || (root.ai && root.ai.languageModel) || null;
  const LM_OPTS = {
    expectedInputs: [{ type: 'text', languages: ['de', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['de'] }],
  };
  const chrome = { state: LM() ? 'checking' : 'unsupported', progress: 0 };

  async function checkChrome() {
    const lm = LM();
    if (!lm) { chrome.state = 'unsupported'; return chrome.state; }
    try { chrome.state = await lm.availability(LM_OPTS); } catch (e) {
      try { chrome.state = await lm.availability(); } catch (e2) { chrome.state = 'unavailable'; }
    }
    if (chrome.state === 'readily') chrome.state = 'available';
    if (chrome.state === 'after-download') chrome.state = 'downloadable';
    if (chrome.state === 'no') chrome.state = 'unavailable';
    api.onChange && api.onChange();
    return chrome.state;
  }

  async function createSession(system, history, onProgress) {
    const lm = LM();
    if (!lm) throw new Err('Dieser Browser hat keine eingebaute KI (braucht aktuelles Chrome am PC).', 0, 'chrome_unsupported');
    const initialPrompts = [{ role: 'system', content: system || 'Du bist ein hilfreicher Assistent. Antworte auf Deutsch.' }];
    (history || []).forEach(m => initialPrompts.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: textOf(m.content) }));
    const opts = Object.assign({}, LM_OPTS, {
      initialPrompts,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          chrome.state = 'downloading';
          chrome.progress = e.loaded > 1 ? e.loaded / (e.total || 100) : e.loaded;
          onProgress && onProgress(chrome.progress);
          api.onChange && api.onChange();
        });
      },
    });
    try {
      const s = await lm.create(opts);
      chrome.state = 'available';
      return s;
    } catch (e) {
      if (/NotAllowed|activation|gesture/i.test(e.name + ' ' + e.message)) {
        throw new Err('Die Chrome-KI muss einmal per Klick geladen werden: ⚙️ → „Chrome-KI laden“.', 0, 'chrome_download');
      }
      throw new Err('Chrome-KI: ' + e.message, 0, 'chrome_error');
    }
  }

  const textOf = (c) => (typeof c === 'string' ? c : (c || []).filter(b => b.type === 'text').map(b => b.text).join('\n'));
  const hasImage = (msgs) => msgs.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'));

  async function quotaOf(session) {
    const q = session.inputQuota || session.maxTokens || 6000;
    const used = session.inputUsage || (session.maxTokens && session.tokensSoFar) || 0;
    return Math.max(500, q - used - 50);
  }
  async function measure(session, text) {
    try {
      if (session.measureInputUsage) return await session.measureInputUsage(text);
      if (session.countPromptTokens) return await session.countPromptTokens(text);
    } catch (e) { /* schätzen */ }
    return Math.ceil(text.length / 3.2);
  }
  // Text kürzen, bis er ins Kontextfenster der lokalen KI passt (lange """-Blöcke von vorne kürzen)
  async function fit(session, text) {
    const room = await quotaOf(session);
    for (let i = 0; i < 6; i++) {
      const n = await measure(session, text);
      if (n <= room) return text;
      const ratio = room / n * 0.92;
      const m = /"""\n?([\s\S]*?)\n?"""/.exec(text);
      if (m && m[1].length > 400) {
        const keep = Math.max(300, Math.floor(m[1].length - (text.length * (1 - ratio))));
        const cut = '…' + m[1].slice(m[1].length - keep);
        text = text.replace(m[1], cut);
      } else {
        text = text.slice(0, Math.floor(text.length * ratio));
      }
    }
    return text;
  }

  async function chromeCall(o, onText) {
    if (hasImage(o.messages)) throw new Err('Die lokale Chrome-KI kann keine Fotos lesen.', 0, 'no_images');
    const msgs = o.messages.slice();
    const last = msgs.pop();
    const session = await createSession(o.system, msgs);
    try {
      const input = await fit(session, textOf(last.content));
      let text = '';
      if (onText && session.promptStreaming) {
        const stream = session.promptStreaming(input, { signal: o.signal });
        let prev = '';
        for await (const chunk of stream) {
          // ältere Chrome-Versionen liefern den ganzen Text, neuere nur das Stück
          if (prev && chunk.startsWith(prev)) text = chunk; else text += chunk;
          prev = text;
          onText(text, chunk);
        }
      } else {
        text = await session.prompt(input, { signal: o.signal });
      }
      report(o, Math.ceil(input.length / 3.5), Math.ceil(text.length / 3.5));
      return { text, stop: 'end_turn' };
    } finally {
      try { session.destroy(); } catch (e) { /* egal */ }
    }
  }

  // ---------- Gemini ----------
  function geminiModel(o) {
    const s = S();
    const cached = JSON.parse(localStorage.getItem('autodoku.geminiModels') || 'null') || {};
    if (o.tier === 'live') return s.geminiLive || cached.live || 'gemini-3.5-flash-lite';
    return s.geminiFinal || cached.final || 'gemini-3.8-flash';
  }

  function geminiBody(o) {
    const contents = o.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).map(b =>
        b.type === 'image' ? { inline_data: { mime_type: b.source.media_type, data: b.source.data } } : { text: b.text }),
    }));
    const body = { contents, generationConfig: { maxOutputTokens: Math.max(4096, (o.maxTokens || 4000) * 2) } };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    if (o.temperature != null) body.generationConfig.temperature = o.temperature;
    return body;
  }

  function geminiFriendly(status, b) {
    const m = (b && b.error && b.error.message) || '';
    if (status === 400 && /API key/i.test(m)) return 'Gemini-Schlüssel ungültig – in ⚙️ prüfen.';
    if (status === 403) return 'Gemini-Schlüssel hat keinen Zugriff (403). Neuen Schlüssel auf aistudio.google.com erstellen.';
    if (status === 429) return 'Gratis-Limit von Gemini kurz erreicht – AutoDoku versucht es gleich nochmal.';
    if (status === 404) return 'Gemini-Modell nicht gefunden.';
    return m || `Gemini-Fehler ${status}`;
  }

  // Neuestes passendes Gratis-Modell automatisch finden
  async function pickGeminiModels(key) {
    const res = await fetch(`${GBASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Err(geminiFriendly(res.status, b), res.status);
    const ok = (b.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-[\d.]+-flash(-lite)?(-preview)?(-\d+)?$/.test(n));
    const ver = (n) => parseFloat((/gemini-([\d.]+)/.exec(n) || [0, 0])[1]);
    const rank = (a, b2) => ver(b2) - ver(a) || (a.includes('preview') ? 1 : 0) - (b2.includes('preview') ? 1 : 0);
    const flash = ok.filter(n => !n.includes('lite')).sort(rank);
    const lite = ok.filter(n => n.includes('lite')).sort(rank);
    const pick = { final: flash[0] || lite[0], live: lite[0] || flash[0] };
    if (!pick.final) throw new Err('Kein passendes Gemini-Modell gefunden.', 404);
    localStorage.setItem('autodoku.geminiModels', JSON.stringify(pick));
    return pick;
  }

  async function geminiFetch(o, model, streaming) {
    const key = S().geminiKey;
    if (!key) throw new Err('Kein Gemini-Schlüssel gesetzt (⚙️ Einstellungen).', 0, 'no_key');
    const url = `${GBASE}/models/${model}:${streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(geminiBody(o)), signal: o.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Err('Keine Verbindung zu Gemini (Internet?).', 0, 'network');
    }
    return res;
  }

  async function geminiCall(o, onText, retried) {
    const model = geminiModel(o);
    const res = await geminiFetch(o, model, !!onText);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      if (res.status === 404 && !retried) {
        const pick = await pickGeminiModels(S().geminiKey);
        root.Store.Settings.set({ geminiLive: pick.live, geminiFinal: pick.final });
        return geminiCall(o, onText, true);
      }
      throw new Err(geminiFriendly(res.status, b), res.status);
    }
    const partsText = (cand) => ((cand && cand.content && cand.content.parts) || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    let text = '', usage = null, finish = null;
    if (!onText) {
      const b = await res.json();
      const cand = (b.candidates || [])[0];
      text = partsText(cand);
      usage = b.usageMetadata; finish = cand && cand.finishReason;
      if (!text && b.promptFeedback && b.promptFeedback.blockReason) throw new Err('Gemini hat die Anfrage blockiert: ' + b.promptFeedback.blockReason, 400);
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          const cand = (ev.candidates || [])[0];
          const t = partsText(cand);
          if (t) { text += t; onText(text, t); }
          if (ev.usageMetadata) usage = ev.usageMetadata;
          if (cand && cand.finishReason) finish = cand.finishReason;
        }
      }
    }
    report(o, (usage && usage.promptTokenCount) || 0, (usage && (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) || 0);
    return { text, stop: finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn' };
  }


  // Desktop-App: Anfragen laufen über den lokalen Server (kein CORS-Problem)
  const isLocalHost = location.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

  // ---------- Ollama (lokale KI auf dem eigenen PC) ----------
  const OBASE = isLocalHost ? location.origin + '/ollama' : 'http://127.0.0.1:11434';
  const isDesk = () => isLocalHost && !!(root.AUTODOKU_INFO && root.AUTODOKU_INFO.desktop);
  const cachedModels = () => { try { return JSON.parse(localStorage.getItem('autodoku.ollamaModels') || '[]'); } catch (e) { return []; } };
  // state: checking | running | stopped (installiert, läuft gerade nicht) | missing (nicht installiert) | offline (Browser: nicht erreichbar)
  const ollama = { state: 'checking', models: cachedModels(), pulling: null, installed: false, ctl: null };
  const ramGB = () => (root.AUTODOKU_INFO && root.AUTODOKU_INFO.ramGB) || navigator.deviceMemory || 8;

  async function checkOllama() {
    if (isDesk()) {
      // Desktop-App: fragt die Verwaltung (startet dabei nichts)
      try {
        const st = await (await fetch('/ollamactl/status', { cache: 'no-store' })).json();
        ollama.ctl = st; ollama.installed = st.installed || st.running;
        if (st.running) { ollama.models = st.models.map(m => m.name); ollama.state = 'running'; try { localStorage.setItem('autodoku.ollamaModels', JSON.stringify(ollama.models)); } catch (e) { /* egal */ } }
        else { ollama.state = st.installed ? 'stopped' : 'missing'; ollama.models = cachedModels(); }
      } catch (e) { ollama.state = 'offline'; }
      api.onChange && api.onChange();
      return ollama.state;
    }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(OBASE + '/api/tags', { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const b = await res.json();
      ollama.models = (b.models || []).map(m => m.name);
      ollama.state = 'running';
    } catch (e) {
      ollama.state = 'offline';
      ollama.models = [];
    }
    api.onChange && api.onChange();
    return ollama.state;
  }

  function recommendedModel() { return ramGB() >= 12 ? 'qwen3:4b' : 'qwen3:1.7b'; }

  // Desktop: Ollama erst starten, wenn es gebraucht wird
  async function ensureOllama() {
    if (ollama.state === 'running') return true;
    if (!isDesk()) { await checkOllama(); return ollama.state === 'running'; }
    const r = await fetch('/ollamactl/start', { method: 'POST' });
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Err(b.error || 'Ollama startet nicht.', 0, 'ollama_offline'); }
    await checkOllama();
    return ollama.state === 'running';
  }
  // Wie viele Kerne Ollama nutzen darf (gleiche Einstellung wie die lokale Spracherkennung)
  function ollamaThreads() {
    const n = (root.AUTODOKU_INFO && root.AUTODOKU_INFO.cpus) || navigator.hardwareConcurrency || 8;
    const p = S().localPower || 'normal';
    if (p === 'schnell') return 0; // Ollama entscheidet
    return Math.max(2, Math.min(p === 'leise' ? 4 : 6, n - 2));
  }

  function ollamaModel() {
    const want = S().ollamaModel;
    if (want && ollama.models.includes(want)) return want;
    const prefs = ['qwen3:4b', 'qwen3:8b', 'gemma3:4b', 'qwen3:1.7b', 'qwen2.5:3b', 'llama3.2:3b', 'gemma3:1b'];
    for (const p of prefs) if (ollama.models.includes(p)) return p;
    return ollama.models.find(m => !/embed/i.test(m)) || want || recommendedModel();
  }
  const ollamaVision = (m) => /gemma3(?!:1b)|llava|vl|vision|minicpm|moondream/i.test(m || '');

  function shrinkChars(text, maxChars) {
    if (text.length <= maxChars) return text;
    const q = '"' + '"' + '"';
    const a = text.indexOf(q), b = a >= 0 ? text.indexOf(q, a + 3) : -1;
    if (a >= 0 && b > a) {
      const inner = text.slice(a + 3, b);
      const over = text.length - maxChars;
      if (inner.length > over + 500) return text.slice(0, a + 3) + '…' + inner.slice(over + 1) + text.slice(b);
    }
    return text.slice(0, maxChars);
  }

  // Kontextfenster für Ollama: auf Rechnern mit viel RAM größer, damit lange Stunden reinpassen
  function ollamaCtx(tier) {
    const ram = ramGB();
    if (tier === 'final') return ram >= 24 ? 32768 : ram >= 12 ? 16384 : 8192;
    return 8192;
  }
  function ollamaPredict(o) { return Math.min(o.maxTokens || 2000, o.tier === 'final' ? (ramGB() >= 12 ? 6144 : 4096) : 2048); }

  async function ollamaCall(o, onText, noThink) {
    const model = ollamaModel();
    const numCtx = ollamaCtx(o.tier);
    const numPredict = ollamaPredict(o);
    const maxChars = Math.floor((numCtx - numPredict) * 2.8) - (o.system || '').length;
    const messages = [];
    if (o.system) messages.push({ role: 'system', content: o.system });
    o.messages.forEach((m, i) => {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      let text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (i === o.messages.length - 1) text = shrinkChars(text, Math.max(2000, maxChars));
      const msg = { role: m.role === 'assistant' ? 'assistant' : 'user', content: text };
      const imgs = blocks.filter(b => b.type === 'image' && /^image\//.test(b.source.media_type)).map(b => b.source.data);
      if (imgs.length && ollamaVision(model)) msg.images = imgs;
      messages.push(msg);
    });
    const body = { model, messages, stream: !!onText, keep_alive: '10m', options: { num_ctx: numCtx, num_predict: numPredict } };
    const th = ollamaThreads(); if (th) body.options.num_thread = th;
    if (o.temperature != null) body.options.temperature = o.temperature;
    if (!noThink) body.think = false;
    let res;
    try {
      res = await fetch(OBASE + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: o.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      ollama.state = 'offline'; api.onChange && api.onChange();
      throw new Err(isDesk() ? 'Ollama läuft nicht – AutoDoku versucht es gleich nochmal.' : 'Ollama läuft nicht. Starte die Ollama-App (Startmenü → Ollama).', 0, 'ollama_offline');
    }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      const msg = b.error || ('Ollama-Fehler ' + res.status);
      if (!noThink && /think/i.test(msg)) return ollamaCall(o, onText, true);
      if (/not found|pull/i.test(msg)) throw new Err(`Modell „${model}“ fehlt – ⚙️ → „Modell laden“.`, 404, 'ollama_model');
      throw new Err('Ollama: ' + msg, res.status);
    }
    const clean = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
    let raw = '', pin = 0, pout = 0;
    if (!onText) {
      const b = await res.json();
      raw = (b.message && b.message.content) || '';
      pin = b.prompt_eval_count || 0; pout = b.eval_count || 0;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.error) throw new Err('Ollama: ' + ev.error, 500);
          if (ev.message && ev.message.content) { raw += ev.message.content; onText(clean(raw), ev.message.content); }
          if (ev.done) { pin = ev.prompt_eval_count || 0; pout = ev.eval_count || 0; }
        }
      }
    }
    report(o, pin, pout);
    return { text: clean(raw), stop: pout >= numPredict ? 'max_tokens' : 'end_turn' };
  }

  // Modell direkt aus der App herunterladen (mit Fortschritt)
  async function pullOllama(model, onProgress) {
    await ensureOllama();
    const res = await fetch(OBASE + '/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    if (!res.ok) throw new Err('Download fehlgeschlagen (' + res.status + ')', res.status);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    ollama.pulling = { model, progress: 0, status: 'starte' };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.error) { ollama.pulling = null; throw new Err(ev.error, 500); }
        ollama.pulling = { model, status: ev.status, progress: ev.total ? (ev.completed || 0) / ev.total : ollama.pulling.progress };
        onProgress && onProgress(ollama.pulling);
      }
    }
    ollama.pulling = null;
    await checkOllama();
    return true;
  }


  // ---------- Eigene API (OpenAI-kompatibel: OpenAI, Groq, Mistral, OpenRouter, DeepSeek, LM Studio …) ----------
  const OA_PRESETS = {
    openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini', key: 'platform.openai.com/api-keys' },
    groq: { label: 'Groq (Gratis-Kontingent, sehr schnell)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: 'console.groq.com/keys' },
    mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', key: 'console.mistral.ai/api-keys' },
    openrouter: { label: 'OpenRouter (viele Modelle)', base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash', key: 'openrouter.ai/keys' },
    deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'platform.deepseek.com/api_keys' },
    lmstudio: { label: 'LM Studio (lokal)', base: 'http://127.0.0.1:1234/v1', model: '', key: '' },
    custom: { label: 'Eigene Adresse', base: '', model: '', key: '' },
  };
  // In der Desktop-App gehen Anfragen über den lokalen Server (kein CORS-Problem)
  function oaUrl(path) {
    const base = (S().oaBase || '').replace(/\/+$/, '');
    return base + path;
  }
  function oaFetch(url, init) {
    if (isLocalHost && root.AUTODOKU_INFO && root.AUTODOKU_INFO.desktop) {
      init = Object.assign({}, init, { headers: Object.assign({}, init.headers, { 'x-target-url': url }) });
      return fetch(location.origin + '/aiproxy', init);
    }
    return fetch(url, init);
  }
  async function listOpenAIModels(base, key) {
    const res = await oaFetch(base.replace(/\/+$/, '') + '/models', { method: 'GET', headers: key ? { authorization: 'Bearer ' + key } : {} });
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Err((b && b.error && (b.error.message || b.error)) || ('Fehler ' + res.status), res.status);
    return ((b && b.data) || []).map(m => m.id).sort();
  }
  async function openaiCall(o, onText) {
    const s = S();
    if (!s.oaBase) throw new Err('Eigene API: Adresse fehlt (⚙️).', 0, 'no_key');
    const model = (o.tier === 'live' && s.oaModelLive) || s.oaModel;
    if (!model) throw new Err('Eigene API: Modellname fehlt (⚙️).', 0, 'no_key');
    const messages = [];
    if (o.system) messages.push({ role: 'system', content: o.system });
    o.messages.forEach(m => {
      if (typeof m.content === 'string') return messages.push({ role: m.role, content: m.content });
      const parts = m.content.map(b => b.type === 'image'
        ? (/^image\//.test(b.source.media_type) ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : null)
        : { type: 'text', text: b.text }).filter(Boolean);
      messages.push({ role: m.role, content: s.oaVision === false ? parts.filter(x => x.type === 'text').map(x => x.text).join('\n') : parts });
    });
    const body = { model, messages, stream: !!onText, max_tokens: o.maxTokens || 4000 };
    if (o.temperature != null) body.temperature = o.temperature;
    let res;
    try {
      res = await oaFetch(oaUrl('/chat/completions'), { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, s.oaKey ? { authorization: 'Bearer ' + s.oaKey } : {}), body: JSON.stringify(body), signal: o.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Err('Eigene API nicht erreichbar (Adresse/Internet prüfen).', 0, 'network');
    }
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      const m = (b && b.error && (b.error.message || b.error)) || '';
      if (res.status === 401) throw new Err('Eigene API: Schlüssel ungültig (401).', 401);
      if (res.status === 429) throw new Err('Eigene API: Limit erreicht (429) – gleich nochmal.', 429);
      throw new Err('Eigene API: ' + (m || res.status), res.status);
    }
    const clean = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
    let raw = '', usage = null, finish = null;
    if (!onText) {
      const b = await res.json();
      const c = (b.choices || [])[0] || {};
      raw = (c.message && c.message.content) || ''; usage = b.usage; finish = c.finish_reason;
    } else {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim(); if (d === '[DONE]') continue;
          let ev; try { ev = JSON.parse(d); } catch (e) { continue; }
          const c = (ev.choices || [])[0];
          const t = c && c.delta && c.delta.content;
          if (t) { raw += t; onText(clean(raw), t); }
          if (c && c.finish_reason) finish = c.finish_reason;
          if (ev.usage) usage = ev.usage;
        }
      }
    }
    report(o, (usage && usage.prompt_tokens) || 0, (usage && usage.completion_tokens) || 0);
    return { text: clean(raw), stop: finish === 'length' ? 'max_tokens' : 'end_turn' };
  }

  // ---------- Router ----------
  function report(o, input, output) {
    if (typeof root.Claude.onUsage === 'function') {
      try { root.Claude.onUsage({ tag: o.tag, model: 'gratis', input, output, cost: 0 }); } catch (e) { /* egal */ }
    }
  }

  function provider() {
    const s = S();
    let p = s.provider || 'auto';
    if (p !== 'auto') return p;
    if (s.apiKey) return 'claude';
    if (s.geminiKey) return 'gemini';
    if (s.oaBase && s.oaModel) return 'openai';
    if ((ollama.state === 'running' || ollama.installed) && ollama.models.length) return 'ollama';
    if (chrome.state === 'available' || chrome.state === 'downloadable' || chrome.state === 'downloading' || chrome.state === 'checking') return 'chrome';
    return 'none';
  }

  function ready() {
    const p = provider();
    if (p === 'chrome') return chrome.state === 'available' || chrome.state === 'checking';
    if (p === 'ollama') return (ollama.state === 'running' || ollama.installed || ollama.state === 'checking') && ollama.models.length > 0;
    if (p === 'gemini') return !!S().geminiKey;
    if (p === 'claude') return !!S().apiKey;
    if (p === 'openai') return !!(S().oaBase && S().oaModel);
    return false;
  }

  function label() {
    const p = provider();
    return { ollama: '🦙 Ollama (lokal)', chrome: '🖥️ Chrome-KI (lokal, gratis)', gemini: '🔷 Gemini (gratis)', claude: '🟠 Claude', openai: '🔌 ' + ((OA_PRESETS[S().oaPreset] || {}).label || 'Eigene API'), none: 'keine KI' }[p];
  }

  function why() {
    const p = provider();
    if (p === 'chrome' && (chrome.state === 'downloadable' || chrome.state === 'downloading')) return 'Chrome-KI noch nicht geladen – ⚙️ → „Chrome-KI laden“ (einmalig).';
    if (p === 'ollama' && ollama.state === 'missing') return 'Ollama ist noch nicht installiert – ⚙️ → KI → „Ollama einrichten“.';
    if (p === 'ollama' && !ollama.models.length) return 'Ollama hat noch kein Modell – ⚙️ → „Modell laden“.';
    if (p === 'ollama' && ollama.state === 'offline') return 'Ollama läuft nicht. Starte die Ollama-App (Startmenü → Ollama).';
    if (p === 'gemini' && !S().geminiKey) return 'Gemini-Schlüssel fehlt (gratis auf aistudio.google.com).';
    if (p === 'claude' && !S().apiKey) return 'Claude-API-Schlüssel fehlt.';
    if (p === 'openai' && !(S().oaBase && S().oaModel)) return 'Eigene API: Adresse oder Modell fehlt (⚙️).';
    if (p === 'none') return 'Keine KI aktiv: in ⚙️ deinen Claude-API-Schlüssel eintragen (oder einen Gratis-Gemini-Schlüssel).';
    return '';
  }

  // Wie viele Zeichen passen ungefähr in EINE Anfrage (Nachricht ohne System-Prompt)?
  // Die App portioniert danach, statt dass Text stillschweigend abgeschnitten wird.
  function budget(tier, systemLen) {
    const p = provider();
    const sys = systemLen || 0;
    if (p === 'chrome') return Math.max(2500, 15000 - sys); // Gemini Nano: ca. 6000 Tokens
    if (p === 'ollama') {
      const o = { tier, maxTokens: tier === 'final' ? 16000 : 3500 };
      return Math.max(2500, Math.floor((ollamaCtx(tier) - ollamaPredict(o)) * 2.8) - sys);
    }
    if (p === 'openai') return oaLocal() ? Math.max(2500, 15000 - sys) : 90000; // lokal (LM Studio) wie Ollama, sonst ≈ 32k Tokens
    return 400000; // Claude, Gemini: großes Kontextfenster
  }
  // Kleine Modelle (wenig Kontext/Ausgabe): beim Polieren lieber die Live-Mitschrift behalten
  // LM Studio / eigene Adresse auf diesem PC = meist kleines Modell mit wenig Kontext
  const oaLocal = () => S().oaPreset === 'lmstudio' || /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(S().oaBase || '');
  const smallModel = () => ['ollama', 'chrome'].includes(provider()) || (provider() === 'openai' && oaLocal());

  const supportsImages = () => { const p = provider(); return p === 'ollama' ? ollamaVision(ollamaModel()) : p === 'openai' ? S().oaVision !== false : p !== 'chrome'; };
  const isFree = () => !['claude', 'openai'].includes(provider());

  async function call(o, opts) {
    const p = (opts && opts.forceProvider) || provider();
    if (p === 'claude') return root.Claude.call(Object.assign({}, o, { apiKey: S().apiKey }));
    if (p === 'ollama') { await ensureOllama(); return ollamaCall(o, null); }
    if (p === 'gemini') return geminiCall(o, null);
    if (p === 'chrome') return chromeCall(o, null);
    if (p === 'openai') return openaiCall(o, null);
    throw new Err(why() || 'Keine KI eingerichtet.', 0, 'no_key');
  }
  async function stream(o) {
    const p = provider();
    if (p === 'claude') return root.Claude.stream(Object.assign({}, o, { apiKey: S().apiKey }));
    if (p === 'ollama') { await ensureOllama(); return ollamaCall(o, o.onText || (() => {})); }
    if (p === 'gemini') return geminiCall(o, o.onText || (() => {}));
    if (p === 'chrome') return chromeCall(o, o.onText || (() => {}));
    if (p === 'openai') return openaiCall(o, o.onText || (() => {}));
    throw new Err(why() || 'Keine KI eingerichtet.', 0, 'no_key');
  }

  // Chrome-KI per Klick laden (Download braucht eine Nutzer-Aktion)
  async function prepareChrome(onProgress) {
    const s = await createSession('Test', [], onProgress);
    try { s.destroy(); } catch (e) { /* egal */ }
    await checkChrome();
    return chrome.state;
  }

  const api = { call, stream, ready, provider, label, why, supportsImages, isFree, budget, smallModel, checkChrome, prepareChrome, pickGeminiModels, chrome,
    ollama, checkOllama, ensureOllama, pullOllama, ollamaModel, recommendedModel, OA_PRESETS, listOpenAIModels, onChange: null };
  root.AI = api;
  checkChrome();
  checkOllama();
})(window);
