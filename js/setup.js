/*
 * AutoDoku – Einrichtung (Desktop-App): alles Nötige direkt aus der App installieren
 *   - Spracherkennung: whisper.cpp + Whisper large-v3-turbo (~550 MB)
 *   - Ollama (lokale KI, ~40 MB) + KI-Modell (1–3 GB) – nur wenn Ollama gewählt wurde
 * Läuft im Hintergrund weiter, auch wenn das Fenster zu ist. Fortschritt unten rechts.
 */
(function (root) {
  'use strict';
  const desk = () => !!(root.Whisper && root.Whisper.isDesktop && root.Whisper.isDesktop());
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Ein Lauf = Liste von Schritten {id, label, size, state: wait|run|done|skip|error, progress, error}
  const run = { steps: [], active: false, listeners: new Set() };
  const emit = () => run.listeners.forEach(f => { try { f(run); } catch (e) { /* egal */ } });

  async function sysInfo() {
    try { return await (await fetch('/sys/info', { cache: 'no-store' })).json(); } catch (e) { return {}; }
  }

  function plan(opts) {
    const steps = [];
    if (desk()) steps.push({ id: 'whisper', label: 'Spracherkennung (Whisper large-v3-turbo)', size: '550 MB' });
    if (opts.ollama) {
      steps.push({ id: 'ollama', label: 'Ollama (lokale KI)', size: '≈ 40 MB' });
      steps.push({ id: 'model', label: `KI-Modell ${opts.model}`, size: /1\.7b/.test(opts.model) ? '1,4 GB' : /8b/.test(opts.model) ? '5,2 GB' : '2,6 GB', model: opts.model });
    }
    return steps.map(s => Object.assign({ state: 'wait', progress: 0, error: '' }, s));
  }

  async function doStep(s) {
    if (s.id === 'whisper') {
      const L = await root.Whisper.checkLocal();
      if (L.installed) { s.state = 'skip'; return; }
      await root.Whisper.installLocal((ins) => { s.progress = ins.progress || 0; emit(); });
    }
    if (s.id === 'ollama') {
      await root.AI.checkOllama();
      if (root.AI.ollama.installed) { s.state = 'skip'; return; }
      await fetch('/ollamactl/install', { method: 'POST' });
      for (;;) {
        await sleep(800);
        const st = await (await fetch('/ollamactl/status', { cache: 'no-store' })).json();
        s.progress = st.install.progress || 0; emit();
        if (st.install.state === 'done') break;
        if (st.install.state === 'error') throw new Error(st.install.error || 'Ollama-Installation fehlgeschlagen');
      }
      await root.AI.checkOllama();
    }
    if (s.id === 'model') {
      await root.AI.ensureOllama();
      if (root.AI.ollama.models.includes(s.model)) { s.state = 'skip'; return; }
      await root.AI.pullOllama(s.model, (p) => { s.progress = p.progress || 0; emit(); });
      root.Store.Settings.set({ ollamaModel: s.model });
    }
  }

  async function start(opts) {
    if (run.active) return run;
    run.steps = plan(opts || {});
    run.active = true; emit();
    for (const s of run.steps) {
      s.state = 'run'; emit();
      let tries = 0;
      for (;;) {
        try { await doStep(s); if (s.state === 'run') s.state = 'done'; s.progress = 1; break; }
        catch (e) {
          if (++tries >= 3) { s.state = 'error'; s.error = e.message; break; }
          await sleep(2500 * tries);
        }
      }
      emit();
    }
    run.active = false; emit();
    return run;
  }

  // ---------- Anzeige ----------
  function stepsHtml(r) {
    const icon = { wait: '○', run: '⏳', done: '✅', skip: '✅', error: '❌' };
    return `<ul class="setup-steps">${r.steps.map(s => `<li class="st-${s.state}">
      <span class="st-ico">${icon[s.state]}</span>
      <span class="st-txt"><b>${esc(s.label)}</b><small>${s.state === 'skip' ? 'schon da' : s.state === 'error' ? esc(s.error) : s.state === 'run' ? Math.round(s.progress * 100) + ' %' : s.state === 'done' ? 'fertig' : s.size}</small>
      ${s.state === 'run' ? `<span class="quiz-progress"><span style="width:${Math.round(s.progress * 100)}%"></span></span>` : ''}</span></li>`).join('')}</ul>`;
  }
  function mount(el) {
    const f = (r) => { el.innerHTML = stepsHtml(r); };
    run.listeners.add(f); f(run);
    return () => run.listeners.delete(f);
  }
  // kleine Anzeige unten rechts, solange etwas lädt
  let pill = null;
  run.listeners.add((r) => {
    if (!r.steps.length) return;
    if (!pill) { pill = document.createElement('button'); pill.className = 'setup-pill'; pill.type = 'button'; pill.onclick = () => root.AutoDoku && root.AutoDoku.openSetup && root.AutoDoku.openSetup(); document.body.appendChild(pill); }
    const cur = r.steps.find(s => s.state === 'run');
    const err = r.steps.find(s => s.state === 'error');
    if (r.active && cur) pill.textContent = `⏳ Einrichtung: ${cur.label.replace(/\s*\(.*\)/, '')} ${Math.round(cur.progress * 100)} %`;
    else if (err) pill.textContent = '❌ Einrichtung unvollständig – antippen';
    else { pill.textContent = '✅ Alles eingerichtet'; setTimeout(() => { if (pill && !run.active) { pill.remove(); pill = null; } }, 6000); }
  });

  // ---------- Updates ----------
  async function checkUpdate(force) {
    if (!desk()) return null;
    try { const r = await fetch('/update/check' + (force ? '?force=1' : ''), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }
  async function installUpdate(onProgress) {
    await fetch('/update/install', { method: 'POST' });
    for (;;) {
      await sleep(700);
      const st = await (await fetch('/update/status', { cache: 'no-store' })).json();
      onProgress && onProgress(st);
      if (st.state === 'error') throw new Error(st.error);
      if (st.state === 'starting') return;
    }
  }

  root.Setup = { start, plan, mount, run, sysInfo, checkUpdate, installUpdate, isDesktop: desk };
})(window);
