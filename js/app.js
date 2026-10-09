/* AutoDoku – App */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = MD.escHtml;
  const { Sessions, Settings, Subjects, uid } = Store;

  // ============ Hilfsfunktionen ============
  const pad = (n) => String(n).padStart(2, '0');
  const mmss = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const fmtDur = (ms) => { const m = Math.round((ms || 0) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtDateLong = (ts) => new Date(ts).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtRel = (ts) => {
    const d = new Date(ts), now = new Date();
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    const t = d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    if (days === 0) return `heute, ${t}`;
    if (days === 1) return `gestern, ${t}`;
    if (days < 7) return d.toLocaleDateString('de-AT', { weekday: 'long' }) + `, ${t}`;
    return fmtDate(ts);
  };
  const words = (t) => (t.trim().match(/\S+/g) || []).length;
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const slug = (s) => String(s || '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'Mitschrift';
  const firstLine = (md) => (md || '').split('\n').find(l => l.trim()) || '';
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const fmtCost = (usd) => usd == null ? '' : `≈ ${(usd * 100).toLocaleString('de-AT', { maximumFractionDigits: usd < 0.01 ? 2 : 1, minimumFractionDigits: 0 })} Cent`;
  const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' Mio.' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0);

  function toast(msg, type, ms) {
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.innerHTML = msg;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms || 3800);
  }

  function modal({ title, body, actions, wide, onClose, className }) {
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${className || ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '')}">
      <div class="modal-head"><h2>${title || ''}</h2><button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
      <div class="modal-body">${body || ''}</div>
      ${actions && actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : a.danger ? 'danger' : 'ghost'}" data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
    const close = () => { root.classList.remove('in'); setTimeout(() => root.remove(), 200); onClose && onClose(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    $('[data-close]', root).onclick = close;
    (actions || []).forEach((a, i) => { $(`[data-act="${i}"]`, root).onclick = () => { const r = a.onClick && a.onClick(root); if (r !== false) close(); }; });
    document.addEventListener('keydown', onKey);
    $('#modal-root').appendChild(root);
    requestAnimationFrame(() => root.classList.add('in'));
    return { el: root, close };
  }

  function prompt(title, { placeholder, value, multiline, okLabel } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const field = multiline
        ? `<textarea class="input" rows="5" placeholder="${esc(placeholder || '')}">${esc(value || '')}</textarea>`
        : `<input class="input" placeholder="${esc(placeholder || '')}" value="${esc(value || '')}">`;
      const m = modal({
        title, body: field,
        actions: [{ label: 'Abbrechen' }, { label: okLabel || 'OK', primary: true, onClick: (el) => { done = true; resolve($('.input', el).value); } }],
        onClose: () => { if (!done) resolve(null); },
      });
      const inp = $('.input', m.el);
      setTimeout(() => inp.focus(), 50);
      if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(inp.value); m.close(); } });
    });
  }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title, body: `<p>${text}</p>`,
        actions: [{ label: 'Abbrechen' }, { label: okLabel || 'OK', primary: !danger, danger, onClick: () => { done = true; resolve(true); } }],
        onClose: () => { if (!done) resolve(false); },
      });
    });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  // ============ Notizen-Modell ============
  function splitSections(md) {
    const out = [];
    let cur = [];
    let inCode = false;
    for (const line of String(md || '').split('\n')) {
      if (/^\s*```/.test(line)) inCode = !inCode;
      if (!inCode && /^##\s/.test(line) && cur.join('').trim()) { out.push(cur.join('\n').trim()); cur = []; }
      cur.push(line);
    }
    if (cur.join('').trim()) out.push(cur.join('\n').trim());
    return out;
  }
  const notesMd = (s) => (s.finalNotes != null ? s.finalNotes : (s.sections || []).join('\n\n'));
  function setNotesMd(s, md) {
    if (s.finalNotes != null) s.finalNotes = md;
    else s.sections = splitSections(md);
  }

  function parseTasks(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const m = /^\s*[-*]\s*\[([a-zäöü]+)\]\s*(.+?)\s*(?:\|\s*(.*))?$/i.exec(line);
      if (!m) continue;
      let type = m[1].toLowerCase().replace('ü', 'ue');
      if (!['hausuebung', 'test', 'abgabe', 'mitbringen', 'info'].includes(type)) type = 'info';
      const due = (m[3] || '').trim().replace(/^(–|-|keiner?|kein termin|leer|n\/a)$/i, '');
      out.push({ id: uid('t'), type, text: m[2].trim(), due, done: false });
    }
    return out;
  }
  function mergeTasks(s, list) {
    s.tasks = s.tasks || [];
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').slice(0, 40);
    for (const t of list) {
      const ex = s.tasks.find(x => norm(x.text) === norm(t.text) || (norm(x.text).length > 12 && norm(t.text).startsWith(norm(x.text).slice(0, 16))));
      if (ex) { if (t.due && !ex.due) ex.due = t.due; if (t.text.length > ex.text.length) ex.text = t.text; }
      else s.tasks.push(t);
    }
  }

  function newSession(subjectId, kind) {
    return {
      id: uid('s'), kind: kind || 'lesson', subjectId,
      title: '', createdAt: Date.now(), updatedAt: Date.now(),
      durationMs: 0, segments: [], cursor: 0, sections: [], finalNotes: null,
      tasks: [], images: {}, chat: [], status: 'new',
    };
  }

  // ============ Zustand ============
  const st = {
    session: null,
    live: null,
    tab: 'notes',
    sideTab: 'transcript',
    editing: false,
    finalizing: false,
    saveTimer: null,
  };

  function save(s) {
    s = s || st.session;
    if (!s) return;
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(() => Sessions.put(s).catch(e => toast('Speichern fehlgeschlagen: ' + esc(e.message), 'err')), 400);
  }
  function saveNow(s) { clearTimeout(st.saveTimer); return Sessions.put(s || st.session); }

  // ============ Verbrauch mitzählen ============
  Claude.onUsage = (u) => {
    Store.Spend.add(u);
    const s = [st.session, st.viewOnly].find(x => x && x.id === u.tag);
    if (!s) return;
    s.usage = s.usage || { input: 0, output: 0, cost: 0 };
    s.usage.input += u.input; s.usage.output += u.output; s.usage.cost += u.cost || 0;
    save(s);
  };

  // ============ Routing ============
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, id] = h.split('/');
    if (st.live && st.live.recording && !(name === 'stunde' && st.session && id === st.session.id)) {
      // Aufnahme läuft weiter im Hintergrund – kein Abbruch beim Navigieren
    }
    if (name === 'stunde' && id) return showSession(id);
    if (name === 'fach' && id) return showSubject(id);
    return showHome();
  }

  function setTopMid(html) { $('#topbar-mid').innerHTML = html || ''; }
  const livePill = () => (st.live && st.live.recording && st.session ? recPill(st.session) : '');

  // ============ Startseite ============
  async function showHome() {
    st.editing = false;
    const all = await Sessions.all();
    const subs = Subjects.all();
    const counts = {};
    all.forEach(s => { counts[s.subjectId] = (counts[s.subjectId] || 0) + 1; });
    const openTasks = [];
    all.forEach(s => (s.tasks || []).forEach(t => { if (!t.done) openTasks.push({ t, s }); }));
    const running = st.live && st.live.recording && st.session ? st.session : null;
    const unfinished = all.find(s => s.kind === 'lesson' && s.status !== 'final' && Date.now() - s.createdAt < 3 * 3600e3 && s.segments.length);
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Servus' : 'Hallo';
    setTopMid(running ? recPill(running) : '');

    $('#view').innerHTML = `
      <section class="home">
        <div class="hero">
          <div>
            <p class="eyebrow">${greet}${Settings.get().studentName ? ', ' + esc(Settings.get().studentName.split(' ')[0]) : ''} 👋</p>
            <h1>Du chillst.<br><span class="hl">Ich schreib mit.</span></h1>
            <p class="lead">Fach antippen → AutoDoku hört zu, fasst live zusammen und baut dir eine fertige Word-Mitschrift – mit echten Formeln, Tafelfotos und Merke-Boxen.</p>
          </div>
          <div class="hero-wave" aria-hidden="true">${'<i></i>'.repeat(18)}</div>
        </div>

        ${running ? `<a class="resume live" href="#/stunde/${running.id}"><span class="dot rec"></span><div><b>Aufnahme läuft</b><small>${esc(Subjects.get(running.subjectId).name)} · ${esc(running.title || 'Neue Stunde')}</small></div><span class="arrow">→</span></a>`
        : unfinished ? `<a class="resume" href="#/stunde/${unfinished.id}"><span class="dot"></span><div><b>Weiter mitschreiben?</b><small>${esc(Subjects.get(unfinished.subjectId).name)} · ${esc(unfinished.title || 'Stunde')} · ${fmtRel(unfinished.createdAt)}</small></div><span class="arrow">→</span></a>` : ''}

        <div class="section-head"><h2>Stunde starten</h2><button class="btn ghost small" id="add-subject">+ Fach</button></div>
        <div class="subject-grid">
          ${subs.map(s => `
            <div class="subject-card" style="--c:${esc(s.color)}">
              <button class="subject-start" data-start="${esc(s.id)}" aria-label="${esc(s.name)}: Stunde starten">
                <span class="emoji">${esc(s.emoji)}</span>
                <span class="name">${esc(s.name)}</span>
                <span class="go"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg> Aufnahme starten</span>
              </button>
              <a class="subject-archive" href="#/fach/${esc(s.id)}">${counts[s.id] ? `${counts[s.id]} Mitschrift${counts[s.id] > 1 ? 'en' : ''}` : 'Archiv'} →</a>
            </div>`).join('')}
        </div>

        <div class="home-cols">
          <div>
            <div class="section-head"><h2>📌 Hausübungen & Termine</h2></div>
            ${openTasks.length ? `<ul class="task-list">${openTasks.slice(0, 12).map(({ t, s }) => taskItem(t, s)).join('')}</ul>`
              : '<p class="empty">Nichts offen. AutoDoku trägt Hausübungen, Tests und Abgaben automatisch ein, wenn sie in der Stunde erwähnt werden.</p>'}
          </div>
          <div>
            <div class="section-head"><h2>Zuletzt</h2></div>
            ${all.length ? `<div class="session-list">${all.slice(0, 8).map(sessionCard).join('')}</div>`
              : `<div class="empty">Noch keine Mitschriften. <button class="btn small" id="demo-btn">Demo-Stunde ansehen</button></div>`}
          </div>
        </div>
      </section>`;

    $$('[data-start]').forEach(b => b.onclick = () => startLesson(b.dataset.start));
    $('#add-subject').onclick = () => editSubject(null);
    const demo = $('#demo-btn'); if (demo) demo.onclick = createDemo;
    bindTaskChecks(all);
  }

  function taskItem(t, s) {
    const icon = { hausuebung: '🏠', test: '🎯', abgabe: '📤', mitbringen: '🎒', info: 'ℹ️' }[t.type] || '📌';
    const sub = s ? Subjects.get(s.subjectId) : null;
    return `<li class="task ${t.done ? 'done' : ''}" data-task="${esc(t.id)}" ${s ? `data-sid="${esc(s.id)}"` : ''}>
      <label><input type="checkbox" ${t.done ? 'checked' : ''}><span class="ticon">${icon}</span>
      <span class="ttext">${MD.inlineHtml(MD.parseInline(t.text))}${sub ? ` <a class="tsub" href="#/stunde/${esc(s.id)}" style="--c:${esc(sub.color)}">${esc(sub.emoji)} ${esc(sub.name)}</a>` : ''}</span></label>
      ${t.due ? `<span class="due">${esc(t.due)}</span>` : ''}
      ${!s ? `<button class="icon-btn tiny" data-del-task title="Löschen">✕</button>` : ''}
    </li>`;
  }

  function bindTaskChecks(all) {
    $$('.task input[type=checkbox]').forEach(cb => {
      cb.onchange = async () => {
        const li = cb.closest('.task');
        const sid = li.dataset.sid;
        const s = sid ? (st.session && st.session.id === sid ? st.session : all.find(x => x.id === sid)) : st.session;
        if (!s) return;
        const t = s.tasks.find(x => x.id === li.dataset.task);
        if (t) { t.done = cb.checked; li.classList.toggle('done', cb.checked); await saveNow(s); }
      };
    });
  }

  function sessionCard(s) {
    const sub = Subjects.get(s.subjectId);
    const nTasks = (s.tasks || []).filter(t => !t.done).length;
    const badge = s.kind === 'study' ? '<span class="badge study">Lernzettel</span>' : s.status === 'final' ? '<span class="badge ok">fertig</span>' : '<span class="badge">live</span>';
    return `<a class="session-card" href="#/stunde/${esc(s.id)}" style="--c:${esc(sub.color)}">
      <span class="sc-emoji">${esc(sub.emoji)}</span>
      <span class="sc-main"><b>${esc(s.title || 'Unbenannte Stunde')}</b><small>${esc(sub.name)} · ${fmtRel(s.createdAt)}${s.durationMs >= 60000 ? ' · ' + fmtDur(s.durationMs) : ''}</small></span>
      <span class="sc-meta">${badge}${nTasks ? `<span class="badge warn">📌 ${nTasks}</span>` : ''}</span>
    </a>`;
  }

  // ============ Fach-Seite ============
  async function showSubject(id) {
    const sub = Subjects.get(id);
    const list = (await Sessions.all()).filter(s => s.subjectId === id);
    setTopMid(livePill());
    $('#view').innerHTML = `
      <section class="subject-page" style="--c:${esc(sub.color)}">
        <a href="#/" class="back">← Übersicht</a>
        <div class="subject-hero">
          <span class="big-emoji">${esc(sub.emoji)}</span>
          <div><h1>${esc(sub.name)}</h1><p class="muted">${list.length} Mitschrift${list.length === 1 ? '' : 'en'} · Spracherkennung ${esc(sub.speechLang)}</p></div>
          <button class="btn ghost small" id="edit-sub">Fach bearbeiten</button>
        </div>
        <div class="subject-actions">
          <button class="btn primary big" id="start"><span class="dot rec"></span> Neue Stunde aufnehmen</button>
          <button class="btn" id="study" ${list.length ? '' : 'disabled'}>📚 KI-Lernzettel</button>
          <button class="btn" id="quiz" ${list.length ? '' : 'disabled'}>🧠 Quiz mich</button>
          <button class="btn" id="export-all" ${list.length ? '' : 'disabled'}>⬇ Alles als Word</button>
        </div>
        <div class="session-list big">${list.length ? list.map(sessionCard).join('') : '<p class="empty">Noch nichts in diesem Fach.</p>'}</div>
      </section>`;
    $('#start').onclick = () => startLesson(id);
    $('#edit-sub').onclick = () => editSubject(sub);
    $('#study').onclick = () => pickSessions(list, 'Lernzettel erstellen aus …', (sel) => makeStudySheet(sub, sel));
    $('#quiz').onclick = () => pickSessions(list, 'Quiz aus …', (sel) => runQuiz(sub, sel));
    $('#export-all').onclick = () => exportMany(sub, list.filter(s => s.kind === 'lesson').slice().reverse());
  }

  function pickSessions(list, title, cb) {
    const body = `<p class="muted">Wähle die Stunden aus (z. B. alles seit dem letzten Test).</p>
      <div class="pick-list">${list.map((s, i) => `<label class="pick"><input type="checkbox" value="${esc(s.id)}" ${i < 6 ? 'checked' : ''}><span><b>${esc(s.title || 'Stunde')}</b><small>${fmtDateLong(s.createdAt)}</small></span></label>`).join('')}</div>`;
    modal({
      title, body,
      actions: [{ label: 'Abbrechen' }, {
        label: 'Los', primary: true, onClick: (el) => {
          const ids = $$('input:checked', el).map(i => i.value);
          if (!ids.length) { toast('Mindestens eine Stunde wählen'); return false; }
          cb(list.filter(s => ids.includes(s.id)));
        },
      }],
    });
  }

  // ============ Stunde ============
  async function startLesson(subjectId) {
    if (st.live && st.live.recording) {
      const ok = await confirmBox('Aufnahme läuft noch', 'Die aktuelle Aufnahme wird pausiert und eine neue Stunde gestartet.', 'Neue Stunde');
      if (!ok) return;
      stopRecording();
    }
    st.viewOnly = null;
    const s = newSession(subjectId);
    await saveNow(s);
    st.pendingAutostart = s.id;
    location.hash = `#/stunde/${s.id}`;
  }

  async function showSession(id) {
    let s = st.session && st.session.id === id ? st.session : await Sessions.get(id);
    if (!s) { toast('Mitschrift nicht gefunden'); location.hash = '#/'; return; }
    if (st.session && st.session.id !== s.id && st.live && st.live.recording) {
      // andere Stunde läuft: zu der wechseln wir nicht automatisch
    }
    if (!(st.live && st.live.recording && st.session && st.session.id !== s.id)) st.session = s;
    else { st.viewOnly = s; }
    const sub = Subjects.get(s.subjectId);
    st.editing = false;
    const isLesson = s.kind === 'lesson';
    const viewOnly = st.session !== s;

    $('#view').innerHTML = `
      <section class="session" style="--c:${esc(sub.color)}" data-mtab="${st.tab}">
        <div class="session-head">
          <a href="#/fach/${esc(sub.id)}" class="back-icon" aria-label="Zurück">←</a>
          <span class="sub-chip">${esc(sub.emoji)} ${esc(sub.name)}</span>
          <input class="title-input" id="title" value="${esc(s.title)}" placeholder="${isLesson ? 'Titel erscheint automatisch …' : 'Lernzettel'}" aria-label="Titel">
          <span class="session-date">${fmtDateLong(s.createdAt)}</span>
        </div>

        <nav class="mtabs" role="tablist">
          ${[['notes', '📝 Notizen'], ['transcript', '🎙️ Live'], ['tasks', '📌 Aufgaben'], ['photos', '📷 Fotos'], ['chat', '💬 Fragen']]
            .filter(([k]) => isLesson || ['notes', 'chat'].includes(k))
            .map(([k, l]) => `<button role="tab" data-mtab="${k}" class="${st.tab === k ? 'on' : ''}">${l}<span class="cnt" data-cnt="${k}"></span></button>`).join('')}
        </nav>

        <div class="session-body ${isLesson ? '' : 'no-side'}">
          <div class="pane pane-notes" data-pane="notes">
            <div class="paper-bar">
              <div class="live-info" id="live-info"></div>
              <div class="paper-tools">
                <button class="btn small ghost" id="btn-edit" title="Mitschrift bearbeiten">✏️ <span class="lbl">Bearbeiten</span></button>
                ${isLesson ? `<button class="btn small ghost" id="btn-update" title="Jetzt aktualisieren">⚡ <span class="lbl">Update</span></button>
                <button class="btn small accent" id="btn-final" title="Fertig: Mitschrift polieren">✨ <span class="lbl">Fertig & polieren</span></button>` : ''}
                <button class="btn small primary" id="btn-word">⬇ Word</button>
              </div>
            </div>
            <article class="paper" id="paper"></article>
          </div>
          ${isLesson ? `
          <aside class="side">
            <nav class="side-tabs">
              ${[['transcript', 'Live-Transkript'], ['tasks', 'Aufgaben'], ['photos', 'Fotos'], ['chat', 'Fragen']]
                .map(([k, l]) => `<button data-stab="${k}" class="${st.sideTab === k ? 'on' : ''}">${l}<span class="cnt" data-cnt="${k}"></span></button>`).join('')}
            </nav>
            <div class="pane" data-pane="transcript">
              <div class="transcript" id="transcript"></div>
              <div class="pane-foot"><button class="btn small ghost" id="btn-note">✍️ Notiz tippen</button><button class="btn small ghost" id="btn-paste">📋 Text einfügen</button></div>
            </div>
            <div class="pane" data-pane="tasks"><ul class="task-list" id="tasks"></ul><div class="pane-foot"><button class="btn small ghost" id="btn-add-task">+ Aufgabe</button></div></div>
            <div class="pane" data-pane="photos"><div class="photos" id="photos"></div><div class="pane-foot"><button class="btn small ghost" data-photo>📷 Foto hinzufügen</button></div></div>
            <div class="pane" data-pane="chat">
              <div class="chat" id="chat"></div>
              <form class="chat-form" id="chat-form"><input class="input" id="chat-input" placeholder="Frag was zur Stunde …" autocomplete="off"><button class="btn primary" type="submit">↑</button></form>
            </div>
          </aside>` : `
          <aside class="side"><div class="pane" data-pane="chat">
            <div class="chat" id="chat"></div>
            <form class="chat-form" id="chat-form"><input class="input" id="chat-input" placeholder="Frag was zum Lernzettel …" autocomplete="off"><button class="btn primary" type="submit">↑</button></form>
          </div></aside>`}
        </div>

        ${isLesson && !viewOnly ? `
        <div class="dock">
          <button class="dock-btn" id="dock-note"><span>✍️</span><small>Notiz</small></button>
          <button class="dock-btn" data-photo><span>📷</span><small>Tafel</small></button>
          <button class="rec-btn" id="rec-btn" aria-label="Aufnahme"><span class="rec-core"></span></button>
          <button class="dock-btn" id="dock-sos"><span>🆘</span><small>Was war?</small></button>
          <button class="dock-btn" id="dock-final"><span>✨</span><small>Fertig</small></button>
        </div>` : ''}
      </section>`;

    setTopMid(viewOnly ? livePill() : '');
    if (viewOnly) toast('Hinweis: In einer anderen Stunde läuft gerade eine Aufnahme.');
    bindSession(s);
    renderAll(s);
    if (st.pendingAutostart === s.id) {
      st.pendingAutostart = null;
      if (!Settings.get().apiKey) toast('Tipp: Ohne API-Schlüssel gibt es nur das Transkript. ⚙️ Einstellungen → Claude', 'warn', 6000);
      startRecording();
    }
  }

  function bindSession(s) {
    const isLesson = s.kind === 'lesson';
    $('#title').onchange = (e) => { s.title = e.target.value.trim(); s.titleLocked = true; save(s); };
    $$('[data-mtab]', $('.mtabs')).forEach(b => b.onclick = () => setMTab(b.dataset.mtab));
    $$('[data-stab]').forEach(b => b.onclick = () => setSideTab(b.dataset.stab));
    $('#btn-edit').onclick = () => toggleEdit(s);
    $('#btn-word').onclick = () => exportWord(s);
    if (isLesson) {
      $('#btn-update').onclick = () => liveUpdate(s, true);
      $('#btn-final').onclick = () => finalize(s);
      $('#btn-note').onclick = () => addNote(s);
      $('#btn-paste').onclick = () => pasteText(s);
      $('#btn-add-task').onclick = async () => {
        const t = await prompt('Aufgabe / Termin hinzufügen', { placeholder: 'z. B. Buch S. 84 Nr. 3 | bis Montag' });
        if (!t) return;
        const [text, due] = t.split('|');
        mergeTasks(s, [{ id: uid('t'), type: /test|sa|schularbeit/i.test(text) ? 'test' : 'hausuebung', text: text.trim(), due: (due || '').trim(), done: false }]);
        save(s); renderTasks(s);
      };
      $$('[data-photo]').forEach(b => b.onclick = () => pickPhoto(s));
      const rb = $('#rec-btn');
      if (rb) {
        rb.onclick = () => (st.live && st.live.recording ? stopRecording() : startRecording());
        $('#dock-note').onclick = () => addNote(s);
        $('#dock-sos').onclick = () => recap(s);
        $('#dock-final').onclick = () => finalize(s);
      }
    }
    $('#chat-form').onsubmit = (e) => { e.preventDefault(); const v = $('#chat-input').value.trim(); if (v) { $('#chat-input').value = ''; askQuestion(s, v); } };
    $('#paper').addEventListener('click', (e) => onPaperClick(e, s));
  }

  function setMTab(k) {
    st.tab = k;
    const root = $('.session'); if (!root) return;
    root.dataset.mtab = k;
    $$('.mtabs [data-mtab]').forEach(b => b.classList.toggle('on', b.dataset.mtab === k));
    if (k !== 'notes') setSideTab(k);
    if (k === 'transcript') scrollTranscript(true);
  }
  function setSideTab(k) {
    st.sideTab = k;
    const side = $('.side'); if (!side) return;
    side.dataset.stab = k;
    $$('.side-tabs [data-stab]').forEach(b => b.classList.toggle('on', b.dataset.stab === k));
    if (k === 'chat') { const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight; }
  }

  function renderAll(s) {
    const side = $('.side'); if (side) side.dataset.stab = s.kind === 'lesson' ? st.sideTab : 'chat';
    renderNotes(s);
    if (s.kind === 'lesson') { renderTranscript(s); renderTasks(s); renderPhotos(s); }
    renderChat(s);
    renderLiveInfo();
    renderRecBtn();
  }

  function renderCounts(s) {
    const c = { tasks: (s.tasks || []).filter(t => !t.done).length, photos: Object.values(s.images || {}).filter(i => i.kind === 'board').length };
    $$('[data-cnt]').forEach(el => { const v = c[el.dataset.cnt]; el.textContent = v ? v : ''; });
  }

  // ---------- Notizen ----------
  function renderNotes(s) {
    const paper = $('#paper');
    if (!paper || st.session !== s && st.viewOnly !== s) return;
    if (st.editing) return;
    const md = notesMd(s);
    const sub = Subjects.get(s.subjectId);
    if (!md.trim()) {
      const rec = st.live && st.live.recording && st.session === s;
      paper.innerHTML = `<div class="paper-empty">
        <div class="pe-icon">${rec ? '<span class="eq">' + '<i></i>'.repeat(5) + '</span>' : esc(sub.emoji)}</div>
        <h3>${rec ? 'Ich hör zu …' : 'Noch leer'}</h3>
        <p>${rec ? (Settings.get().liveUpdates ? `Sobald genug gesagt wurde (≈${Settings.get().minWords} Wörter), erscheint hier die erste Zusammenfassung. Mit <b>⚡ Update</b> geht's sofort.` : 'Sparstufe <b>„Nur am Ende“</b>: Während der Stunde läuft nur das Transkript (Tab <b>Live</b>). Am Ende <b>✨ Fertig</b> drücken – dann schreibt Claude die ganze Mitschrift auf einmal.') : 'Starte die Aufnahme unten mit dem roten Knopf – oder füg ein Tafelfoto hinzu.'}</p>
        ${!Settings.get().apiKey ? '<p class="warn-text">Kein Claude-API-Schlüssel gesetzt → es gibt nur das Transkript. <button class="btn tiny" data-open-settings>Einstellungen</button></p>' : ''}
      </div>`;
      const b = $('[data-open-settings]', paper); if (b) b.onclick = openSettings;
      return;
    }
    const blocks = MD.parse(md);
    paper.innerHTML = `<header class="paper-head"><span class="ph-sub">${esc(sub.emoji)} ${esc(sub.name.toUpperCase())}</span><span class="ph-date">${fmtDateLong(s.createdAt)}</span></header>
      <h1 class="paper-title">${esc(s.title || (s.kind === 'study' ? 'Lernzettel' : 'Mitschrift'))}</h1>
      ${MD.toHtml(blocks, { resolveImage: (src) => resolveImage(s, src), figureActions: true })}
      ${s.status === 'final' || s.kind === 'study' ? '' : '<div class="paper-cursor" aria-hidden="true"></div>'}`;
    renderCounts(s);
  }

  function resolveImage(s, src) {
    if (!src.startsWith('img:')) return { url: src };
    const im = s.images && s.images[src.slice(4)];
    return im ? { url: im.dataUrl, caption: im.caption, credit: im.credit } : null;
  }

  function onPaperClick(e, s) {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const img = e.target.closest('figure img');
      if (img) lightbox(img.src);
      return;
    }
    const holder = btn.closest('[data-src]');
    const src = holder && holder.dataset.src;
    const act = btn.dataset.action;
    if (act === 'drop-image') { replaceImageRef(s, src, null); return; }
    if (act === 'pick-image' || act === 'swap-image') {
      let term = holder.dataset.term || '';
      if (!term && src.startsWith('img:')) { const im = s.images[src.slice(4)]; term = (im && (im.term || im.caption)) || holder.dataset.alt || ''; }
      imagePicker(s, term || holder.dataset.alt, (id) => replaceImageRef(s, src, id, holder.dataset.alt));
    }
  }

  function replaceImageRef(s, src, newId, alt) {
    const md = notesMd(s);
    const lines = md.split('\n');
    const i = lines.findIndex(l => l.includes(`](${src})`));
    if (i < 0) return;
    if (newId) lines[i] = lines[i].replace(`](${src})`, `](img:${newId})`);
    else lines.splice(i, 1);
    setNotesMd(s, lines.join('\n'));
    save(s); renderNotes(s);
  }

  function lightbox(url) {
    const m = modal({ title: '', body: `<img src="${esc(url)}" class="lightbox-img" alt="">`, wide: true, className: 'lightbox' });
    $('.lightbox-img', m.el).onclick = m.close;
  }

  function toggleEdit(s) {
    const paper = $('#paper');
    if (!st.editing) {
      st.editing = true;
      $('#btn-edit').innerHTML = '💾 <span class="lbl">Speichern</span>';
      paper.innerHTML = `<div class="editor">
        <p class="muted small">Markdown: <code>## Überschrift</code>, <code>- Punkt</code>, <code>**fett**</code>, <code>$x^2$</code>, <code>$$\\frac{a}{b}$$</code>, <code>&gt; [!MERKE]</code> …</p>
        <textarea id="editor" spellcheck="true">${esc(notesMd(s))}</textarea>
        <div class="editor-actions"><button class="btn ghost small" id="ed-cancel">Abbrechen</button><button class="btn primary small" id="ed-save">Speichern</button></div></div>`;
      const ta = $('#editor');
      ta.style.height = Math.max(400, ta.scrollHeight + 20) + 'px';
      $('#ed-cancel').onclick = () => { st.editing = false; $('#btn-edit').innerHTML = '✏️ <span class="lbl">Bearbeiten</span>'; renderNotes(s); };
      $('#ed-save').onclick = () => toggleEdit(s);
    } else {
      const v = $('#editor').value;
      st.editing = false;
      setNotesMd(s, v);
      save(s);
      $('#btn-edit').innerHTML = '✏️ <span class="lbl">Bearbeiten</span>';
      renderNotes(s);
      toast('Gespeichert ✓');
    }
  }

  // ---------- Transkript ----------
  function segHtml(x) {
    return `<div class="seg ${x.kind === 'note' ? 'note' : ''}"><time>${mmss(x.t)}</time><p>${x.kind === 'note' ? '✍️ ' : ''}${esc(x.text)}</p></div>`;
  }
  function renderTranscript(s) {
    const el = $('#transcript'); if (!el) return;
    if (!window.LiveTranscriber.supported()) {
      el.innerHTML = `<div class="notice">Dieser Browser kann keine Live-Spracherkennung. Öffne AutoDoku in <b>Chrome</b> oder <b>Edge</b> (am Handy: Chrome). Notizen tippen, Text einfügen und Fotos gehen trotzdem.</div>`;
    } else el.innerHTML = '';
    el.insertAdjacentHTML('beforeend', s.segments.length ? s.segments.map(segHtml).join('') : '<p class="empty small" id="tr-empty">Hier erscheint live, was gesagt wird.</p>');
    el.insertAdjacentHTML('beforeend', '<div class="seg interim" id="interim"></div>');
    scrollTranscript(true);
  }
  function appendSeg(x) {
    const el = $('#transcript'); if (!el) return;
    const e = $('#tr-empty'); if (e) e.remove();
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    $('#interim').insertAdjacentHTML('beforebegin', segHtml(x));
    if (near) scrollTranscript(true);
  }
  function scrollTranscript(force) { const el = $('#transcript'); if (el && force) el.scrollTop = el.scrollHeight; }

  async function addNote(s) {
    const t = await prompt('Eigene Notiz', { placeholder: 'z. B. „Das kommt sicher zur SA“ oder eine Formel von der Tafel', multiline: true, okLabel: 'Hinzufügen' });
    if (!t || !t.trim()) return;
    const x = { t: curRecMs(s), text: t.trim(), kind: 'note' };
    s.segments.push(x);
    if (s.status === 'new') s.status = 'paused';
    save(s); appendSeg(x);
    toast('Notiz gespeichert – fließt ins nächste Update ein.');
  }

  async function pasteText(s) {
    const t = await prompt('Transkript / Text einfügen', { placeholder: 'z. B. aus einer anderen Aufnahme-App, Teams-Transkript, Skript …', multiline: true, okLabel: 'Einfügen' });
    if (!t || !t.trim()) return;
    const parts = t.trim().split(/\n+/).filter(Boolean);
    parts.forEach(p => { const x = { t: curRecMs(s), text: p.trim(), kind: 'speech' }; s.segments.push(x); appendSeg(x); });
    if (s.status === 'new') s.status = 'paused';
    save(s);
    toast(`${words(t)} Wörter eingefügt.`);
    if (Settings.get().apiKey && Settings.get().liveUpdates) liveUpdate(s, true);
  }

  // ---------- Aufgaben ----------
  function renderTasks(s) {
    const el = $('#tasks'); if (!el) return;
    el.innerHTML = (s.tasks || []).length ? s.tasks.map(t => taskItem(t, null)).join('') : '<p class="empty small">Hausübungen, Tests und Abgaben landen automatisch hier.</p>';
    bindTaskChecks([]);
    $$('[data-del-task]', el).forEach(b => b.onclick = () => {
      const id = b.closest('.task').dataset.task;
      s.tasks = s.tasks.filter(t => t.id !== id); save(s); renderTasks(s);
    });
    renderCounts(s);
  }

  // ---------- Fotos ----------
  function renderPhotos(s) {
    const el = $('#photos'); if (!el) return;
    const imgs = Object.entries(s.images || {}).filter(([, im]) => im.kind === 'board');
    el.innerHTML = imgs.length ? imgs.map(([id, im]) => `<figure class="thumb ${im.pending ? 'pending' : ''}" data-id="${esc(id)}"><img src="${esc(im.dataUrl)}" alt=""><figcaption>${im.pending ? 'Claude liest …' : esc(im.caption || 'Foto')}</figcaption></figure>`).join('')
      : '<p class="empty small">Fotografier die Tafel, eine Folie oder dein Heft – AutoDoku überträgt den Inhalt (inkl. Formeln) in die Mitschrift.</p>';
    $$('.thumb img', el).forEach(i => i.onclick = () => lightbox(i.src));
    renderCounts(s);
  }

  function pickPhoto(s) {
    const inp = $('#photo-input');
    inp.value = '';
    inp.click();
  }
  // auch ohne Klick auf den Button (z. B. Drag & Drop / Tests) an die offene Stunde hängen
  $('#photo-input').onchange = () => {
    const s = st.viewOnly && $('.session') ? st.viewOnly : st.session;
    const files = Array.from($('#photo-input').files || []);
    if (s && files.length) addPhotos(s, files);
  };

  async function addPhotos(s, files) {
    const set = Settings.get();
    const sub = Subjects.get(s.subjectId);
    for (const f of files) {
      let im;
      try { im = await Images.toJpeg(f, 1600, 0.85); } catch (e) { toast('Foto konnte nicht gelesen werden', 'err'); continue; }
      const id = uid('img');
      s.images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: 'Tafelbild', credit: '', kind: 'board', pending: !!set.apiKey, t: curRecMs(s) };
      if (s.status === 'new') s.status = 'paused';
      save(s); renderPhotos(s);
      if (!set.apiKey) {
        insertSection(s, `## Tafelbild\n\n![Tafelbild](img:${id})`, false);
        continue;
      }
      toast('📷 Claude liest das Foto …');
      try {
        const r = await Claude.withRetry(() => Claude.call({
          apiKey: set.apiKey, model: set.modelFinal, maxTokens: 3000, tag: s.id,
          system: Prompts.board(sub, set),
          messages: [{ role: 'user', content: [Claude.imageBlock(im.dataUrl), { type: 'text', text: `Bisherige Gliederung:\n${(s.finalNotes != null ? splitSections(s.finalNotes) : s.sections).map(firstLine).join('\n') || '(leer)'}\n\nLetzter Abschnitt:\n${(s.sections || []).slice(-1)[0] || ''}` }] }],
        }));
        const caption = Claude.tag(r.text, 'caption') || 'Tafelbild';
        const placement = Claude.tag(r.text, 'placement');
        let heading = Claude.tag(r.text, 'heading');
        const content = Claude.tag(r.text, 'content');
        s.images[id].caption = caption;
        delete s.images[id].pending;
        const body = `![${caption.replace(/[[\]]/g, '')}](img:${id})\n\n${content}`.trim();
        if (heading && !/^#{2,3}\s/.test(heading)) heading = '## ' + heading.replace(/^#+\s*/, '');
        insertSection(s, placement.includes('append') && !heading ? body : `${heading || '## ' + caption}\n\n${body}`, placement.includes('append'));
        toast('✓ Foto eingearbeitet');
      } catch (e) {
        delete s.images[id].pending;
        insertSection(s, `## Tafelbild\n\n![Tafelbild](img:${id})`, false);
        toast('Foto gespeichert, aber Claude-Fehler: ' + esc(e.message), 'err', 6000);
      }
      save(s); renderPhotos(s); renderNotes(s);
    }
  }

  function insertSection(s, md, appendToLast) {
    if (s.finalNotes != null) { s.finalNotes = s.finalNotes.trim() + '\n\n' + md; return; }
    if (appendToLast && s.sections.length) s.sections[s.sections.length - 1] += '\n\n' + md;
    else s.sections.push(md);
    renderNotes(s);
  }

  // ---------- Bilder suchen ----------
  function imagePicker(s, term, onPick) {
    const m = modal({
      title: '🖼️ Bild suchen', wide: true,
      body: `<form class="img-search" id="img-search"><input class="input" id="img-q" value="${esc(term || '')}" placeholder="Suchbegriff (englisch klappt am besten)"><button class="btn primary">Suchen</button></form>
        <p class="muted small">Freie Bilder von Wikimedia Commons – Quelle & Lizenz werden automatisch angegeben.</p>
        <div class="img-grid" id="img-grid"></div>
        <div class="img-own"><button class="btn ghost small" id="img-upload">📁 Eigenes Bild hochladen</button></div>`,
    });
    const grid = $('#img-grid', m.el);
    const run = async () => {
      const q = $('#img-q', m.el).value.trim();
      if (!q) return;
      grid.innerHTML = '<div class="spinner"></div>';
      try {
        const res = await Images.searchCommons(q, 15);
        if (!res.length) { grid.innerHTML = '<p class="empty">Nichts gefunden – probier einen englischen oder einfacheren Begriff.</p>'; return; }
        grid.innerHTML = res.map((r, i) => `<button class="img-hit" data-i="${i}" title="${esc(r.title)}"><img src="${esc(r.thumb)}" alt="" loading="lazy"><span>${esc(r.credit)}</span></button>`).join('');
        $$('.img-hit', grid).forEach(b => b.onclick = async () => {
          const r = res[+b.dataset.i];
          b.classList.add('loading');
          try {
            const im = await Images.fetchAsJpeg(r.thumb);
            const id = uid('img');
            s.images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: r.title, credit: r.credit, kind: 'web', term: q, page: r.page };
            m.close(); onPick(id);
          } catch (e) { b.classList.remove('loading'); toast('Bild konnte nicht geladen werden', 'err'); }
        });
      } catch (e) { grid.innerHTML = `<p class="empty">Bildersuche nicht erreichbar (${esc(e.message)}).</p>`; }
    };
    $('#img-search', m.el).onsubmit = (e) => { e.preventDefault(); run(); };
    $('#img-upload', m.el).onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const im = await Images.toJpeg(f, 1400, 0.88);
        const id = uid('img');
        s.images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: f.name.replace(/\.[^.]+$/, ''), credit: '', kind: 'web' };
        m.close(); onPick(id);
      };
      inp.click();
    };
    if (term) run();
  }

  async function autoResolveSuggestions(s) {
    const md = notesMd(s);
    const re = /!\[([^\]]*)\]\((search:[^)\s]+)\)/g;
    const found = [...md.matchAll(re)];
    let n = 0;
    for (const m of found) {
      const term = safeDecode(m[2].slice(7)).replace(/\+/g, ' ');
      try {
        const res = await Images.searchCommons(term, 5);
        if (!res.length) continue;
        const im = await Images.fetchAsJpeg(res[0].thumb);
        const id = uid('img');
        s.images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: m[1] || res[0].title, credit: res[0].credit, kind: 'web', term, page: res[0].page };
        setNotesMd(s, notesMd(s).replace(`](${m[2]})`, `](img:${id})`));
        n++;
      } catch (e) { /* Vorschlag bleibt als Karte stehen */ }
    }
    if (n) { save(s); renderNotes(s); toast(`🖼️ ${n} passende${n > 1 ? '' : 's'} Bild${n > 1 ? 'er' : ''} eingefügt – mit 🔄 austauschbar.`); }
  }

  // ============ Aufnahme ============
  function curRecMs(s) {
    const L = st.live;
    return (s.durationMs || 0) + (L && L.recording && st.session === s ? Date.now() - L.startedAt : 0);
  }

  async function startRecording() {
    const s = st.session;
    if (!s || s.kind !== 'lesson') return;
    if (!window.LiveTranscriber.supported()) { toast('Live-Spracherkennung geht nur in Chrome/Edge. Notizen & Fotos funktionieren trotzdem.', 'warn', 6000); return; }
    const sub = Subjects.get(s.subjectId);
    if (s.finalNotes != null) {
      // nach "Fertig" weitermachen: polierte Version wird Basis für weitere Live-Updates
      s.sections = splitSections(s.finalNotes);
      s.finalNotes = null;
    }
    const L = st.live = {
      recording: true, startedAt: Date.now(), lastUpdateAt: Date.now(), busy: false, errors: 0, sid: s.id,
      transcriber: null, wakeLock: null, tick: null, interim: '',
    };
    L.transcriber = new LiveTranscriber({
      onFinal: (text) => {
        const x = { t: curRecMs(s), text, kind: 'speech' };
        s.segments.push(x);
        save(s);
        if (st.session === s) appendSeg(x);
      },
      onInterim: (text) => { L.interim = text; const el = $('#interim'); if (el && st.session === s) { el.textContent = text; if (text) scrollTranscript(true); } },
      onState: () => renderLiveInfo(),
      onError: (msg, fatal) => { toast(esc(msg), fatal ? 'err' : 'warn', fatal ? 8000 : 4000); if (fatal) stopRecording(); },
    });
    L.transcriber.start(sub.speechLang || 'de-AT');
    s.status = 'live';
    save(s);
    L.tick = setInterval(() => tick(s), 1000);
    if (Settings.get().keepAwake) requestWakeLock();
    renderRecBtn(); renderLiveInfo(); renderNotes(s);
    setTopMid(recPill(s));
  }

  function stopRecording(noFlush) {
    const L = st.live; if (!L || !L.recording) return;
    const s = st.session;
    L.recording = false;
    L.transcriber && L.transcriber.stop();
    clearInterval(L.tick);
    if (s) {
      s.durationMs = (s.durationMs || 0) + (Date.now() - L.startedAt);
      if (s.status === 'live') s.status = 'paused';
      saveNow(s);
    }
    releaseWakeLock();
    renderRecBtn(); renderLiveInfo();
    setTopMid('');
    // Rest noch einarbeiten
    if (!noFlush && s && s.cursor < s.segments.length && Settings.get().apiKey && Settings.get().liveUpdates) liveUpdate(s, true);
  }

  function tick(s) {
    const L = st.live; if (!L || !L.recording) return;
    renderLiveInfo();
    const pill = $('#rec-pill-time'); if (pill) pill.textContent = mmss(curRecMs(s));
    const set = Settings.get();
    if (!set.apiKey || !set.liveUpdates || L.busy || st.editing) return;
    const since = (Date.now() - L.lastUpdateAt) / 1000;
    const backoff = Math.min(300, set.interval * Math.pow(2, L.errors));
    if (since < (L.errors ? backoff : set.interval)) return;
    const pendingWords = words(s.segments.slice(s.cursor).map(x => x.text).join(' '));
    if (pendingWords >= set.minWords) liveUpdate(s, false);
  }

  function recPill(s) {
    return `<a class="rec-pill" href="#/stunde/${esc(s.id)}"><span class="dot rec"></span>REC <span id="rec-pill-time">${mmss(curRecMs(s))}</span></a>`;
  }

  function renderRecBtn() {
    const b = $('#rec-btn'); if (!b) return;
    const on = st.live && st.live.recording && st.session && $('.session') && st.live.sid === st.session.id;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-label', on ? 'Aufnahme pausieren' : 'Aufnahme starten');
    b.title = on ? 'Pause' : 'Aufnahme starten';
  }

  function renderLiveInfo() {
    const el = $('#live-info'); if (!el) return;
    const s = st.session;
    const L = st.live;
    const set = Settings.get();
    if (!s || s.kind !== 'lesson') { el.innerHTML = s && s.kind === 'study' ? '<span class="li-chip">📚 Lernzettel</span>' + costChip(s) : ''; return; }
    if (st.finalizing) { el.innerHTML = '<span class="li-chip busy"><span class="spin"></span> Claude poliert die Mitschrift …</span>'; return; }
    if (L && L.recording) {
      const pending = words(s.segments.slice(s.cursor).map(x => x.text).join(' '));
      const rest = Math.max(0, Math.round(set.interval - (Date.now() - L.lastUpdateAt) / 1000));
      const state = L.transcriber && L.transcriber.state === 'restarting' ? 'hört gleich wieder zu' : 'hört zu';
      el.innerHTML = `<span class="li-chip rec"><span class="dot rec"></span>${mmss(curRecMs(s))} · ${state}</span>` +
        (!set.apiKey ? '<span class="li-chip warn">kein API-Schlüssel</span>'
          : L.busy ? '<span class="li-chip busy"><span class="spin"></span> schreibt mit …</span>'
            : !set.liveUpdates ? '<span class="li-chip" title="Sparstufe „Nur am Ende“">🪙 Zusammenfassung bei „Fertig“</span>'
              : `<span class="li-chip">${pending < set.minWords ? `${pending}/${set.minWords} Wörter` : `Update in ${rest}s`}</span>`) + costChip(s);
    } else if (L && L.busy) {
      el.innerHTML = '<span class="li-chip busy"><span class="spin"></span> schreibt mit …</span>';
    } else {
      el.innerHTML = (s.status === 'final' ? '<span class="li-chip ok">✓ fertig poliert</span>' : s.segments.length ? `<span class="li-chip">⏸ pausiert · ${fmtDur(s.durationMs)}</span>` : '<span class="li-chip">bereit</span>') + costChip(s);
    }
  }

  function costChip(s) {
    if (!s.usage || !s.usage.input) return '';
    return `<span class="li-chip cost" title="${fmtTok(s.usage.input + s.usage.output)} Tokens für diese Stunde (${fmtTok(s.usage.input)} rein, ${fmtTok(s.usage.output)} raus)">💰 ${fmtCost(s.usage.cost)}</span>`;
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) { st.live.wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) { /* nicht schlimm */ }
  }
  function releaseWakeLock() { try { st.live && st.live.wakeLock && st.live.wakeLock.release(); } catch (e) { /* egal */ } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st.live && st.live.recording) {
      if (Settings.get().keepAwake) requestWakeLock();
      const t = st.live.transcriber;
      if (t && t.state !== 'listening') { try { t._spawn(); } catch (e) { /* läuft schon */ } }
    }
  });
  window.addEventListener('beforeunload', (e) => { if (st.live && st.live.recording) { e.preventDefault(); e.returnValue = ''; } });

  // ============ Claude: Live-Update ============
  async function liveUpdate(s, force) {
    const set = Settings.get();
    const L = st.live || (st.live = { recording: false, busy: false, errors: 0, lastUpdateAt: Date.now() });
    if (L.busy || st.finalizing) return;
    if (st.editing) { if (force) toast('Erst Bearbeiten speichern'); return; }
    if (!set.apiKey) { if (force) { toast('Für Zusammenfassungen brauchst du einen Claude-API-Schlüssel.', 'warn'); openSettings(); } return; }
    const pending = s.segments.slice(s.cursor);
    if (!pending.length) { if (force) toast('Seit dem letzten Update wurde nichts Neues gesagt.'); return; }
    const upto = s.segments.length;
    const sub = Subjects.get(s.subjectId);
    const segment = pending.map(x => (x.kind === 'note' ? `[Notiz vom Schüler: ${x.text}]` : x.text)).join(' ');
    const context = s.segments.slice(Math.max(0, s.cursor - 30), s.cursor).map(x => x.text).join(' ').slice(-700);
    L.busy = true; renderLiveInfo();
    try {
      const r = await Claude.withRetry(() => Claude.call({
        apiKey: set.apiKey, model: set.modelLive, maxTokens: 3500, temperature: 0.2, tag: s.id,
        system: Prompts.live(sub, set),
        messages: [{
          role: 'user', content: Prompts.liveUser({
            outline: s.sections.map((m, i) => `${i + 1}. ${firstLine(m)}`).join('\n'),
            last: s.sections[s.sections.length - 1] || '',
            tasks: (s.tasks || []).map(t => `${t.text}${t.due ? ' (' + t.due + ')' : ''}`).join('; '),
            context, segment, title: s.title,
          }),
        }],
      }));
      applyLive(s, r.text);
      s.cursor = upto;
      L.errors = 0;
      save(s);
      if (st.session === s) { renderNotes(s); renderTasks(s); const t = $('#title'); if (t && document.activeElement !== t) t.value = s.title; }
    } catch (e) {
      L.errors = (L.errors || 0) + 1;
      toast('Update fehlgeschlagen: ' + esc(e.message), 'err', 6000);
      if (e.type === 'no_key' || e.status === 401) L.errors = 6;
    } finally {
      L.busy = false;
      L.lastUpdateAt = Date.now();
      renderLiveInfo();
    }
  }

  function applyLive(s, text) {
    const title = Claude.tag(text, 'title');
    if (title && !s.titleLocked && !/^\(|^leer$/i.test(title)) s.title = title.replace(/^#+\s*/, '').slice(0, 90);
    const rep = Claude.tag(text, 'replace_last');
    const app = Claude.tag(text, 'append');
    if (rep && rep.length > 8 && !/^\(?leer\)?$/i.test(rep)) {
      const old = s.sections[s.sections.length - 1] || '';
      let neu = rep;
      // Bilder aus dem alten Abschnitt nie verlieren
      const imgs = old.match(/!\[[^\]]*\]\(img:[^)]+\)/g) || [];
      imgs.forEach(ref => { if (!neu.includes(ref.replace(/^!\[[^\]]*\]/, ''))) neu += '\n\n' + ref; });
      if (s.sections.length) s.sections[s.sections.length - 1] = neu; else s.sections.push(neu);
    }
    if (app && app.length > 8 && !/^\(?leer\)?$/i.test(app)) s.sections.push(...splitSections(app));
    const tasks = parseTasks(Claude.tag(text, 'tasks'));
    if (tasks.length) {
      const before = (s.tasks || []).length;
      mergeTasks(s, tasks);
      if (s.tasks.length > before) toast(`📌 Neu eingetragen: ${esc(s.tasks[s.tasks.length - 1].text)}`, 'ok', 5000);
    }
  }

  // ============ Claude: Fertig & polieren ============
  async function finalize(s) {
    const set = Settings.get();
    if (st.finalizing) return;
    if (!set.apiKey) { toast('Dafür brauchst du einen Claude-API-Schlüssel.', 'warn'); openSettings(); return; }
    if (!s.segments.length && !Object.keys(s.images).length) { toast('Noch nichts aufgenommen.'); return; }
    if (st.editing) toggleEdit(s);
    if (st.live && st.live.recording && st.session === s) stopRecording(true);
    // auf laufendes Live-Update warten
    for (let i = 0; i < 60 && st.live && st.live.busy; i++) await new Promise(r => setTimeout(r, 500));
    const sub = Subjects.get(s.subjectId);
    st.finalizing = true; renderLiveInfo();
    if (isMobile()) setMTab('notes');
    const paper = $('#paper');
    const backup = notesMd(s);
    let lastRender = 0;
    const transcript = s.segments.map(x => `[${mmss(x.t)}] ${x.kind === 'note' ? '(Notiz vom Schüler) ' : ''}${x.text}`).join('\n');
    const images = Object.entries(s.images).filter(([, im]) => im.kind === 'board').map(([id, im]) => `img:${id} = ${im.caption}`).join('; ');
    paper.classList.add('streaming');
    try {
      const r = await Claude.withRetry(() => Claude.stream({
        apiKey: set.apiKey, model: set.modelFinal, maxTokens: 16000, temperature: 0.3, tag: s.id,
        system: Prompts.final(sub, set),
        messages: [{
          role: 'user', content: Prompts.finalUser({
            transcript: transcript.slice(-180000), notes: backup,
            tasks: (s.tasks || []).map(t => `${t.text}${t.due ? ' (' + t.due + ')' : ''}`).join('; '),
            images, title: s.title,
          }),
        }],
        onText: (txt) => {
          const now = Date.now();
          if (now - lastRender < 300) return;
          lastRender = now;
          const partial = Claude.tag(txt, 'notes');
          if (partial && st.session === s && $('#paper')) {
            $('#paper').innerHTML = `<header class="paper-head"><span class="ph-sub">${esc(sub.emoji)} ${esc(sub.name.toUpperCase())}</span><span class="ph-date">✨ wird poliert …</span></header>
              <h1 class="paper-title">${esc(Claude.tag(txt, 'title') || s.title || 'Mitschrift')}</h1>${MD.toHtml(MD.parse(partial), { resolveImage: (src) => resolveImage(s, src) })}<div class="paper-cursor"></div>`;
            const p = $('#paper'); p.scrollTop = p.scrollHeight;
          }
        },
      }));
      const notes = Claude.tag(r.text, 'notes');
      if (!notes || notes.length < 40) throw new Error('Antwort unvollständig');
      const title = Claude.tag(r.text, 'title');
      if (title && !s.titleLocked) s.title = title.replace(/^#+\s*/, '').slice(0, 90);
      s.finalNotes = notes;
      s.liveNotesBackup = backup;
      mergeTasks(s, parseTasks(Claude.tag(r.text, 'tasks')));
      s.status = 'final';
      s.cursor = s.segments.length;
      await saveNow(s);
      if (r.stop === 'max_tokens') toast('Die Mitschrift war sehr lang und wurde am Ende abgeschnitten.', 'warn', 7000);
      toast('✨ Fertig! Jetzt als Word exportieren.', 'ok');
    } catch (e) {
      toast('Polieren fehlgeschlagen: ' + esc(e.message) + ' – die Live-Mitschrift bleibt erhalten.', 'err', 8000);
    } finally {
      st.finalizing = false;
      paper.classList.remove('streaming');
      if (st.session === s) { const t = $('#title'); if (t) t.value = s.title; renderNotes(s); renderTasks(s); renderLiveInfo(); }
    }
    if (s.status === 'final' && set.suggestImages) autoResolveSuggestions(s);
  }

  // ============ Claude: Fragen & Rettungsknopf ============
  function renderChat(s) {
    const el = $('#chat'); if (!el) return;
    const msgs = s.chat || [];
    el.innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.role}">${m.role === 'user' ? esc(m.text) : MD.toHtml(MD.parse(m.text))}</div>`).join('')
      : `<div class="chat-empty"><p>Frag alles zur Stunde, z. B.:</p>
         <button class="chip" data-q="Erklär mir das Wichtigste nochmal einfach.">Erklär's mir einfach</button>
         <button class="chip" data-q="Was kommt wahrscheinlich zum Test?">Was kommt zum Test?</button>
         <button class="chip" data-q="Gib mir eine Übungsaufgabe mit Lösung.">Übungsaufgabe</button></div>`;
    $$('[data-q]', el).forEach(b => b.onclick = () => askQuestion(s, b.dataset.q));
    el.scrollTop = el.scrollHeight;
  }

  async function streamToChat(s, system, userContent, model, label) {
    const set = Settings.get();
    if (!set.apiKey) { toast('Dafür brauchst du einen Claude-API-Schlüssel.', 'warn'); openSettings(); return; }
    s.chat = s.chat || [];
    const msg = { role: 'assistant', text: label ? label + '\n\n…' : '…' };
    s.chat.push(msg);
    renderChat(s);
    const el = $('#chat');
    const node = el && el.lastElementChild;
    try {
      const history = s.chat.slice(0, -2).slice(-6).map(m => ({ role: m.role, content: m.text }));
      while (history.length && history[0].role !== 'user') history.shift();
      const r = await Claude.stream({
        apiKey: set.apiKey, model, maxTokens: 1500, tag: s.id,
        system, messages: [...history, { role: 'user', content: userContent }],
        onText: (t) => { msg.text = (label ? label + '\n\n' : '') + t; if (node && node.isConnected) { node.innerHTML = MD.toHtml(MD.parse(msg.text)); el.scrollTop = el.scrollHeight; } },
      });
      msg.text = (label ? label + '\n\n' : '') + r.text;
    } catch (e) {
      msg.text = '⚠️ ' + e.message;
    }
    save(s); renderChat(s);
  }

  function contextBlock(s, maxTranscript) {
    const tr = s.segments.map(x => x.text).join(' ').slice(-(maxTranscript || 30000));
    return `MITSCHRIFT:\n${notesMd(s).slice(0, 40000) || '(leer)'}\n\nTRANSKRIPT (Auszug):\n${tr || '(leer)'}`;
  }

  function askQuestion(s, q) {
    s.chat = s.chat || [];
    s.chat.push({ role: 'user', text: q });
    if (isMobile()) setMTab('chat'); else setSideTab('chat');
    const set = Settings.get();
    streamToChat(s, Prompts.ask(Subjects.get(s.subjectId), set), `${contextBlock(s)}\n\nFRAGE: ${q}`, set.modelFinal);
  }

  function recap(s) {
    const now = curRecMs(s);
    let segs = s.segments.filter(x => x.t >= now - 3 * 60000);
    if (!segs.length) segs = s.segments.slice(-15);
    if (!segs.length) { toast('Es wurde noch nichts gesagt 😴'); return; }
    s.chat = s.chat || [];
    s.chat.push({ role: 'user', text: '🆘 Was war gerade?' });
    if (isMobile()) setMTab('chat'); else setSideTab('chat');
    const set = Settings.get();
    streamToChat(s, Prompts.recap(Subjects.get(s.subjectId), set),
      `Bisherige Mitschrift (Überblick):\n${(s.sections || []).map(firstLine).join('\n') || notesMd(s).slice(0, 2000)}\n\nDIE LETZTEN MINUTEN:\n"""\n${segs.map(x => x.text).join(' ')}\n"""`, set.modelLive);
  }

  // ============ Lernzettel & Quiz ============
  async function makeStudySheet(sub, list) {
    const set = Settings.get();
    if (!set.apiKey) { toast('Dafür brauchst du einen Claude-API-Schlüssel.', 'warn'); openSettings(); return; }
    const sheet = newSession(sub.id, 'study');
    sheet.title = `Lernzettel ${sub.name}`;
    sheet.status = 'final';
    sheet.finalNotes = '';
    // referenzierte Bilder übernehmen
    list.forEach(s => Object.entries(s.images || {}).forEach(([id, im]) => { if (notesMd(s).includes(`img:${id}`)) sheet.images[id] = im; }));
    await saveNow(sheet);
    st.session = sheet;
    location.hash = `#/stunde/${sheet.id}`;
    await new Promise(r => setTimeout(r, 150));
    const src = list.slice().reverse().map(s => `### ${s.title || 'Stunde'} (${fmtDate(s.createdAt)})\n${notesMd(s) || '(leer)'}`).join('\n\n---\n\n');
    st.finalizing = true;
    const paper = $('#paper');
    paper.innerHTML = '<div class="paper-empty"><div class="spinner"></div><h3>Lernzettel wird erstellt …</h3></div>';
    let last = 0;
    try {
      const r = await Claude.withRetry(() => Claude.stream({
        apiKey: set.apiKey, model: set.modelFinal, maxTokens: 16000, tag: sheet.id,
        system: Prompts.studySheet(sub, set),
        messages: [{ role: 'user', content: `MITSCHRIFTEN:\n\n${src.slice(0, 200000)}` }],
        onText: (t) => {
          if (Date.now() - last < 300) return; last = Date.now();
          const n = Claude.tag(t, 'notes');
          if (n && $('#paper')) $('#paper').innerHTML = `<h1 class="paper-title">${esc(Claude.tag(t, 'title') || sheet.title)}</h1>${MD.toHtml(MD.parse(n), { resolveImage: (x) => resolveImage(sheet, x) })}<div class="paper-cursor"></div>`;
        },
      }));
      sheet.title = Claude.tag(r.text, 'title') || sheet.title;
      sheet.finalNotes = Claude.tag(r.text, 'notes') || r.text;
      await saveNow(sheet);
      toast('📚 Lernzettel fertig!', 'ok');
    } catch (e) {
      toast('Fehler: ' + esc(e.message), 'err', 7000);
    } finally {
      st.finalizing = false;
      if (st.session === sheet) { const t = $('#title'); if (t) t.value = sheet.title; renderNotes(sheet); }
    }
  }

  async function runQuiz(sub, list) {
    const set = Settings.get();
    if (!set.apiKey) { toast('Dafür brauchst du einen Claude-API-Schlüssel.', 'warn'); openSettings(); return; }
    const m = modal({ title: `🧠 Quiz · ${esc(sub.name)}`, body: '<div class="quiz"><div class="spinner"></div><p class="muted center">Claude baut deine Karteikarten …</p></div>', wide: true });
    try {
      const src = list.map(s => `### ${s.title}\n${notesMd(s)}`).join('\n\n').slice(0, 120000);
      const r = await Claude.call({ apiKey: set.apiKey, model: set.modelLive, maxTokens: 4000, system: Prompts.quiz(sub, set), messages: [{ role: 'user', content: `Erstelle 10 Karteikarten.\n\nMITSCHRIFTEN:\n${src}` }] });
      const cards = [...r.text.matchAll(/<card>([\s\S]*?)<\/card>/g)].map(x => ({ q: Claude.tag(x[1], 'q'), a: Claude.tag(x[1], 'a') })).filter(c => c.q);
      if (!cards.length) throw new Error('Keine Karten erhalten');
      let i = 0, known = 0;
      const body = $('.modal-body', m.el);
      const show = (flipped) => {
        if (i >= cards.length) {
          body.innerHTML = `<div class="quiz-done"><div class="big">${known >= cards.length * 0.8 ? '🏆' : known >= cards.length / 2 ? '💪' : '📚'}</div><h3>${known} von ${cards.length} gewusst</h3><p class="muted">${known >= cards.length * 0.8 ? 'Stark – du bist bereit.' : 'Schau dir die Mitschrift nochmal an und probier es gleich nochmal.'}</p></div>`;
          return;
        }
        const c = cards[i];
        body.innerHTML = `<div class="quiz">
          <div class="quiz-progress"><span style="width:${(i / cards.length) * 100}%"></span></div>
          <button class="flashcard ${flipped ? 'flipped' : ''}" id="fc">
            <div class="fc-label">${flipped ? 'Antwort' : `Frage ${i + 1}/${cards.length}`}</div>
            <div class="fc-text">${MD.toHtml(MD.parse(flipped ? c.a : c.q))}</div>
            ${flipped ? '' : '<div class="fc-hint">Tippen zum Umdrehen</div>'}
          </button>
          ${flipped ? '<div class="quiz-actions"><button class="btn" id="q-no">😬 Nicht gewusst</button><button class="btn primary" id="q-yes">😎 Gewusst</button></div>' : ''}
        </div>`;
        $('#fc', body).onclick = () => { if (!flipped) show(true); };
        if (flipped) {
          $('#q-yes', body).onclick = () => { known++; i++; show(false); };
          $('#q-no', body).onclick = () => { i++; show(false); };
        }
      };
      show(false);
    } catch (e) {
      $('.modal-body', m.el).innerHTML = `<p class="empty">Fehler: ${esc(e.message)}</p>`;
    }
  }

  // ============ Word-Export ============
  function docBlocks(s, set) {
    const sub = Subjects.get(s.subjectId);
    const shift = (blocks) => blocks.map(b => {
      if (b.type === 'h') return Object.assign({}, b, { level: Math.max(1, b.level - 1) });
      if (b.type === 'callout') return Object.assign({}, b, { blocks: shift(b.blocks) });
      return b;
    }).filter(b => !(b.type === 'img' && b.src.startsWith('search:')));
    const blocks = shift(MD.parse(notesMd(s)));
    const meta = [
      s.durationMs >= 60000 ? `Dauer ${fmtDur(s.durationMs)}` : '',
      set.className,
      set.studentName ? `Mitschrift von ${set.studentName}` : '',
      s.kind === 'study' ? 'KI-Lernzettel' : 'automatisch mitgeschrieben mit AutoDoku',
    ];
    const out = [{ type: 'titleblock', subject: sub.name, emoji: sub.emoji, date: fmtDateLong(s.createdAt), title: s.title || 'Mitschrift', meta }, ...blocks];
    if ((s.tasks || []).length) out.push({ type: 'tasks', items: s.tasks });
    if (set.appendTranscript && s.segments.length) {
      out.push({ type: 'pagebreak' }, { type: 'h', level: 1, inl: [{ k: 'text', v: 'Anhang: Transkript' }] });
      s.segments.forEach(x => out.push({ type: 'p', inl: [{ k: 'text', v: `[${mmss(x.t)}]  `, b: true }, { k: 'text', v: x.text, i: x.kind === 'note' }] }));
    }
    return out;
  }

  async function exportWord(s) {
    if (st.editing) toggleEdit(s);
    if (!notesMd(s).trim()) { toast('Die Mitschrift ist noch leer.'); return; }
    const set = Settings.get();
    const sub = Subjects.get(s.subjectId);
    try {
      const blob = await DocxBuilder.buildDocx({
        blocks: docBlocks(s, set), accent: sub.color, images: s.images,
        header: `AutoDoku  ·  ${sub.name}  ·  ${s.title || ''}`.slice(0, 120), footer: `${sub.name} · ${fmtDate(s.createdAt)}`,
        title: s.title, subject: sub.name, author: set.studentName || 'AutoDoku',
      });
      const name = `${new Date(s.createdAt).toISOString().slice(0, 10)}_${slug(sub.name)}_${slug(s.title)}.docx`;
      await deliver(blob, name);
    } catch (e) {
      console.error(e);
      toast('Word-Export fehlgeschlagen: ' + esc(e.message), 'err');
    }
  }

  async function exportMany(sub, list) {
    if (!list.length) return;
    const set = Settings.get();
    let blocks = [];
    const images = {};
    list.forEach((s, i) => {
      if (i) blocks.push({ type: 'pagebreak' });
      blocks = blocks.concat(docBlocks(s, Object.assign({}, set, { appendTranscript: false })));
      Object.assign(images, s.images);
    });
    const blob = await DocxBuilder.buildDocx({ blocks, accent: sub.color, images, header: `AutoDoku  ·  ${sub.name}`, footer: sub.name, title: `${sub.name} – alle Mitschriften`, subject: sub.name });
    await deliver(blob, `${slug(sub.name)}_alle_Mitschriften.docx`);
  }

  async function deliver(blob, name) {
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
    // Handy: Teilen-Menü (OneDrive, Teams, WhatsApp …) anbieten
    if (file && isMobile() && navigator.canShare && navigator.canShare({ files: [file] })) {
      modal({
        title: '📄 Word-Datei fertig', body: `<p><b>${esc(name)}</b></p><p class="muted">Herunterladen oder direkt teilen (OneDrive, Teams, Mail …)?</p>`,
        actions: [
          { label: '⬇ Herunterladen', onClick: () => download(blob, name) },
          { label: '↗ Teilen', primary: true, onClick: () => { navigator.share({ files: [file], title: name }).catch(() => {}); } },
        ],
      });
      return;
    }
    download(blob, name);
    toast(`📄 <b>${esc(name)}</b> heruntergeladen`, 'ok', 5000);
  }

  // ============ Einstellungen ============
  function openSettings() {
    const s = Settings.get();
    const subs = Subjects.all();
    const m = modal({
      title: '⚙️ Einstellungen', wide: true,
      body: `
      <div class="settings">
        <fieldset><legend>Claude (KI)</legend>
          <label class="field"><span>API-Schlüssel</span>
            <div class="row"><input class="input" type="password" id="set-key" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"><button class="btn small" id="set-test" type="button">Testen</button></div>
            <small>Bekommst du auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (braucht etwas Guthaben). Der Schlüssel bleibt nur auf diesem Gerät.</small>
          </label>
        </fieldset>
        <fieldset><legend>Sparstufe</legend>
          <div class="modes">${Object.entries(Store.MODES).map(([k, m]) => `<label class="mode ${s.mode === k ? 'on' : ''}"><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''}><b>${m.label}</b><small>${m.hint}</small></label>`).join('')}</div>
          <details class="adv" ${s.mode === 'custom' ? 'open' : ''}><summary>Genauer einstellen</summary>
            <label class="check"><input type="checkbox" id="set-liveupd" ${s.liveUpdates ? 'checked' : ''}> Während der Stunde live zusammenfassen</label>
            <div class="grid2">
              <label class="field"><span>Modell live</span><input class="input" id="set-mlive" value="${esc(s.modelLive)}" list="models"></label>
              <label class="field"><span>Modell „Fertig“, Fotos & Fragen</span><input class="input" id="set-mfinal" value="${esc(s.modelFinal)}" list="models"></label>
            </div>
            <datalist id="models">${Object.keys(Claude.PRICES).map(m => `<option value="${m}">`).join('')}</datalist>
          </details>
          <p class="spend" id="spend"></p>
        </fieldset>
        <fieldset><legend>Live-Mitschrift</legend>
          <div class="grid2">
            <label class="field"><span>Update alle <b id="iv-val">${s.interval}</b> s</span><input type="range" id="set-interval" min="30" max="240" step="15" value="${s.interval}"></label>
            <label class="field"><span>…wenn mind. <b id="mw-val">${s.minWords}</b> neue Wörter</span><input type="range" id="set-minwords" min="15" max="200" step="5" value="${s.minWords}"></label>
          </div>
          <label class="check"><input type="checkbox" id="set-awake" ${s.keepAwake ? 'checked' : ''}> Bildschirm während der Aufnahme anlassen (am Handy wichtig – sonst stoppt die Erkennung)</label>
        </fieldset>
        <fieldset><legend>Word-Dokument</legend>
          <div class="grid2">
            <label class="field"><span>Dein Name</span><input class="input" id="set-name" value="${esc(s.studentName)}" placeholder="optional"></label>
            <label class="field"><span>Klasse</span><input class="input" id="set-class" value="${esc(s.className)}" placeholder="z. B. 3AHIF"></label>
          </div>
          <label class="check"><input type="checkbox" id="set-images" ${s.suggestImages ? 'checked' : ''}> Passende Bilder automatisch suchen (Wikimedia Commons, mit Quellenangabe)</label>
          <label class="check"><input type="checkbox" id="set-transcript" ${s.appendTranscript ? 'checked' : ''}> Komplettes Transkript als Anhang ins Word-Dokument</label>
        </fieldset>
        <fieldset><legend>Fächer</legend>
          <div class="subj-list">${subs.map(x => `<button class="subj-row" data-edit-sub="${esc(x.id)}" style="--c:${esc(x.color)}"><span>${esc(x.emoji)}</span><b>${esc(x.name)}</b><small>${esc(x.speechLang)}</small></button>`).join('')}
          <button class="subj-row add" data-edit-sub="">+ Fach hinzufügen</button></div>
        </fieldset>
        <fieldset><legend>Daten</legend>
          <p class="muted small">Alles bleibt lokal in diesem Browser. Audio wird nie gespeichert – nur Text. Die Spracherkennung von Chrome/Edge verarbeitet das Audio allerdings bei Google bzw. Microsoft; die Zusammenfassungen laufen über die Claude API.</p>
          <div class="row wrap"><button class="btn small" id="set-export" type="button">⬇ Sicherung exportieren</button><button class="btn small" id="set-import" type="button">⬆ Sicherung importieren</button><button class="btn small" id="set-demo" type="button">🎓 Demo-Stunde anlegen</button><button class="btn small danger" id="set-wipe" type="button">Alles löschen</button></div>
        </fieldset>
        <p class="fineprint">💬 Fair bleiben: Frag deine Lehrkraft kurz, ob Mitschreiben per App ok ist – die meisten finden's gut, wenn du's ansprichst.</p>
      </div>`,
      actions: [{ label: 'Schließen' }, {
        label: 'Speichern', primary: true, onClick: (el) => {
          Settings.set({
            apiKey: $('#set-key', el).value.trim(),
            mode: (el.querySelector('input[name=mode]:checked') || {}).value || 'custom',
            liveUpdates: $('#set-liveupd', el).checked,
            modelLive: $('#set-mlive', el).value.trim() || 'claude-haiku-5-5',
            modelFinal: $('#set-mfinal', el).value.trim() || 'claude-haiku-5-5',
            interval: +$('#set-interval', el).value, minWords: +$('#set-minwords', el).value,
            keepAwake: $('#set-awake', el).checked, studentName: $('#set-name', el).value.trim(), className: $('#set-class', el).value.trim(),
            suggestImages: $('#set-images', el).checked, appendTranscript: $('#set-transcript', el).checked,
          });
          toast('Gespeichert ✓');
          if (st.session) renderAll(st.session);
        },
      }],
    });
    const el = m.el;
    // Sparstufe wählen -> Felder vorbelegen
    const applyMode = (k) => {
      const md = Store.MODES[k]; if (!md) return;
      $('#set-mlive', el).value = md.modelLive; $('#set-mfinal', el).value = md.modelFinal;
      $('#set-liveupd', el).checked = md.liveUpdates;
      $('#set-interval', el).value = md.interval; $('#iv-val', el).textContent = md.interval;
      $('#set-minwords', el).value = md.minWords; $('#mw-val', el).textContent = md.minWords;
      $$('.mode', el).forEach(x => x.classList.toggle('on', x.querySelector('input').value === k));
    };
    $$('input[name=mode]', el).forEach(r => r.onchange = () => applyMode(r.value));
    const markCustom = () => { $$('input[name=mode]', el).forEach(r => { r.checked = false; }); $$('.mode', el).forEach(x => x.classList.remove('on')); };
    ['#set-mlive', '#set-mfinal', '#set-liveupd'].forEach(id => $(id, el).addEventListener('change', markCustom));
    const renderSpend = () => {
      const sp = Store.Spend.get();
      $('#spend', el).innerHTML = sp.input ? `Bisher verbraucht: <b>${fmtTok(sp.input + sp.output)} Tokens</b> · <b>${fmtCost(sp.cost)}</b> (USD, seit ${fmtDate(sp.since)}) <button class="btn tiny ghost" id="spend-reset" type="button">zurücksetzen</button>` : 'Noch nichts verbraucht.';
      const b = $('#spend-reset', el); if (b) b.onclick = () => { Store.Spend.reset(); renderSpend(); };
    };
    renderSpend();
    $('#set-interval', el).oninput = (e) => { $('#iv-val', el).textContent = e.target.value; };
    $('#set-minwords', el).oninput = (e) => { $('#mw-val', el).textContent = e.target.value; };
    ['#set-interval', '#set-minwords'].forEach(id => $(id, el).addEventListener('change', markCustom));
    $('#set-test', el).onclick = async () => {
      const b = $('#set-test', el); b.disabled = true; b.textContent = '…';
      try {
        await Claude.call({ apiKey: $('#set-key', el).value.trim(), model: $('#set-mlive', el).value.trim(), maxTokens: 10, messages: [{ role: 'user', content: 'Sag nur: ok' }] });
        b.textContent = '✓ läuft'; b.classList.add('ok');
      } catch (e) { b.textContent = 'Fehler'; toast(esc(e.message), 'err', 7000); }
      b.disabled = false;
    };
    $$('[data-edit-sub]', el).forEach(b => b.onclick = () => { m.close(); editSubject(b.dataset.editSub ? Subjects.get(b.dataset.editSub) : null); });
    $('#set-export', el).onclick = async () => { const d = await Store.exportAll(); download(new Blob([JSON.stringify(d)], { type: 'application/json' }), `AutoDoku_Sicherung_${new Date().toISOString().slice(0, 10)}.json`); };
    $('#set-import', el).onclick = () => {
      const inp = $('#import-input'); inp.value = '';
      inp.onchange = async () => {
        try { const n = await Store.importAll(JSON.parse(await inp.files[0].text())); toast(`${n} Mitschriften importiert`, 'ok'); m.close(); route(); } catch (e) { toast('Import fehlgeschlagen: ' + esc(e.message), 'err'); }
      };
      inp.click();
    };
    $('#set-demo', el).onclick = () => { m.close(); createDemo(); };
    $('#set-wipe', el).onclick = async () => {
      if (await confirmBox('Wirklich alles löschen?', 'Alle Mitschriften, Fotos und Aufgaben auf diesem Gerät werden gelöscht. Das kann man nicht rückgängig machen.', 'Alles löschen', true)) {
        if (st.live && st.live.recording) stopRecording();
        await Sessions.clear(); st.session = null; m.close(); location.hash = '#/'; route(); toast('Gelöscht');
      }
    };
  }

  function editSubject(sub) {
    const isNew = !sub;
    sub = sub || { id: uid('f'), name: '', emoji: '📘', color: '#6366F1', kind: 'text', speechLang: 'de-AT', notesLang: 'Deutsch', hints: '' };
    const langs = [['de-AT', 'Deutsch (Österreich)'], ['de-DE', 'Deutsch (Deutschland)'], ['de-CH', 'Deutsch (Schweiz)'], ['en-GB', 'Englisch (UK)'], ['en-US', 'Englisch (US)'], ['fr-FR', 'Französisch'], ['it-IT', 'Italienisch'], ['es-ES', 'Spanisch']];
    const kinds = [['math', 'Mathe / Naturwissenschaft (Formeln)'], ['code', 'Informatik / Technik (Code)'], ['lang', 'Sprache (Vokabeln, Grammatik)'], ['text', 'Text / Gesellschaft']];
    modal({
      title: isNew ? 'Neues Fach' : `Fach bearbeiten`,
      body: `<div class="settings">
        <div class="grid-sub">
          <label class="field"><span>Emoji</span><input class="input emoji-input" id="fs-emoji" value="${esc(sub.emoji)}" maxlength="4"></label>
          <label class="field"><span>Name</span><input class="input" id="fs-name" value="${esc(sub.name)}" placeholder="z. B. Elektrotechnik"></label>
          <label class="field"><span>Farbe</span><input type="color" id="fs-color" value="${esc(sub.color)}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Art des Fachs</span><select class="input" id="fs-kind">${kinds.map(([k, l]) => `<option value="${k}" ${sub.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Gesprochene Sprache</span><select class="input" id="fs-lang">${langs.map(([k, l]) => `<option value="${k}" ${sub.speechLang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Sprache der Mitschrift</span><input class="input" id="fs-notes" value="${esc(sub.notesLang || 'Deutsch')}"></label>
        <label class="field"><span>Extra-Wünsche für Claude (optional)</span><textarea class="input" id="fs-hints" rows="3" placeholder="z. B. „Lehrer heißt Prof. Huber, sagt oft ‚merken‘ bei wichtigen Sachen“ oder „Vokabeln immer mit Lautschrift“">${esc(sub.hints || '')}</textarea></label>
      </div>`,
      actions: [
        ...(isNew ? [] : [{ label: 'Löschen', danger: true, onClick: async () => { if (await confirmBox('Fach löschen?', 'Die Mitschriften bleiben erhalten.', 'Löschen', true)) { Subjects.remove(sub.id); route(); } } }]),
        { label: 'Abbrechen' },
        {
          label: 'Speichern', primary: true, onClick: (el) => {
            const name = $('#fs-name', el).value.trim();
            if (!name) { toast('Name fehlt'); return false; }
            Subjects.upsert(Object.assign({}, sub, {
              name, emoji: $('#fs-emoji', el).value.trim() || '📘', color: $('#fs-color', el).value,
              kind: $('#fs-kind', el).value, speechLang: $('#fs-lang', el).value, notesLang: $('#fs-notes', el).value.trim() || 'Deutsch',
              hints: $('#fs-hints', el).value.trim(),
            }));
            route();
          },
        },
      ],
    });
  }

  // ============ Onboarding & Demo ============
  function onboarding() {
    if (localStorage.getItem('autodoku.onboarded')) return;
    const m = modal({
      title: 'Willkommen bei AutoDoku 👋', wide: true, className: 'onboard',
      body: `<div class="ob">
        <ol class="ob-steps">
          <li><b>Fach antippen</b><span>AutoDoku hört über das Mikrofon mit und schreibt live ein Transkript.</span></li>
          <li><b>Claude fasst zusammen</b><span>Alle 1–2 Minuten wird daraus eine saubere Mitschrift: Stichpunkte, Merke-Boxen, Formeln, Hausübungen.</span></li>
          <li><b>Tafel fotografieren</b><span>📷 – Formeln und Skizzen landen automatisch im Dokument.</span></li>
          <li><b>✨ Fertig → ⬇ Word</b><span>Polierte Mitschrift mit echten Word-Formeln, Bildern und Quiz-Fragen.</span></li>
        </ol>
        <label class="field"><span>Claude-API-Schlüssel (für die Zusammenfassungen)</span>
          <input class="input" type="password" id="ob-key" placeholder="sk-ant-…" autocomplete="off">
          <small>Erstellen auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Ohne Schlüssel gibt's nur das Live-Transkript.</small>
        </label>
        <p class="fineprint">💬 Kurz fair bleiben: Frag deine Lehrkraft, ob Mitschreiben per App ok ist. AutoDoku speichert kein Audio, nur Text – und alles bleibt auf deinem Gerät.</p>
      </div>`,
      actions: [
        { label: '🎓 Erst Demo ansehen', onClick: (el) => { const k = $('#ob-key', el).value.trim(); if (k) Settings.set({ apiKey: k }); createDemo(); } },
        { label: 'Los geht\'s', primary: true, onClick: (el) => { const k = $('#ob-key', el).value.trim(); if (k) Settings.set({ apiKey: k }); } },
      ],
      onClose: () => localStorage.setItem('autodoku.onboarded', '1'),
    });
    return m;
  }

  async function createDemo() {
    const s = newSession('mathe');
    s.title = 'Quadratische Gleichungen & große Lösungsformel';
    s.durationMs = 47 * 60000;
    s.status = 'final';
    s.createdAt = Date.now() - 2 * 3600e3;
    s.segments = [
      { t: 12000, text: 'so heute machen wir mit den quadratischen gleichungen weiter allgemeine form a x quadrat plus b x plus c gleich null', kind: 'speech' },
      { t: 64000, text: 'wichtig a darf nicht null sein sonst ist es ja linear', kind: 'speech' },
      { t: 140000, text: 'die große lösungsformel x eins zwei gleich minus b plus minus wurzel aus b quadrat minus vier a c durch zwei a', kind: 'speech' },
      { t: 260000, text: 'den ausdruck unter der wurzel nennt man diskriminante', kind: 'speech' },
      { t: 2520000, text: 'hausübung buch seite vierundachtzig nummer drei a bis f bis montag', kind: 'speech' },
    ];
    s.cursor = s.segments.length;
    s.finalNotes = DEMO_NOTES;
    s.tasks = [
      { id: uid('t'), type: 'hausuebung', text: 'Buch S. 84, Nr. 3a–f (Diskriminante zuerst berechnen)', due: 'Mo', done: false },
      { id: uid('t'), type: 'test', text: 'Schularbeit: quadratische Gleichungen', due: 'in 2 Wochen', done: false },
    ];
    // Demo-Tafelbild zeichnen
    const c = document.createElement('canvas'); c.width = 1000; c.height = 560;
    const g = c.getContext('2d');
    g.fillStyle = '#1F3A2E'; g.fillRect(0, 0, 1000, 560);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.moveTo(80, 440); g.lineTo(940, 440); g.moveTo(300, 520); g.lineTo(300, 40); g.stroke();
    g.beginPath();
    for (let x = -0.6; x <= 4.6; x += 0.02) { const y = x * x - 4 * x + 3; const px = 300 + x * 120, py = 440 - y * 70; if (x <= -0.59) g.moveTo(px, py); else g.lineTo(px, py); }
    g.strokeStyle = '#F7E27B'; g.lineWidth = 4; g.stroke();
    g.font = '32px Georgia, serif'; g.fillText('f(x) = x² − 4x + 3', 560, 110);
    g.fillText('x₁ = 1   x₂ = 3', 560, 160);
    g.fillStyle = '#F7E27B'; [[1, 0], [3, 0]].forEach(([x]) => { g.beginPath(); g.arc(300 + x * 120, 440, 9, 0, 7); g.fill(); });
    const id = 'imgdemo1';
    s.images[id] = { dataUrl: c.toDataURL('image/jpeg', 0.9), w: 1000, h: 560, caption: 'Tafelbild: Parabel mit Nullstellen', credit: 'Foto: Tafel', kind: 'board' };
    s.finalNotes = s.finalNotes.replace('{{IMG}}', id);
    await saveNow(s);
    localStorage.setItem('autodoku.onboarded', '1');
    location.hash = `#/stunde/${s.id}`;
    toast('🎓 Demo geladen – probier ⬇ Word!', 'ok', 5000);
  }

  const DEMO_NOTES = `> [!ZUSAMMENFASSUNG]
> - Quadratische Gleichungen haben die Form $ax^2 + bx + c = 0$ mit $a \\neq 0$
> - Lösen mit der **großen Lösungsformel**
> - Die **Diskriminante** $D = b^2 - 4ac$ bestimmt die Anzahl der Lösungen
> - Hausübung: Buch S. 84, Nr. 3a–f

## Allgemeine Form
Eine **quadratische Gleichung** hat die Form
$$ax^2 + bx + c = 0, \\quad a, b, c \\in \\mathbb{R},\\ a \\neq 0$$

> [!ACHTUNG]
> Ist $a = 0$, ist die Gleichung **linear** – dann gilt die Lösungsformel nicht.

## Die große Lösungsformel
> [!FORMEL] Große Lösungsformel
> $$x_{1,2} = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

> [!DEFINITION] Diskriminante
> Der Ausdruck unter der Wurzel heißt **Diskriminante**: $D = b^2 - 4ac$

| Diskriminante | Lösungen | Bedeutung für die Parabel |
|---|:---:|---|
| $D > 0$ | 2 | schneidet die $x$-Achse zweimal |
| $D = 0$ | 1 | berührt die $x$-Achse (Scheitel) |
| $D < 0$ | 0 | keine reelle Lösung |

## Beispiel
> [!BEISPIEL] $x^2 - 4x + 3 = 0$
> 1. Koeffizienten ablesen: $a = 1$, $b = -4$, $c = 3$
> 2. Diskriminante: $D = (-4)^2 - 4 \\cdot 1 \\cdot 3 = 4$
> 3. Einsetzen: $x_{1,2} = \\frac{4 \\pm \\sqrt{4}}{2} = \\frac{4 \\pm 2}{2}$
> 4. Lösungen: ==$x_1 = 3$, $x_2 = 1$==

![Tafelbild: Parabel mit Nullstellen](img:{{IMG}})

> [!PRUEFUNG]
> Die Lösungsformel und die Fallunterscheidung mit $D$ kommen sicher zur Schularbeit.

## Teste dich selbst
1. Wie viele Lösungen hat $x^2 + 2x + 5 = 0$?
2. Löse $2x^2 - 8 = 0$ ohne Lösungsformel.
3. Was passiert mit der Parabel, wenn $D = 0$ ist?

> [!TIPP] Lösungen
> 1. $D = 4 - 20 = -16 < 0$ → keine reelle Lösung
> 2. $x^2 = 4 \\Rightarrow x_{1,2} = \\pm 2$
> 3. Der Scheitel liegt genau auf der $x$-Achse.`;

  // ============ Start ============
  $('#btn-settings').onclick = openSettings;
  window.addEventListener('hashchange', route);
  route();
  setTimeout(onboarding, 400);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // für Tests
  window.AutoDoku = { st, createDemo, liveUpdate, finalize, applyLive, splitSections, parseTasks, exportWord };
})();
