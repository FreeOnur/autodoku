/* AutoDoku – Dateien automatisch in Notizen umwandeln
 * PDF  → Text (pdf.js), bei Scans Texterkennung (Tesseract, Deutsch+Englisch, offline) → KI-Notizen
 * Foto → KI mit Bildverständnis, sonst Texterkennung → KI-Notizen
 * Video/Audio → Offline-Spracherkennung (Whisper) → KI-Notizen (+ Transkript)
 * Word → Text (mammoth) → KI-Notizen
 * Ergebnis: "<Name> – Notizen.md" direkt neben der Datei. */
(function (root) {
  'use strict';

  const V = () => root.Vault;
  const UI = () => root.UI;
  const esc = (s) => root.MD.escHtml(s == null ? '' : s);
  const CONVERTIBLE = ['pdf', 'image', 'video', 'audio', 'docx'];
  const SKIP_DIRS = /(^|\/)(Anhänge|Anhaenge|attachments|Word|Transkripte|\.[^/]+)(\/|$)/i;
  const SUFFIX = ' – Notizen';

  const queue = [];
  let running = null;
  const state = { progress: 0, step: '' };

  const knownKey = () => 'autodoku.known.' + (V().V.root || '');
  let known = null;
  function loadKnown() {
    try { known = new Set(JSON.parse(localStorage.getItem(knownKey()) || 'null') || []); } catch (e) { known = new Set(); }
    return known;
  }
  function saveKnown() { try { localStorage.setItem(knownKey(), JSON.stringify([...known].slice(-20000))); } catch (e) { /* voll */ } }

  const canConvert = (p) => CONVERTIBLE.includes(V().kindOf(p)) && !/ – Notizen\.md$/.test(p);
  const notesPathFor = (p) => V().join(V().dirName(p), V().stem(p) + SUFFIX + '.md');

  // Beim ersten Öffnen eines Ordners: alles Vorhandene als "bekannt" merken (nicht alte Dateien umwandeln)
  function baseline() {
    const k = localStorage.getItem(knownKey());
    loadKnown();
    if (k == null) { V().V.files.forEach(f => known.add(f.path)); saveKnown(); }
  }

  // vom Ordner-Watcher: neue Dateien automatisch umwandeln
  function onVaultChanged() {
    if (!V().V.root) return;
    if (!known) baseline();
    const set = root.Store.Settings.get();
    let changed = false;
    for (const f of V().V.files) {
      if (f.type !== 'file' || known.has(f.path)) continue;
      known.add(f.path); changed = true;
      if (!set.autoConvert || !canConvert(f.path) || SKIP_DIRS.test(f.path)) continue;
      const own = V().V.selfWrites.get(f.path);
      if (own && Date.now() - own < 60000) continue; // selbst geschrieben (z. B. eingefügtes Bild)
      enqueue(f.path);
    }
    if (changed) saveKnown();
  }

  function enqueue(p, opt) {
    opt = opt || {};
    if (!canConvert(p)) return;
    if (!known) baseline();
    known.add(p); saveKnown();
    if (queue.some(q => q.p === p) || (running && running.p === p)) return;
    if (!opt.force && V().V.byPath.has(notesPathFor(p))) return; // gibt's schon
    queue.push({ p, opt });
    renderQueue();
    pump();
  }

  async function pump() {
    if (running || !queue.length) return;
    running = queue.shift();
    state.progress = 0; state.step = 'startet …';
    renderQueue();
    try {
      const out = await convertFile(running.p, (step, prog) => { state.step = step; if (prog != null) state.progress = prog; renderQueue(); });
      UI().toast(`✨ Notizen fertig: <b>${esc(V().stem(out))}</b>`, 'ok', 6000);
      await V().refresh();
      if (running.opt.open || (V().V.active === running.p)) V().openFile(out);
    } catch (e) {
      console.error(e);
      UI().toast(`Umwandeln von <b>${esc(V().baseName(running.p))}</b> fehlgeschlagen: ${esc(e.message)}`, 'err', 9000);
    } finally {
      running = null;
      renderQueue();
      setTimeout(pump, 50);
    }
  }

  function renderQueue() {
    const el = document.getElementById('sb-queue'); if (!el) return;
    if (!running && !queue.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="q-box">
      ${running ? `<div class="q-item on"><b>✨ ${esc(V().baseName(running.p))}</b><small>${esc(state.step)}</small><div class="q-bar"><i style="width:${Math.round(state.progress * 100)}%"></i></div></div>` : ''}
      ${queue.map(q => `<div class="q-item"><span>⏳ ${esc(V().baseName(q.p))}</span></div>`).join('')}
    </div>`;
  }

  // ---------- Fach aus dem Ordner erraten ----------
  function subjectFor(p) {
    const top = (p.split('/')[0] || '').toLowerCase();
    const subs = root.Store.Subjects.all();
    return subs.find(s => s.name.toLowerCase() === top) || subs.find(s => top && (s.name.toLowerCase().startsWith(top) || top.startsWith(s.name.toLowerCase().split(/[ /]/)[0]))) ||
      { id: 'allg', name: p.includes('/') && !top.startsWith('_') ? p.split('/')[0] : 'Allgemein', kind: /mathe|physik|mechanik|elektro/i.test(top) ? 'math' : /swp|program|informatik|netzwerk|code|nw|itp|dbi/i.test(top) ? 'code' : 'text', notesLang: 'Deutsch' };
  }

  // ---------- Extraktion ----------
  async function pdfText(p, onStep) {
    const lib = root.pdfjsLib || (await import(new URL('vendor/pdfjs/pdf.min.mjs', location.href).href));
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    root.pdfjsLib = lib;
    const base = new URL('vendor/pdfjs/', location.href).href;
    const task = lib.getDocument({ url: V().url(p), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
    const doc = await task.promise;
    const pages = [];
    const maxPages = Math.min(doc.numPages, 300);
    for (let i = 1; i <= maxPages; i++) {
      onStep(`Lese Seite ${i}/${maxPages}`, (i / maxPages) * 0.4);
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let text = '', lastY = null;
      for (const it of tc.items) {
        if (lastY != null && Math.abs(it.transform[5] - lastY) > 2) text += '\n';
        text += it.str + (it.hasEOL ? '\n' : '');
        lastY = it.transform[5];
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      // gescannte Seite (kaum Text)? -> Texterkennung
      if (text.replace(/\s/g, '').length < 40) {
        onStep(`Texterkennung Seite ${i}/${maxPages}`, (i / maxPages) * 0.4);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        text = await ocr(c);
      }
      pages.push(`[Seite ${i}]\n${text}`);
      page.cleanup();
    }
    try { await task.destroy(); } catch (e) { /* egal */ }
    return pages.join('\n\n');
  }

  let ocrWorker = null;
  async function ocr(img) {
    if (!root.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
    if (!ocrWorker) {
      const base = new URL('vendor/', location.href).href;
      ocrWorker = await root.Tesseract.createWorker(['deu', 'eng'], 1, {
        workerPath: base + 'tesseract/worker.min.js', corePath: base + 'tesseract/tesseract-core-simd-lstm.wasm.js', langPath: base + 'tessdata', gzip: true, workerBlobURL: false,
      });
    }
    const r = await ocrWorker.recognize(img);
    return (r.data && r.data.text || '').trim();
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' fehlt')); document.head.appendChild(s); });
  }

  const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

  // ---------- KI-Notizen in Teilen ----------
  async function aiNotes(kind, sub, text, onStep, p0) {
    const set = root.Store.Settings.get();
    const prov = root.AI.provider();
    const maxChars = prov === 'ollama' ? 9000 : prov === 'chrome' ? 5000 : 100000;
    const parts = [];
    let rest = text;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf('\n\n', maxChars); if (cut < maxChars * 0.5) cut = rest.lastIndexOf('\n', maxChars); if (cut < maxChars * 0.5) cut = maxChars;
      parts.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
    if (rest.trim()) parts.push(rest);
    let title = '', notes = [], terms = [];
    for (let i = 0; i < parts.length; i++) {
      onStep(parts.length > 1 ? `KI schreibt Notizen (Teil ${i + 1}/${parts.length}) …` : 'KI schreibt Notizen …', p0 + (1 - p0) * (i / parts.length));
      const r = await root.Claude.withRetry(() => root.AI.call({
        apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 12000, temperature: 0.2,
        system: root.Prompts.convert(kind, sub, Object.assign({}, set, { _terms: !!set.termNotes }), parts.length > 1 ? { i: i + 1, n: parts.length } : null),
        messages: [{ role: 'user', content: `INHALT:\n"""\n${parts[i]}\n"""` }],
      }));
      let n = root.Claude.tag(r.text, 'notes');
      if (!n) n = r.text.replace(/<(title|terms)>[\s\S]*?(<\/\1>|$)/g, '').replace(/<\/?notes>/g, '').trim();
      if (!title) title = (root.Claude.tag(r.text, 'title') || '').replace(/^#+\s*/, '').trim();
      notes.push(n);
      terms.push(root.Claude.tag(r.text, 'terms') || '');
    }
    return { title, notes: notes.join('\n\n'), terms: terms.join('\n') };
  }

  async function imageNotes(p, sub, onStep) {
    const set = root.Store.Settings.get();
    if (root.AI.ready() && root.AI.supportsImages()) {
      onStep('KI liest das Bild …', 0.2);
      const im = await root.Images.toJpeg(V().url(p), 1800, 0.88);
      const r = await root.Claude.withRetry(() => root.AI.call({
        apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 6000, temperature: 0.2,
        system: root.Prompts.convert('image', sub, Object.assign({}, set, { _terms: !!set.termNotes })).replace('(Text per Texterkennung extrahiert – Erkennungsfehler korrigieren, Formeln rekonstruieren)', '(Tafel, Folie, Heft, Screenshot – lies alles ab, Formeln als LaTeX, Code als Code-Block)'),
        messages: [{ role: 'user', content: [root.Claude.imageBlock(im.dataUrl), { type: 'text', text: 'Mach Notizen aus diesem Bild.' }] }],
      }));
      return { title: (root.Claude.tag(r.text, 'title') || '').trim(), notes: root.Claude.tag(r.text, 'notes') || r.text.replace(/<(title|terms)>[\s\S]*?(<\/\1>|$)/g, ''), terms: root.Claude.tag(r.text, 'terms') || '', raw: '' };
    }
    onStep('Texterkennung …', 0.15);
    const raw = await ocr(V().url(p));
    if (!raw) return { title: '', notes: '_Kein Text im Bild erkannt._', raw: '' };
    if (!root.AI.ready()) return { title: '', notes: raw, raw };
    const r = await aiNotes('image', sub, raw, onStep, 0.4);
    return Object.assign(r, { raw });
  }

  // ---------- Hauptablauf ----------
  async function convertFile(p, onStep) {
    const kind = V().kindOf(p);
    const sub = subjectFor(p);
    const name = V().baseName(p);
    let res = { title: '', notes: '' }, raw = '', transcript = null;

    if (kind === 'image') {
      res = await imageNotes(p, sub, onStep);
    } else {
      if (kind === 'pdf') raw = await pdfText(p, onStep);
      else if (kind === 'docx') {
        onStep('Lese Word-Datei …', 0.1);
        const buf = await V().readBinary(p);
        const r = await root.mammoth.convertToMarkdown({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
        raw = r.value.replace(/\\([.()\-#!])/g, '$1');
      } else if (kind === 'video' || kind === 'audio') {
        onStep('Lese Tonspur …', 0.02);
        const f = V().V.byPath.get(p);
        if (f && f.size > 1.8e9) throw new Error('Datei zu groß (über 1,8 GB) – bitte kürzen.');
        const bytes = await V().readBinary(p);
        let audio;
        try { audio = await root.Whisper.decodeFile(bytes); } catch (e) { throw new Error('Tonspur konnte nicht gelesen werden (Format wird nicht unterstützt).'); }
        const mins = Math.round(audio.length / 16000 / 60);
        onStep(`Spracherkennung (${mins} min Audio) …`, 0.05);
        const set = root.Store.Settings.get();
        const segs = await root.Whisper.transcribeLong(audio, set.speechLang === 'auto' ? 'auto' : (sub.speechLang || 'de').split('-')[0],
          (pr) => onStep(`Spracherkennung … ${Math.round(pr * 100)} %`, 0.05 + pr * 0.55));
        transcript = segs;
        raw = segs.map(x => `[${mmss(x.t)}] ${x.text}`).join('\n');
        if (!raw.trim()) throw new Error('Keine Sprache erkannt.');
      }
      if (!raw.trim()) throw new Error('Kein Text gefunden.');
      if (root.AI.ready()) res = await aiNotes(kind, sub, raw, onStep, kind === 'video' || kind === 'audio' ? 0.6 : 0.4);
      else res = { title: '', notes: '> [!ACHTUNG] Keine KI eingerichtet\n> Hier steht der Rohtext. In ⚙️ eine KI einrichten (Claude, Ollama oder Gemini), dann Rechtsklick → „In Notizen umwandeln“.\n\n' + raw };
    }

    onStep('Speichere …', 0.98);
    const today = new Date().toISOString().slice(0, 10);
    const front = `---\nquelle: "[[${name}]]"\nerstellt: ${today}\nfach: ${sub.name}\ntags: [autodoku, ${kind === 'image' ? 'foto' : kind}]\n---\n`;
    const embed = kind === 'image' ? `![[${name}]]\n\n` : kind === 'video' || kind === 'audio' ? `![[${name}]]\n\n` : `> [!INFO] Quelle\n> [[${name}]]\n\n`;
    let body = `${front}# ${res.title || V().stem(p)}\n\n${embed}${res.notes.trim()}\n`;
    if (transcript && transcript.length) {
      body += `\n> [!INFO]- Transkript (zum Nachlesen)\n${transcript.map(x => `> **${mmss(x.t)}** ${x.text}`).join('\n>\n')}\n`;
    }
    const out = notesPathFor(p);
    await V().write(out, body);
    if (res.terms && root.Rules) { try { await root.Rules.writeTerms(res.terms, { subject: sub.name, source: out }); } catch (e) { console.warn('Begriffe', e); } }
    return out;
  }

  root.Convert = { enqueue, canConvert, onVaultChanged, renderQueue, baseline, ocr, notesPathFor, queue };
})(window);
