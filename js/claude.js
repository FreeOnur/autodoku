/* AutoDoku – Claude API (direkt aus dem Browser, Schlüssel bleibt lokal) */
(function (root) {
  'use strict';

  const API = 'https://api.anthropic.com/v1/messages';
  const usage = { input: 0, output: 0, calls: 0 };

  // Preise in US-Dollar pro 1 Mio. Tokens [Input, Output] (Stand Okt. 2026, platform.claude.com/docs/en/about-claude/pricing)
  const PRICES = {
    'claude-haiku-5-5': [0.10, 0.50],
    'claude-sonnet-5-5': [2, 10],
    'claude-opus-5-5': [4, 20],
    'claude-sonnet-5': [2, 10],
    'claude-haiku-4-5': [1, 5],
    'claude-sonnet-4-5': [3, 15],
    'claude-opus-4-5': [5, 25],
  };
  function cost(model, input, output) {
    const key = Object.keys(PRICES).find(k => String(model || '').startsWith(k));
    if (!key) return null;
    let [pi, po] = PRICES[key];
    if (key === 'claude-haiku-5-5' && input > 100000) { pi = 0.5; po = 2.5; } // langer Prompt = teurer
    return (input * pi + output * po) / 1e6;
  }
  function report(o, input, output) {
    if (typeof api.onUsage === 'function') {
      try { api.onUsage({ tag: o.tag, model: o.model, input, output, cost: cost(o.model, input, output) }); } catch (e) { /* egal */ }
    }
  }

  class ClaudeError extends Error {
    constructor(msg, status, type) { super(msg); this.status = status; this.type = type; }
  }

  function headers(key) {
    return {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  function friendly(status, body) {
    const t = body && body.error && body.error.type;
    const m = body && body.error && body.error.message;
    if (status === 401) return 'API-Schlüssel ungültig. Bitte in den Einstellungen prüfen.';
    if (status === 403) return 'Kein Zugriff mit diesem API-Schlüssel (403).';
    if (status === 404) return `Modell nicht gefunden – prüfe den Modellnamen in den Einstellungen. (${m || ''})`;
    if (status === 429) return 'Zu viele Anfragen – kurz warten, AutoDoku versucht es gleich nochmal.';
    if (status === 529 || t === 'overloaded_error') return 'Claude ist gerade überlastet – nächster Versuch folgt automatisch.';
    if (status === 400 && /credit/i.test(m || '')) return 'Kein Guthaben auf dem API-Konto (console.anthropic.com → Billing).';
    return m || `Fehler ${status}`;
  }

  function buildBody(o) {
    const body = {
      model: o.model,
      max_tokens: o.maxTokens || 4000,
      system: o.system,
      messages: o.messages,
    };
    if (o.temperature != null) body.temperature = o.temperature;
    return body;
  }

  async function call(o) {
    const key = o.apiKey;
    if (!key) throw new ClaudeError('Kein API-Schlüssel gesetzt (Einstellungen ⚙️).', 0, 'no_key');
    let res;
    try {
      res = await fetch(API, { method: 'POST', headers: headers(key), body: JSON.stringify(buildBody(o)), signal: o.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ClaudeError('Keine Verbindung zu Claude (Internet?).', 0, 'network');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ClaudeError(friendly(res.status, body), res.status, body && body.error && body.error.type);
    const ui = (body.usage && body.usage.input_tokens) || 0, uo = (body.usage && body.usage.output_tokens) || 0;
    usage.input += ui; usage.output += uo;
    usage.calls++;
    report(o, ui, uo);
    const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return { text, stop: body.stop_reason, usage: body.usage };
  }

  // Streaming (Server-Sent Events) – für lange Antworten mit Live-Vorschau
  async function stream(o) {
    const key = o.apiKey;
    if (!key) throw new ClaudeError('Kein API-Schlüssel gesetzt (Einstellungen ⚙️).', 0, 'no_key');
    const body = buildBody(o);
    body.stream = true;
    let res;
    try {
      res = await fetch(API, { method: 'POST', headers: headers(key), body: JSON.stringify(body), signal: o.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ClaudeError('Keine Verbindung zu Claude (Internet?).', 0, 'network');
    }
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new ClaudeError(friendly(res.status, b), res.status, b && b.error && b.error.type);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', stop = null, ui = 0, uo = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        let ev;
        try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          text += ev.delta.text;
          if (o.onText) o.onText(text, ev.delta.text);
        } else if (ev.type === 'message_start' && ev.message && ev.message.usage) {
          ui = ev.message.usage.input_tokens || 0;
          usage.input += ui;
        } else if (ev.type === 'message_delta') {
          if (ev.usage) { uo = ev.usage.output_tokens || uo; if (ev.usage.input_tokens) ui = ev.usage.input_tokens; }
          if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        } else if (ev.type === 'error') {
          throw new ClaudeError(ev.error && ev.error.message || 'Stream-Fehler', 0, ev.error && ev.error.type);
        }
      }
    }
    usage.output += uo;
    usage.calls++;
    report(o, ui, uo);
    return { text, stop };
  }

  // Wiederholung bei Überlastung / Rate-Limit
  async function withRetry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!(e instanceof ClaudeError) || ![429, 500, 502, 503, 529].includes(e.status)) throw e;
        await new Promise(r => setTimeout(r, 2500 * (i + 1)));
      }
    }
    throw last;
  }

  // <tag>…</tag> aus Antwort lesen
  function tag(text, name) {
    const m = new RegExp(`<${name}>([\\s\\S]*?)(?:</${name}>|$)`).exec(text || '');
    return m ? m[1].trim() : '';
  }

  function imageBlock(dataUrl) {
    const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(dataUrl);
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  }

  const api = { call, stream, withRetry, tag, imageBlock, usage, ClaudeError, cost, PRICES, onUsage: null };
  root.Claude = api;
})(window);
