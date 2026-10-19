/*
 * AutoDoku – KI-Anbieter
 *   chrome : eingebaute Chrome-KI (Gemini Nano) – läuft lokal, gratis, ohne Schlüssel
 *   gemini : Google Gemini API – Gratis-Kontingent mit kostenlosem Schlüssel (aistudio.google.com)
 *   claude : Claude API mit eigenem Schlüssel (kostenpflichtig)
 *   auto   : Chrome-KI wenn verfügbar, sonst Gemini (Claude nur, wenn ausdrücklich gewählt)
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

  // ---------- Router ----------
  function report(o, input, output) {
    if (typeof root.Claude.onUsage === 'function') {
      try { root.Claude.onUsage({ tag: o.tag, model: 'gratis', input, output, cost: 0 }); } catch (e) { /* egal */ }
    }
  }

  function provider() {
    const s = S();
    const p = s.provider || 'auto';
    if (p !== 'auto') return p;
    if (chrome.state === 'available' || chrome.state === 'downloadable' || chrome.state === 'downloading') return 'chrome';
    if (s.geminiKey) return 'gemini';
    if (chrome.state === 'checking') return 'chrome';
    return 'none';
  }

  function ready() {
    const p = provider();
    if (p === 'chrome') return chrome.state === 'available' || chrome.state === 'checking';
    if (p === 'gemini') return !!S().geminiKey;
    if (p === 'claude') return !!S().apiKey;
    return false;
  }

  function label() {
    const p = provider();
    return { chrome: '🖥️ Chrome-KI (lokal, gratis)', gemini: '🔷 Gemini (gratis)', claude: '🟠 Claude', none: 'keine KI' }[p];
  }

  function why() {
    const p = provider();
    if (p === 'chrome' && (chrome.state === 'downloadable' || chrome.state === 'downloading')) return 'Chrome-KI noch nicht geladen – ⚙️ → „Chrome-KI laden“ (einmalig).';
    if (p === 'gemini' && !S().geminiKey) return 'Gemini-Schlüssel fehlt (gratis auf aistudio.google.com).';
    if (p === 'claude' && !S().apiKey) return 'Claude-API-Schlüssel fehlt.';
    if (p === 'none') return 'Keine Gratis-KI verfügbar: in ⚙️ einen kostenlosen Gemini-Schlüssel eintragen.';
    return '';
  }

  const supportsImages = () => provider() !== 'chrome';
  const isFree = () => provider() !== 'claude';

  async function call(o) {
    const p = provider();
    if (p === 'claude') return root.Claude.call(Object.assign({}, o, { apiKey: S().apiKey }));
    if (p === 'gemini') return geminiCall(o, null);
    if (p === 'chrome') return chromeCall(o, null);
    throw new Err(why() || 'Keine KI eingerichtet.', 0, 'no_key');
  }
  async function stream(o) {
    const p = provider();
    if (p === 'claude') return root.Claude.stream(Object.assign({}, o, { apiKey: S().apiKey }));
    if (p === 'gemini') return geminiCall(o, o.onText || (() => {}));
    if (p === 'chrome') return chromeCall(o, o.onText || (() => {}));
    throw new Err(why() || 'Keine KI eingerichtet.', 0, 'no_key');
  }

  // Chrome-KI per Klick laden (Download braucht eine Nutzer-Aktion)
  async function prepareChrome(onProgress) {
    const s = await createSession('Test', [], onProgress);
    try { s.destroy(); } catch (e) { /* egal */ }
    await checkChrome();
    return chrome.state;
  }

  const api = { call, stream, ready, provider, label, why, supportsImages, isFree, checkChrome, prepareChrome, pickGeminiModels, chrome, onChange: null };
  root.AI = api;
  checkChrome();
})(window);
