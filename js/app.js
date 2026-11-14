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

  // Speichern verzögert – je Stunde ein eigener Timer (sonst verschluckt z. B. die Handy-Aufnahme
  // das Speichern der Laptop-Stunde oder umgekehrt)
  const saveTimers = {};
  function save(s) {
    s = s || st.session;
    if (!s) return;
    clearTimeout(saveTimers[s.id]);
    saveTimers[s.id] = setTimeout(() => { delete saveTimers[s.id]; Sessions.put(s).catch(e => toast('Speichern fehlgeschlagen: ' + esc(e.message), 'err')); }, 400);
    scheduleVaultSync(s);
  }
  function saveNow(s) { s = s || st.session; clearTimeout(saveTimers[s.id]); delete saveTimers[s.id]; scheduleVaultSync(s, true); return Sessions.put(s); }

  // ============ Notizordner: jede Stunde automatisch als .md (wie Obsidian) ============
  const vaultOn = () => !!(window.Vault && Vault.available && Vault.V.root && Settings.get().vaultSync);
  const syncTimers = {}, lastSync = {};
  function scheduleVaultSync(s, now) {
    if (!s || !vaultOn()) return;
    clearTimeout(syncTimers[s.id]);
    syncTimers[s.id] = setTimeout(() => syncToVault(s).catch(e => console.warn('Notizordner', e)), now ? 50 : 4000);
  }
  const localDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  function dataUrlBytes(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  async function syncToVault(s) {
    if (!vaultOn()) return;
    const md = notesMd(s);
    if (!md.trim() && !(s.tasks || []).length) return;
    const set = Settings.get();
    const sub = Subjects.get(s.subjectId);
    const folder = Vault.safeName(sub.name.replace(/\s*\/\s*/g, ' & '));
    const date = localDate(s.createdAt);
    const name = `${date} ${Vault.safeName(s.title || (s.kind === 'study' ? 'Lernzettel' : 'Stunde'))}`;
    let target = Vault.join(folder, name + '.md');
    const API = window.vaultAPI;
    if (s.vaultPath && await API.exists(s.vaultPath)) {
      // vom Schüler im Notizordner bearbeitet? -> nicht überschreiben
      const stt = await API.stat(s.vaultPath);
      if (s.vaultMtime && stt.mtime > s.vaultMtime + 2000) {
        if (!s.vaultLocked) { s.vaultLocked = true; await Sessions.put(s); toast(`🗂️ Du hast <b>${esc(Vault.baseName(s.vaultPath))}</b> im Notizordner bearbeitet – AutoDoku überschreibt sie nicht mehr.`, 'warn', 7000); }
        return;
      }
      if (s.vaultPath !== target) {
        if (await API.exists(target)) target = s.vaultPath;
        else {
          await API.rename(s.vaultPath, target);
          if (s.vaultTranscript && await API.exists(s.vaultTranscript)) {
            const nt = Vault.join(folder, 'Transkripte', name + ' (Transkript).md');
            if (!(await API.exists(nt))) { await API.rename(s.vaultTranscript, nt); s.vaultTranscript = nt; }
          }
        }
      }
    } else if (s.vaultLocked) return;
    else if (await API.exists(target)) target = Vault.uniquePath(target);

    // Fotos nach "Anhänge"
    s.vaultImgs = s.vaultImgs || {};
    for (const [id, im] of Object.entries(s.images || {})) {
      if (!im.dataUrl || s.vaultImgs[id] || !md.includes('img:' + id)) continue;
      const file = `${date}_${slug(s.title || 'Stunde').slice(0, 30)}_${id.slice(-6)}.jpg`;
      await Vault.write(Vault.join(folder, 'Anhänge', file), dataUrlBytes(im.dataUrl));
      s.vaultImgs[id] = 'Anhänge/' + file;
    }
    let body = md
      .replace(/!\[([^\]]*)\]\(img:([^)\s]+)\)/g, (m0, alt, id) => s.vaultImgs[id] ? `![${alt}](${s.vaultImgs[id]})${s.images[id] && s.images[id].credit ? `\n*${s.images[id].credit}*` : ''}` : '')
      .replace(/^!\[[^\]]*\]\(search:[^)]*\)\s*$/gm, '');
    const tasks = (s.tasks || []).map(t => `- [${t.done ? 'x' : ' '}] ${t.text}${t.due ? ` (📅 ${t.due})` : ''}`).join('\n');
    const tags = ['autodoku', slug(sub.name).toLowerCase()].join(', ');
    const front = `---\nfach: ${sub.name}\ndatum: ${date}\n${s.durationMs >= 60000 ? `dauer: ${fmtDur(s.durationMs)}\n` : ''}status: ${s.status === 'final' ? 'fertig' : s.kind === 'study' ? 'lernzettel' : 'live'}\ntags: [${tags}]\n---\n`;
    if (set.vaultTranscript && s.segments.length) {
      const tp = s.vaultTranscript || Vault.join(folder, 'Transkripte', name + ' (Transkript).md');
      if (lastSync['t' + s.id] !== s.segments.length) {
        await Vault.write(tp, `---\nfach: ${sub.name}\ndatum: ${date}\ntags: [autodoku, transkript]\n---\n# Transkript: ${s.title || 'Stunde'}\n\nMitschrift: [[${name}]]\n\n` + s.segments.map(x => `**${mmss(x.t)}** ${x.kind === 'note' ? '✍️ ' : ''}${x.text}`).join('\n\n') + '\n');
        s.vaultTranscript = tp; lastSync['t' + s.id] = s.segments.length;
      }
      body += `\n\n---\n🎙️ Transkript: [[${Vault.stem(tp)}]]`;
    }
    const full = `${front}# ${s.title || 'Mitschrift'}\n\n${body.trim()}\n${tasks ? `\n## 📌 Aufgaben & Termine\n${tasks}\n` : ''}`;
    if (lastSync[s.id] === full && s.vaultPath === target) return;
    await Vault.write(target, full);
    const stt = await API.stat(target);
    s.vaultPath = target; s.vaultMtime = stt.mtime; lastSync[s.id] = full;
    await Sessions.put(s);
  }

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
    document.body.classList.toggle('in-notes', name === 'notes');
    $$('.nav-notes').forEach(a => a.classList.toggle('on', name === 'notes'));
    if (name === 'notes' && window.Vault && Vault.available) { setTopMid(livePill()); return Vault.show(safeDecode(h.slice(6))); }
    if (window.Vault && Vault.available && Vault.V.active) { Vault.V.active = null; Vault.renderSidebar(); }
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
  // Beim Klick (Nutzer-Aktion) schon mal Offline-Sprachpaket & Chrome-KI vorbereiten
  function warmUp(subjectId) {
    try {
      const lang = Subjects.get(subjectId).speechLang || 'de-AT';
      if (LiveTranscriber.hasLocal()) LiveTranscriber.localStatus(lang).then(st => { if (st.status === 'downloadable') LiveTranscriber.installLocal(lang).catch(() => {}); });
      if (AI.provider() === 'chrome' && AI.chrome.state === 'downloadable') AI.prepareChrome().catch(() => {});
    } catch (e) { /* egal */ }
  }

  async function startLesson(subjectId) {
    warmUp(subjectId);
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
      if (!AI.ready() && AI.why()) toast(esc(AI.why()), 'warn', 7000);
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
        rb.onclick = () => { if (st.live && st.live.recording) stopRecording(); else { warmUp(s.subjectId); startRecording(); } };
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
        ${!AI.ready() ? `<p class="warn-text">${esc(AI.why() || 'Keine KI eingerichtet')} → bis dahin läuft nur das Transkript. <button class="btn tiny" data-open-settings>Einstellungen</button></p>` : ''}
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
    if (!window.LiveTranscriber.supported() && !window.AudioContext) {
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
    if (AI.ready() && Settings.get().liveUpdates) liveUpdate(s, true);
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
      s.images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: 'Tafelbild', credit: '', kind: 'board', pending: AI.ready() && AI.supportsImages(), t: curRecMs(s) };
      if (s.status === 'new') s.status = 'paused';
      save(s); renderPhotos(s);
      if (!AI.ready() || !AI.supportsImages()) {
        insertSection(s, `## Tafelbild\n\n![Tafelbild](img:${id})`, false);
        continue;
      }
      toast('📷 Claude liest das Foto …');
      try {
        const r = await Claude.withRetry(() => AI.call({
          apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 3000, tag: s.id,
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
    const recBase = s.durationMs || 0;
    const handlers = {
      onFinal: (text, meta) => {
        // Zeitpunkt, an dem es GESAGT wurde (Abschnitte werden erst Sekunden später fertig erkannt)
        const t = meta && meta.at ? recBase + Math.max(0, meta.at - L.startedAt) : curRecMs(s);
        const x = { t, text, kind: 'speech' };
        s.segments.push(x);
        save(s);
        if (st.session === s) appendSeg(x);
      },
      onLevel: (rms, thr, speaking) => { L.level = Math.max(rms, (L.level || 0) * 0.8); L.thr = thr; if (speaking) L.lastSpeechAt = Date.now(); },
      onBacklog: (n) => { L.backlog = n; },
      onInterim: (text) => { L.interim = text; const el = $('#interim'); if (el && st.session === s) { el.textContent = text; if (text) scrollTranscript(true); } },
      onState: () => renderLiveInfo(),
      onError: (msg, fatal) => { toast(esc(msg), fatal ? 'err' : 'warn', fatal ? 9000 : 6000); if (fatal) stopRecording(); },
      onFallback: () => {
        // Google-Spracherkennung blockiert -> ab jetzt Whisper (lokal) bzw. Gemini-Audio
        try { localStorage.setItem('autodoku.webSpeechBroken', String(Date.now())); } catch (e) { /* egal */ }
        const eng = Settings.get().groqKey ? 'groq' : Settings.get().geminiKey ? 'gemini' : 'whisper';
        toast(eng === 'whisper' ? '🔒 Google-Spracherkennung blockiert (Schul-WLAN) → nehme Offline-Spracherkennung im Browser.' : eng === 'groq' ? '⚡ Google-Spracherkennung blockiert → nehme Whisper (Groq).' : '🔷 Google-Spracherkennung blockiert → nehme Gemini-Audio.', 'warn', 8000);
        if (L.recording) { L.transcriber = new ChunkTranscriber(handlers, eng); L.transcriber.start(speechLangFor(L.transcriber, sub), recOpts(sub, s)); }
      },
    };
    L.lastSpeechAt = Date.now();
    L.transcriber = makeTranscriber(handlers);
    L.transcriber.start(speechLangFor(L.transcriber, sub), recOpts(sub, s));
    s.status = 'live';
    save(s);
    L.tick = setInterval(() => tick(s), 1000);
    if (Settings.get().keepAwake) requestWakeLock();
    renderRecBtn(); renderLiveInfo(); renderNotes(s);
    setTopMid(recPill(s));
  }

  // Schul-WLAN blockiert Googles Spracherkennung -> Offline-Sprachpaket im Chrome laden
  function offerLocalSpeech(L, info) {
    const m = modal({
      title: '🔒 Offline-Spracherkennung',
      body: `<p>Die Google-Spracherkennung ist von hier nicht erreichbar – das Schul-WLAN blockiert sie oft, auch wenn das Internet sonst geht.</p>
        <p><b>Lösung:</b> Chrome kann ${esc(info.lang)} auch <b>direkt auf deinem Laptop</b> erkennen. Dafür einmal das Sprachpaket laden (ein paar MB), danach läuft's offline – und das Audio verlässt nie deinen Laptop.</p>
        <p class="muted small" id="ls-status"></p>`,
      actions: [
        { label: 'Abbrechen', onClick: () => { stopRecording(true); } },
        {
          label: '⬇ Sprachpaket laden', primary: true, onClick: (el) => {
            const stEl = $('#ls-status', el);
            stEl.textContent = 'Lade Sprachpaket … (kann 10–60 Sekunden dauern)';
            $$('.modal-actions .btn', el).forEach(b => { b.disabled = true; });
            LiveTranscriber.installLocal(info.lang).then(async (lang) => {
              let st2 = await LiveTranscriber.localStatus(info.lang);
              for (let i = 0; i < 40 && st2.status === 'downloading'; i++) { await new Promise(r => setTimeout(r, 1500)); st2 = await LiveTranscriber.localStatus(info.lang); }
              if ((lang || st2.status === 'available') && L.transcriber && L.recording) {
                const t = L.transcriber;
                t.want = true; t.local = true; t.localLang = lang || st2.lang; t.netErrors = 0;
                t._spawn();
                toast('🔒 Offline-Spracherkennung läuft!', 'ok');
                m.close();
              } else {
                stEl.textContent = 'Hat nicht geklappt. Alternative: Handy-Hotspot einschalten und neu starten.';
                $$('.modal-actions .btn', el).forEach(b => { b.disabled = false; });
              }
            });
            return false;
          },
        },
      ],
    });
  }

  // Mikrofon + Hinweise (Fach, Fachbegriffe, zuletzt Gesagtes) für die Abschnitts-Erkennung
  function recOpts(sub, s) {
    const set = Settings.get();
    const last = (s.segments || []).filter(x => x.kind === 'speech').slice(-3).map(x => x.text).join(' ').slice(-200);
    return { micId: set.micId || '', hint: { subject: sub.name, glossary: [sub.glossary, set.glossary].filter(Boolean).join(', '), context: last } };
  }

  // Whisper/Gemini erkennen die Sprache selbst (Deutsch mit englischen Fachbegriffen) – Google braucht eine feste Sprache
  function speechLangFor(t, sub) {
    const set = Settings.get();
    if (t instanceof ChunkTranscriber && set.speechLang === 'auto' &&!/^en/.test(sub.speechLang || '')) return 'auto';
    return sub.speechLang || 'de-AT';
  }

  function makeTranscriber(handlers) {
    const set = Settings.get();
    let eng = set.speechEngine || 'auto';
    if (eng === 'auto') {
      // Am genauesten und leicht für den Laptop: Whisper large-v3 bei Groq, sonst Gemini-Audio.
      // Nur ohne Schlüssel: Google (Browser) bzw. Offline-Whisper (schwer für schwache Laptops).
      const broken = +(localStorage.getItem('autodoku.webSpeechBroken') || 0);
      const desktop = /Electron/i.test(navigator.userAgent); // Desktop-App: Google-Spracherkennung gibt es dort nicht
      if (Whisper.localState.installed) eng = 'local';
      else if (set.groqKey) eng = 'groq';
      else if (set.geminiKey) eng = 'gemini';
      else eng = (desktop || !LiveTranscriber.supported() || Date.now() - broken < 6 * 3600e3) ? 'whisper' : 'google';
    }
    if (eng === 'local' && !Whisper.localState.installed) {
      toast('🖥️ Lokale Spracherkennung ist noch nicht eingerichtet – ⚙️ → Spracherkennung → „Einrichten“.', 'warn', 9000);
      eng = set.groqKey ? 'groq' : set.geminiKey ? 'gemini' : 'whisper';
    }
    if (eng === 'groq' && !set.groqKey) eng = set.geminiKey ? 'gemini' : 'whisper';
    if (eng === 'gemini' && !set.geminiKey) eng = set.groqKey ? 'groq' : 'whisper';
    if (eng === 'whisper' && !localStorage.getItem('autodoku.whisperWarned')) {
      try { localStorage.setItem('autodoku.whisperWarned', '1'); } catch (e) { /* egal */ }
      toast(Whisper.isDesktop() ? '💡 Die Browser-Erkennung ist schwer und ungenau. Besser: ⚙️ → Spracherkennung → „Lokal (whisper.cpp)“ einrichten.' : '💡 Die Offline-Erkennung braucht viel Leistung und ist ungenauer. Besser & leiser: gratis Groq-Schlüssel in ⚙️ → Spracherkennung.', 'warn', 10000);
    }
    return eng === 'google' ? new LiveTranscriber(handlers) : new ChunkTranscriber(handlers, eng);
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
    // Die letzten Sekunden werden evtl. noch erkannt -> danach den Rest einarbeiten
    const t = L.transcriber;
    L.flushing = t && t.whenIdle ? t.whenIdle(120000 + (t.backlog || 0) * 40000).then(() => { L.flushing = null; L.backlog = 0; renderLiveInfo(); }) : null;
    Promise.resolve(L.flushing).then(() => {
      if (!noFlush && s && s.cursor < s.segments.length && AI.ready() && Settings.get().liveUpdates && !st.finalizing && !st.preparing) liveUpdate(s, true);
    });
  }

  function tick(s) {
    const L = st.live; if (!L || !L.recording) return;
    renderLiveInfo();
    const pill = $('#rec-pill-time'); if (pill) pill.textContent = mmss(curRecMs(s));
    const set = Settings.get();
    if (!AI.ready() || !set.liveUpdates || L.busy || st.editing || st.preparing) return;
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
    if (st.finalizing || st.preparing) { el.innerHTML = `<span class="li-chip busy"><span class="spin"></span> ${esc(st.finalizeStage || 'poliert die Mitschrift …')}</span>`; return; }
    if (L && L.recording) {
      const pending = words(s.segments.slice(s.cursor).map(x => x.text).join(' '));
      const rest = Math.max(0, Math.round(set.interval - (Date.now() - L.lastUpdateAt) / 1000));
      const state = L.transcriber && L.transcriber.state === 'restarting' ? 'hört gleich wieder zu' : L.transcriber && L.transcriber.state === 'loading' ? 'nimmt auf, lädt Erkennung' : 'hört zu';
      el.innerHTML = `<span class="li-chip rec"><span class="dot rec"></span>${mmss(curRecMs(s))} · ${state}</span>` +
        levelChip(L) +
        (L.transcriber && L.transcriber.local ? '<span class="li-chip ok" title="Spracherkennung läuft offline auf deinem Laptop">🔒 offline</span>' : '') +
        (L.backlog > 2 ? `<span class="li-chip warn" title="So viele Abschnitte warten noch auf die Spracherkennung. Es geht nichts verloren, der Text kommt nur später.">⏳ ${L.backlog} in Arbeit</span>` : '') +
        (!AI.ready() ? `<span class="li-chip warn" title="${esc(AI.why())}">nur Transkript</span>`
          : L.busy ? '<span class="li-chip busy"><span class="spin"></span> schreibt mit …</span>'
            : !set.liveUpdates ? '<span class="li-chip" title="Sparstufe „Nur am Ende“">🪙 Zusammenfassung bei „Fertig“</span>'
              : `<span class="li-chip">${pending < set.minWords ? `${pending}/${set.minWords} Wörter` : `Update in ${rest}s`}</span>`) + costChip(s);
    } else if (L && L.flushing && L.sid === s.id) {
      el.innerHTML = '<span class="li-chip busy"><span class="spin"></span> erkennt die letzten Sekunden …</span>';
    } else if (L && L.busy) {
      el.innerHTML = '<span class="li-chip busy"><span class="spin"></span> schreibt mit …</span>';
    } else {
      el.innerHTML = (s.status === 'final' ? '<span class="li-chip ok">✓ fertig poliert</span>' : s.segments.length ? `<span class="li-chip">⏸ pausiert · ${fmtDur(s.durationMs)}</span>` : '<span class="li-chip">bereit</span>') + costChip(s);
    }
  }

  // Mikrofon-Pegel: zeigt, ob der Lehrer überhaupt ankommt
  function levelChip(L) {
    if (L.level == null) return '';
    const pct = Math.max(4, Math.min(100, Math.round(Math.sqrt(L.level / 0.12) * 100)));
    const silentFor = (Date.now() - (L.lastSpeechAt || Date.now())) / 1000;
    const warn = silentFor > 90;
    if (warn && !L.quietWarned) { L.quietWarned = true; toast('🎤 Seit über einer Minute kommt kaum etwas am Mikrofon an. Falls gerade gesprochen wird: Laptop näher zum Lehrer legen oder in ⚙️ ein anderes Mikrofon wählen.', 'warn', 9000); }
    return `<span class="li-chip level${warn ? ' warn' : ''}" title="${warn ? 'Sehr leise – kommt der Lehrer an?' : 'Mikrofon-Pegel'}"><span class="lvl"><i style="width:${pct}%"></i></span>${warn ? ' leise' : ''}</span>`;
  }

  function costChip(s) {
    if (!s.usage || !s.usage.input) return '';
    if (!s.usage.cost) return `<span class="li-chip ok" title="${fmtTok(s.usage.input + s.usage.output)} Tokens – kostenlos">🆓 gratis</span>`;
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
      if (t && t._spawn && !/^listening/.test(t.state || '')) { try { t._spawn(); } catch (e) { /* läuft schon */ } }
    }
  });
  window.addEventListener('beforeunload', (e) => { if (st.live && st.live.recording) { e.preventDefault(); e.returnValue = ''; } });

  // ============ Claude: Live-Update ============
  async function liveUpdate(s, force) {
    const set = Settings.get();
    const L = st.live || (st.live = { recording: false, busy: false, errors: 0, lastUpdateAt: Date.now() });
    if (L.busy || st.finalizing) return;
    if (st.editing) { if (force) toast('Erst Bearbeiten speichern'); return; }
    if (!AI.ready()) { if (force) { toast(esc(AI.why() || 'Keine KI eingerichtet.'), 'warn', 6000); openSettings(); } return; }
    if (s.cursor >= s.segments.length) { if (force) toast('Seit dem letzten Update wurde nichts Neues gesagt.'); return; }
    const sub = Subjects.get(s.subjectId);
    const system = Prompts.live(sub, set);
    // Nur so viel neues Transkript, wie die KI auf einmal verarbeiten kann – der Rest kommt im nächsten Durchgang.
    // (Früher wurde zu langer Text vorne abgeschnitten und war dann für die Live-Mitschrift verloren.)
    const pack = () => {
      const budget = AI.budget('live', system.length);
      let last = s.sections[s.sections.length - 1] || '';
      const outline = s.sections.map((m, i) => `${i + 1}. ${firstLine(m)}`).join('\n').slice(-Math.floor(budget * 0.15));
      // letzter Abschnitt zu groß fürs Modell -> nicht mitschicken, dann darf die KI nur anhängen
      const noLast = last.length > budget * 0.4;
      if (noLast) last = '(zu lang zum Mitschicken – NICHT ersetzen, neue Inhalte nur mit <append> anhängen)';
      const room = Math.max(800, budget - last.length - outline.length - 1500);
      let end = s.cursor, chars = 0;
      while (end < s.segments.length && (end === s.cursor || chars + s.segments[end].text.length + 30 <= room)) { chars += s.segments[end].text.length + 30; end++; }
      return { end, last, outline, noLast };
    };
    const { end: upto, last, outline, noLast } = pack();
    const pending = s.segments.slice(s.cursor, upto);
    const segment = pending.map(x => (x.kind === 'note' ? `[Notiz vom Schüler: ${x.text}]` : x.text)).join(' ');
    const context = s.segments.slice(Math.max(0, s.cursor - 30), s.cursor).map(x => x.text).join(' ').slice(-700);
    L.busy = true; renderLiveInfo();
    let more = false;
    try {
      const r = await Claude.withRetry(() => AI.call({
        apiKey: set.apiKey, model: set.modelLive, tier: 'live', maxTokens: 3500, temperature: 0.2, tag: s.id,
        system,
        messages: [{
          role: 'user', content: Prompts.liveUser({
            outline, last,
            tasks: (s.tasks || []).map(t => `${t.text}${t.due ? ' (' + t.due + ')' : ''}`).join('; '),
            context, segment, title: s.title,
          }),
        }],
      }));
      const ok = applyLive(s, r.text, { noLast });
      // Antwort ohne erkennbares Format bei viel neuem Stoff -> Text nicht als "erledigt" markieren
      if (!ok && words(segment) > 60 && !L.badReply) { L.badReply = true; throw new Error('Die KI hat unbrauchbar geantwortet – nächster Versuch gleich.'); }
      // zweimal unbrauchbar -> wenigstens den Wortlaut als Notiz behalten statt ihn zu verlieren
      if (!ok && words(segment) > 3) s.sections.push('## Notizen (nicht zusammengefasst)\n' + pending.map(x => '- ' + (x.kind === 'note' ? '**Notiz:** ' : '') + x.text).join('\n'));
      L.badReply = false;
      s.cursor = upto;
      L.errors = 0;
      more = upto < s.segments.length;
      save(s);
      if (st.session === s) { renderNotes(s); renderTasks(s); const t = $('#title'); if (t && document.activeElement !== t) t.value = s.title; }
    } catch (e) {
      L.errors = (L.errors || 0) + 1;
      if (!L.silent) toast('Update fehlgeschlagen: ' + esc(e.message), 'err', 6000);
      if (e.type === 'no_key' || e.status === 401) L.errors = 6;
      L.lastError = e;
    } finally {
      L.busy = false;
      L.lastUpdateAt = Date.now();
      renderLiveInfo();
    }
    // Rückstand (z. B. nach Verbindungsproblemen) gleich weiter abarbeiten
    if (more && force && !L.errors) return liveUpdate(s, true);
    return !L.errors;
  }

  // Alles Gesagte in die Live-Mitschrift einarbeiten (vor „Fertig“, auch bei Sparstufe „Nur am Ende“)
  async function catchUp(s, onStep) {
    const L = st.live || (st.live = { recording: false, busy: false, errors: 0, lastUpdateAt: Date.now() });
    for (let i = 0; i < 25 && L.busy; i++) await new Promise(r => setTimeout(r, 500));
    let fails = 0, guard = 0;
    while (s.cursor < s.segments.length && fails < 3 && guard++ < 400) {
      onStep && onStep(s.cursor, s.segments.length);
      for (let i = 0; i < 120 && L.busy; i++) await new Promise(r => setTimeout(r, 500));
      L.silent = true;
      const before = s.cursor;
      try { await liveUpdate(s, false); } finally { L.silent = false; }
      if (s.cursor === before) { fails++; await new Promise(r => setTimeout(r, 2500 * fails)); } else fails = 0;
    }
    L.errors = 0;
    return s.cursor >= s.segments.length;
  }

  function applyLive(s, text, opts) {
    const title = Claude.tag(text, 'title');
    if (title && !s.titleLocked && !/^\(|^leer$/i.test(title)) s.title = title.replace(/^#+\s*/, '').slice(0, 90);
    let rep = Claude.tag(text, 'replace_last');
    let app = Claude.tag(text, 'append');
    // KI kannte den letzten Abschnitt nicht -> "Ersetzen" wäre Verlust, also anhängen
    if (opts && opts.noLast && rep) { app = [rep, app].filter(Boolean).join('\n\n'); rep = ''; }
    // kleine lokale Modelle vergessen manchmal die Tags -> Markdown trotzdem übernehmen
    const tagged = /<(title|tasks|replace_last|append)>/.test(text);
    if (!rep && !app && !tagged && /^(##\s|[-*] |> )/m.test(text)) app = /^##\s/m.test(text) ? text.trim() : '## Notizen\n' + text.trim();
    let changed = false;
    if (rep && rep.length > 8 && !/^\(?leer\)?$/i.test(rep)) {
      const old = s.sections[s.sections.length - 1] || '';
      let neu = rep;
      const plain = (m) => m.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
      if (old && plain(neu).length < plain(old).length * 0.6 && plain(old).length > 300) {
        // KI hat statt der kompletten neuen Fassung nur das Neue geliefert -> Altes behalten, Neues anhängen
        const oldHead = firstLine(old).trim(), lines = neu.split('\n');
        if (lines[0].trim() === oldHead) lines.shift();
        neu = old.replace(/\s+$/, '') + '\n\n' + lines.join('\n').trim();
      }
      // Bilder aus dem alten Abschnitt nie verlieren
      const imgs = old.match(/!\[[^\]]*\]\(img:[^)]+\)/g) || [];
      imgs.forEach(ref => { if (!neu.includes(ref.replace(/^!\[[^\]]*\]/, ''))) neu += '\n\n' + ref; });
      if (s.sections.length) s.sections[s.sections.length - 1] = neu; else s.sections.push(neu);
      changed = true;
    }
    if (app && app.length > 8 && !/^\(?leer\)?$/i.test(app)) {
      const add = splitSections(app);
      // gleiche Überschrift wie der letzte Abschnitt -> anhängen statt doppelte Überschrift
      const lastHead = s.sections.length ? firstLine(s.sections[s.sections.length - 1]).trim() : null;
      if (add.length && lastHead && firstLine(add[0]).trim() === lastHead) {
        s.sections[s.sections.length - 1] += '\n\n' + add.shift().split('\n').slice(1).join('\n').trim();
      }
      s.sections.push(...add);
      changed = true;
    }
    const tasks = parseTasks(Claude.tag(text, 'tasks'));
    if (tasks.length) {
      const before = (s.tasks || []).length;
      mergeTasks(s, tasks);
      if (s.tasks.length > before) toast(`📌 Neu eingetragen: ${esc(s.tasks[s.tasks.length - 1].text)}`, 'ok', 5000);
    }
    // gültig = etwas übernommen ODER die KI hat bewusst im richtigen Format "nichts Neues" geantwortet
    return changed || tagged || tasks.length > 0;
  }

  // ============ Claude: Fertig & polieren ============
  // Zwei Wege:
  //  "voll"   – große KI (Claude, Gemini …): komplettes Transkript + Live-Mitschrift -> neu geordnete Mitschrift
  //  "sicher" – kleine/lokale KI (Ollama, Chrome-KI) oder zu langer Stoff: erst alles in die Live-Mitschrift
  //             einarbeiten, die Mitschrift BEHALTEN und nur Zusammenfassung, Begriffe und Testfragen ergänzen.
  //             So kann ein kleines Modell mit wenig Kontext nichts mehr "wegpolieren".
  const plainLen = (md) => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*_=`|-]/g, '').replace(/\s+/g, ' ').trim().length;

  function mergeSameHeadings(sections) {
    const out = [], byHead = new Map();
    for (const sec of sections) {
      const h = firstLine(sec).trim();
      if (/^##\s/.test(h) && byHead.has(h.toLowerCase())) {
        const i = byHead.get(h.toLowerCase());
        out[i] = out[i].replace(/\s+$/, '') + '\n\n' + sec.split('\n').slice(1).join('\n').trim();
      } else { if (/^##\s/.test(h)) byHead.set(h.toLowerCase(), out.length); out.push(sec); }
    }
    return out;
  }

  // schon einmal poliert (evtl. selbst bearbeitet): als Basis nehmen, aber alte Zusammenfassung/Begriffe/Testfragen
  // entfernen, sonst kommen sie doppelt
  function unpolish(s) {
    if (s.finalNotes == null) return;
    s.sections = splitSections(s.finalNotes.replace(/^> \[!ZUSAMMENFASSUNG\][^\n]*\n(> [^\n]*\n?)*/, ''))
      .filter(x => !/^##\s+(Begriffe|Teste dich selbst)\s*$/i.test(firstLine(x).trim()));
    s.finalNotes = null;
  }

  function setStage(txt) { st.finalizeStage = txt; renderLiveInfo(); }

  async function finalize(s) {
    const set = Settings.get();
    if (st.finalizing || st.preparing) return;
    if (!AI.ready()) { toast(esc(AI.why() || 'Keine KI eingerichtet.'), 'warn', 6000); openSettings(); return; }
    if (!s.segments.length && !Object.keys(s.images).length) { toast('Noch nichts aufgenommen.'); return; }
    if (st.editing) toggleEdit(s);
    if (st.live && st.live.recording && st.session === s) stopRecording(true);
    const sub = Subjects.get(s.subjectId);
    st.preparing = true;
    try {
      // 1) letzte Sekunden fertig erkennen lassen (sonst fehlt oft genau die Hausübung am Stundenende)
      if (st.live && st.live.flushing) { setStage('erkennt die letzten Sekunden …'); await st.live.flushing; }
      for (let i = 0; i < 60 && st.live && st.live.busy; i++) await new Promise(r => setTimeout(r, 500));
      // 2) Weg wählen
      const transcriptLen = s.segments.reduce((n, x) => n + x.text.length + 12, 0);
      const fullFits = transcriptLen < 180000 && transcriptLen + plainLen(notesMd(s)) * 1.3 + 2000 < AI.budget('final', 9000);
      let mode = !AI.smallModel() && fullFits ? 'voll' : 'sicher';
      if (mode === 'sicher') unpolish(s);
      if (mode === 'sicher' && s.cursor < s.segments.length) {
        setStage('arbeitet das Gesagte in die Mitschrift ein …');
        await catchUp(s, (a, b) => setStage(`arbeitet das Gesagte ein … ${Math.round(a / Math.max(1, b) * 100)} %`));
        if (st.session === s) renderNotes(s);
      }
      st.preparing = false;
      st.finalizing = true; setStage('');
      if (isMobile()) setMTab('notes');
      let res = null;
      if (mode === 'voll') {
        res = await finalizeFull(s, sub, set);
        if (res && res.fallback) {
          toast(esc(res.fallback) + ' Ich behalte deshalb die Live-Mitschrift und ergänze nur Zusammenfassung & Testfragen.', 'warn', 9000);
          mode = 'sicher';
          unpolish(s);
          st.finalizing = false; st.preparing = true;
          setStage('arbeitet das Gesagte in die Mitschrift ein …');
          await catchUp(s);
          st.preparing = false; st.finalizing = true;
          res = null;
        }
      }
      if (mode === 'sicher') res = await finalizeSafe(s, sub, set);
      if (!res) return;
      const title = res.title;
      if (title && !s.titleLocked && !/^\(|^leer$/i.test(title)) s.title = title.replace(/^#+\s*/, '').slice(0, 90);
      s.liveNotesBackup = notesMd(s);
      s.finalNotes = res.notes;
      mergeTasks(s, parseTasks(res.tasks));
      s.status = 'final';
      s.cursor = s.segments.length;
      await saveNow(s);
      // Fachbegriffe -> eigene Notizen im Ordner "Begriffe"
      if (res.terms && vaultOn() && set.termNotes) {
        try { await syncToVault(s); const n = await Rules.writeTerms(res.terms, { subject: sub.name, source: s.vaultPath }); if (n) toast(`📚 ${n} neue Begriff${n > 1 ? 'e' : ''} im Ordner „${esc(set.termFolder || 'Begriffe')}“`, 'ok', 5000); }
        catch (e) { console.warn('Begriffe', e); }
      }
      toast('✨ Fertig! Jetzt als Word exportieren.', 'ok');
    } catch (e) {
      toast('Polieren fehlgeschlagen: ' + esc(e.message) + ' – die Live-Mitschrift bleibt erhalten.', 'err', 8000);
    } finally {
      st.preparing = false; st.finalizing = false; st.finalizeStage = '';
      const paper = $('#paper'); if (paper) paper.classList.remove('streaming');
      if (st.session === s) { const t = $('#title'); if (t) t.value = s.title; renderNotes(s); renderTasks(s); renderLiveInfo(); }
    }
    if (s.status === 'final' && set.suggestImages) autoResolveSuggestions(s);
  }

  // Großes Modell: alles neu ordnen. Gibt {fallback: Grund} zurück, wenn das Ergebnis Inhalt verlieren würde.
  async function finalizeFull(s, sub, set) {
    const paper = $('#paper');
    const backup = notesMd(s);
    let lastRender = 0;
    const transcript = s.segments.map(x => `[${mmss(x.t)}] ${x.kind === 'note' ? '(Notiz vom Schüler) ' : ''}${x.text}`).join('\n');
    const images = Object.entries(s.images).filter(([, im]) => im.kind === 'board').map(([id, im]) => `img:${id} = ${im.caption}`).join('; ');
    if (paper) paper.classList.add('streaming');
    const r = await Claude.withRetry(() => AI.stream({
      apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 16000, temperature: 0.3, tag: s.id,
      system: Prompts.final(sub, Object.assign({}, set, { _terms: vaultOn() && set.termNotes })),
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
    let notes = Claude.tag(r.text, 'notes');
    if (!notes && /^(##|>)\s/m.test(r.text)) notes = r.text.replace(/<(title|tasks|terms)>[\s\S]*?(<\/\1>|$)/g, '').trim();
    if (!notes || notes.length < 40) return { fallback: 'Die KI-Antwort war unvollständig.' };
    if (r.stop === 'max_tokens') return { fallback: 'Die polierte Fassung wurde zu lang und wäre abgeschnitten worden.' };
    // Sicherheitsnetz: polierte Fassung deutlich kürzer als die Live-Mitschrift -> da fehlt Stoff
    const liveLen = plainLen(backup);
    if (liveLen > 1500 && plainLen(notes) < liveLen * 0.6) return { fallback: 'Die polierte Fassung war deutlich kürzer als die Live-Mitschrift.' };
    // Bilder der Stunde dürfen nie verloren gehen
    Object.entries(s.images).filter(([, im]) => im.kind === 'board').forEach(([id, im]) => {
      if (!notes.includes('img:' + id)) notes += `\n\n![${im.caption || 'Tafelbild'}](img:${id})`;
    });
    return { notes, title: Claude.tag(r.text, 'title'), tasks: Claude.tag(r.text, 'tasks'), terms: Claude.tag(r.text, 'terms') };
  }

  // Kleine KI: Live-Mitschrift bleibt der Kern, die KI ergänzt nur Zusammenfassung, Begriffe und Testfragen
  async function finalizeSafe(s, sub, set) {
    setStage('schreibt Zusammenfassung & Testfragen …');
    const sections = mergeSameHeadings((s.sections || []).filter(x => x.trim()));
    // was die KI nicht mehr einarbeiten konnte, kommt wörtlich dazu – lieber roh als weg
    const rest = s.segments.slice(s.cursor || 0);
    if (rest.length && sections.length) sections.push('## Noch nicht eingearbeitet\n' + rest.map(x => `- [${mmss(x.t)}] ${x.kind === 'note' ? '**Notiz:** ' : ''}${x.text}`).join('\n'));
    let body = sections.join('\n\n').trim();
    if (!body) {
      // nichts eingearbeitet (z. B. KI streikt) -> wenigstens das Transkript übernehmen
      body = '## Transkript\n' + s.segments.map(x => `- [${mmss(x.t)}] ${x.kind === 'note' ? '**Notiz:** ' : ''}${x.text}`).join('\n');
    }
    const system = Prompts.extras(sub, Object.assign({}, set, { _terms: vaultOn() && set.termNotes }));
    const room = AI.budget('final', system.length) - 800;
    let given = body;
    if (given.length > room) {
      // zu lang fürs kleine Modell: Gliederung + so viel Text wie passt (Inhalt bleibt ja trotzdem in der Mitschrift)
      const outline = sections.map(x => firstLine(x)).join('\n');
      given = 'GLIEDERUNG:\n' + outline + '\n\nAUSZUG:\n' + body.slice(0, Math.max(1000, room - outline.length - 200));
    }
    let r = null;
    try {
      r = await Claude.withRetry(() => AI.call({
        apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 2500, temperature: 0.3, tag: s.id,
        system,
        messages: [{ role: 'user', content: Prompts.extrasUser({ notes: given, title: s.title, tasks: (s.tasks || []).map(t => `${t.text}${t.due ? ' (' + t.due + ')' : ''}`).join('; ') }) }],
      }));
    } catch (e) {
      toast('Zusammenfassung & Testfragen gingen nicht (' + esc(e.message) + ') – die Mitschrift ist trotzdem fertig.', 'warn', 7000);
    }
    const txt = (r && r.text) || '';
    const bullets = (tag) => Claude.tag(txt, tag).split('\n').map(l => l.trim()).filter(Boolean);
    const summary = bullets('summary').map(l => '> ' + (/^[-*]\s/.test(l) ? l : '- ' + l.replace(/^\d+[.)]\s*/, '')));
    const glossary = bullets('glossary').filter(l => l.includes('|')).map(l => {
      const [a, ...b] = l.replace(/^[-*]\s*|^\||\|$/g, '').split('|');
      return `| ${a.trim()} | ${b.join(' ').trim()} |`;
    }).filter(l => !/^\|\s*(begriff|term)\s*\|/i.test(l) && !/^\|\s*-+/.test(l));
    const quiz = bullets('quiz').map((l, i) => `${i + 1}. ${l.replace(/^\d+[.)]\s*|^[-*]\s*/, '')}`);
    const sol = bullets('solutions').map((l, i) => `> ${i + 1}. ${l.replace(/^\d+[.)]\s*|^[-*]\s*/, '')}`);
    const parts = [];
    if (summary.length) parts.push('> [!ZUSAMMENFASSUNG]\n' + summary.join('\n'));
    parts.push(body);
    if (glossary.length >= 2 && !/^##\s+Begriffe/im.test(body)) parts.push('## Begriffe\n| Begriff | Bedeutung |\n|---|---|\n' + glossary.join('\n'));
    if (quiz.length) parts.push('## Teste dich selbst\n' + quiz.join('\n') + (sol.length ? '\n\n> [!TIPP] Lösungen\n' + sol.join('\n') : ''));
    Object.entries(s.images).filter(([, im]) => im.kind === 'board').forEach(([id, im]) => {
      if (!body.includes('img:' + id)) parts.push(`![${im.caption || 'Tafelbild'}](img:${id})`);
    });
    return { notes: parts.join('\n\n'), title: Claude.tag(txt, 'title'), tasks: Claude.tag(txt, 'tasks'), terms: Claude.tag(txt, 'terms') };
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
    if (!AI.ready()) { toast(esc(AI.why() || 'Keine KI eingerichtet.'), 'warn', 6000); openSettings(); return; }
    s.chat = s.chat || [];
    const msg = { role: 'assistant', text: label ? label + '\n\n…' : '…' };
    s.chat.push(msg);
    renderChat(s);
    const el = $('#chat');
    const node = el && el.lastElementChild;
    try {
      const history = s.chat.slice(0, -2).slice(-6).map(m => ({ role: m.role, content: m.text }));
      while (history.length && history[0].role !== 'user') history.shift();
      const r = await AI.stream({
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
    if (!AI.ready()) { toast(esc(AI.why() || 'Keine KI eingerichtet.'), 'warn', 6000); openSettings(); return; }
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
      const r = await Claude.withRetry(() => AI.stream({
        apiKey: set.apiKey, model: set.modelFinal, tier: 'final', maxTokens: 16000, tag: sheet.id,
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
    if (!AI.ready()) { toast(esc(AI.why() || 'Keine KI eingerichtet.'), 'warn', 6000); openSettings(); return; }
    const m = modal({ title: `🧠 Quiz · ${esc(sub.name)}`, body: '<div class="quiz"><div class="spinner"></div><p class="muted center">Claude baut deine Karteikarten …</p></div>', wide: true });
    try {
      const src = list.map(s => `### ${s.title}\n${notesMd(s)}`).join('\n\n').slice(0, 120000);
      const r = await AI.call({ apiKey: set.apiKey, model: set.modelLive, tier: 'live', maxTokens: 4000, system: Prompts.quiz(sub, set), messages: [{ role: 'user', content: `Erstelle 10 Karteikarten.\n\nMITSCHRIFTEN:\n${src}` }] });
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
      await deliver(blob, name, s);
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

  async function deliver(blob, name, s) {
    // Desktop mit Notizordner: Word-Datei neben die Notizen legen und öffnen
    if (vaultOn()) {
      const sub = s ? Subjects.get(s.subjectId) : null;
      const folder = s && s.vaultPath ? Vault.dirName(s.vaultPath) : sub ? Vault.safeName(sub.name.replace(/\s*\/\s*/g, ' & ')) : '';
      const p = Vault.uniquePath(Vault.join(folder, 'Word', name));
      await Vault.write(p, new Uint8Array(await blob.arrayBuffer()));
      window.vaultAPI.openExternal(p);
      toast(`📄 Gespeichert im Notizordner: <b>${esc(p)}</b> – Word öffnet sich`, 'ok', 6000);
      return;
    }
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
    if (window.AUTODOKU_INFO && window.AUTODOKU_INFO.desktop) toast(`📄 Gespeichert in <b>Dokumente › AutoDoku</b> – Word öffnet sich gleich`, 'ok', 6000);
    else toast(`📄 <b>${esc(name)}</b> heruntergeladen`, 'ok', 5000);
  }

  // ============ Einstellungen ============
  function openSettings() {
    const s = Settings.get();
    const subs = Subjects.all();
    const m = modal({
      title: '⚙️ Einstellungen', wide: true,
      body: `
      <div class="settings">
        <fieldset><legend>KI für die Zusammenfassungen</legend>
          <div class="modes prov">${[
            ['claude', '🟠 Claude (empfohlen)', 'Beste Mitschriften, liest Tafelfotos & Formeln sehr genau. Eigener API-Schlüssel – ein paar Cent pro Stunde. Läuft in der Cloud, dein Laptop bleibt leise.'],
            ['ollama', '🦙 Ollama (lokal, gratis)', 'KI läuft auf deinem PC: gratis, ohne Schlüssel, ohne Internet. AutoDoku installiert, startet und beendet Ollama selbst. Ab ca. 12 GB RAM empfohlen.'],
            ['auto', '⚡ Automatisch', 'Claude, wenn ein Schlüssel eingetragen ist – sonst Gemini (gratis), sonst Ollama, sonst Chrome-KI'],
            ['gemini', '🔷 Google Gemini', 'Gratis-Kontingent mit kostenlosem Schlüssel (Google-Konto, 1 Minute). Kann Tafelfotos lesen.'],
            ['openai', '🔌 Eigene API', 'OpenAI, Groq, Mistral, OpenRouter, DeepSeek … – eigener Schlüssel, eigenes Modell.'],
            ['chrome', '🖥️ Chrome-KI (lokal)', 'Nur in Google Chrome. Läuft auf dem Laptop – schwach und belastet den PC.'],
          ].map(([k, l, h]) => `<label class="mode ${(s.provider || 'auto') === k ? 'on' : ''}"><input type="radio" name="prov" value="${k}" ${(s.provider || 'auto') === k ? 'checked' : ''}><b>${l}</b><small>${h}</small></label>`).join('')}</div>
          <p class="spend" id="prov-status"></p>
          <div class="prov-box ollama-box" data-for="ollama">
            <p class="spend" id="ollama-status">… prüfe Ollama</p>
            <div class="row wrap">
              <button class="btn small" id="ollama-install" type="button" style="display:none">⬇ Ollama einrichten (≈ 40 MB)</button>
              <select class="input" id="set-omodel" style="max-width:300px"></select>
              <button class="btn small" id="ollama-pull" type="button">⬇ Modell laden</button>
              <a class="btn small ghost" href="https://ollama.com/download" target="_blank" rel="noopener" id="ollama-dl" style="display:none">Ollama herunterladen</a>
            </div>
            <div class="quiz-progress" id="ollama-bar" style="display:none;margin-top:8px"><span style="width:0%"></span></div>
            ${Setup.isDesktop() ? `<label class="check"><input type="checkbox" id="ollama-quit"> Ollama beim Beenden von AutoDoku schließen (gibt Arbeitsspeicher frei)</label>
            <button class="btn small ghost" id="ollama-noauto" type="button" style="display:none">Ollama-Autostart von Windows ausschalten</button>
            <small>Ollama startet erst, wenn AutoDoku die KI braucht, nutzt nur so viele Kerne wie unter „Leistung“ eingestellt und entlädt das Modell nach 10 Minuten Pause.</small>` : ''}
          </div>
          <div class="prov-box" data-for="chrome"><button class="btn small" id="chrome-load" type="button">🖥️ Chrome-KI laden / prüfen</button></div>
          <label class="field prov-box" data-for="gemini auto"><span>Gemini-Schlüssel (gratis)</span>
            <div class="row"><input class="input" type="password" id="set-gkey" value="${esc(s.geminiKey || '')}" placeholder="AIza…" autocomplete="off"><button class="btn small" id="set-gtest" type="button">Testen</button></div>
            <small>Gratis auf <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → „API-Schlüssel erstellen“ (Google-Konto, keine Kreditkarte). Hinweis: Im Gratis-Kontingent darf Google die Texte zur Verbesserung nutzen.</small>
          </label>
          <label class="field prov-box" data-for="claude auto"><span>Claude-API-Schlüssel</span>
            <div class="row"><input class="input" type="password" id="set-key" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"><button class="btn small" id="set-test" type="button">Testen</button></div>
            <small>Bekommst du auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> → „Create Key“ (braucht etwas Guthaben). Achtung: Das ist <b>nicht</b> dasselbe wie dein Claude-Pro-Abo. Der Schlüssel bleibt nur auf diesem Gerät.</small>
          </label>
          <div class="prov-box" data-for="openai">
            <div class="grid2">
              <label class="field"><span>Anbieter</span><select class="input" id="oa-preset">${Object.entries(AI.OA_PRESETS).map(([k, v]) => `<option value="${k}" ${(s.oaPreset || 'openai') === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
              <label class="field"><span>Adresse (Base-URL)</span><input class="input" id="oa-base" value="${esc(s.oaBase || '')}" placeholder="https://…/v1"></label>
            </div>
            <label class="field"><span>API-Schlüssel</span><input class="input" type="password" id="oa-key" value="${esc(s.oaKey || '')}" placeholder="sk-… (bei LM Studio leer lassen)" autocomplete="off"><small id="oa-keyhint"></small></label>
            <div class="grid2">
              <label class="field"><span>Modell</span><div class="row"><input class="input" id="oa-model" value="${esc(s.oaModel || '')}" list="oa-models" placeholder="z. B. gpt-5-mini"><button class="btn small" id="oa-load" type="button" title="Modelle vom Anbieter laden">↻</button></div></label>
              <label class="field"><span>Modell live (optional, billiger/schneller)</span><input class="input" id="oa-model-live" value="${esc(s.oaModelLive || '')}" list="oa-models" placeholder="leer = gleiches Modell"></label>
            </div>
            <datalist id="oa-models"></datalist>
            <label class="check"><input type="checkbox" id="oa-vision" ${s.oaVision !== false ? 'checked' : ''}> Modell kann Bilder lesen (Tafelfotos)</label>
            <button class="btn small" id="oa-test" type="button">Testen</button>
          </div>
        </fieldset>
        <fieldset><legend>📏 Regeln – wie AutoDoku hört und notiert</legend>
          <label class="field"><span>So soll notiert & zusammengefasst werden</span><textarea class="input" id="rule-notes" rows="3" placeholder="z. B. „Jede Definition als eigene Box“, „Beispiele immer vollständig durchrechnen“, „Code-Beispiele in Java“, „am Ende 5 Prüfungsfragen“">${esc(s.ruleNotes || '')}</textarea></label>
          <label class="field"><span>Beim Hören beachten</span><textarea class="input" id="rule-listen" rows="2" placeholder="z. B. „Prof. Huber sagt ‚Strich‘ für Ableitung“, „‚Stack‘ ist immer die Datenstruktur“">${esc(s.ruleListen || '')}</textarea></label>
          <label class="field"><span>Zusätzlich weglassen</span><input class="input" id="rule-ignore" value="${esc(s.ruleIgnore || '')}" placeholder="z. B. „Fußball-Gespräche“, „Wiederholungen der letzten Stunde“"></label>
          <label class="check"><input type="checkbox" id="rule-jokes" ${s.ignoreJokes !== false ? 'checked' : ''}> Witze, Abschweifungen, Ermahnungen & Organisatorisches weglassen (Eselsbrücken bleiben als Tipp)</label>
          <label class="check"><input type="checkbox" id="rule-terms" ${s.termNotes ? 'checked' : ''}> Fachbegriffe als eigene Notizen erklären – jede Notiz verlinkt sie mit [[Begriff]] (braucht den Notizordner)</label>
          <label class="field"><span>Ordner für die Begriffe</span><input class="input" id="rule-termfolder" value="${esc(s.termFolder || 'Begriffe')}" style="max-width:260px"></label>
          <p class="muted small">Pro Fach gibt's eigene Regeln & Fachbegriffe unter „Fächer“.</p>
        </fieldset>
        <fieldset class="prov-box" data-for="claude auto"><legend>Sparstufe (Claude)</legend>
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
          <label class="field"><span>Spracherkennung</span><select class="input" id="set-speech">${[
            ['auto', 'Automatisch (lokal wenn eingerichtet, sonst Groq, sonst Gemini)'],
            ...(Whisper.isDesktop() ? [['local', '🖥️ Lokal: Whisper large-v3-turbo (whisper.cpp) – genau, offline, schont den PC']] : []),
            ['groq', '⚡ Whisper large-v3 über Groq (Cloud, gratis Schlüssel, sehr genau)'],
            ['gemini', 'Gemini-Audio (gratis Schlüssel, genau, schont den Laptop)'],
            ['google', 'Google/Chrome live (nur im Chrome-Browser, braucht offenes Internet)'],
            ['whisper', 'Alte Browser-Erkennung (whisper base – langsam, laut, ungenau)'],
          ].map(([k, l]) => `<option value="${k}" ${(s.speechEngine || 'auto') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${Whisper.isDesktop() ? `<div class="field"><span>🖥️ Lokale Spracherkennung (whisper.cpp, large-v3-turbo)</span>
            <p class="spend" id="loc-status">… prüfe</p>
            <div class="row wrap">
              <select class="input" id="set-lpower" style="max-width:300px">${[['leise', 'Leise – 2 Kerne (Lüfter bleibt ruhig)'], ['normal', 'Ausgewogen – 4 Kerne (empfohlen)'], ['schnell', 'Schnell – 8 Kerne (lauter)']].map(([k, l]) => `<option value="${k}" ${(s.localPower || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <button class="btn small" id="loc-install" type="button" style="display:none">⬇ Einrichten (ca. 560 MB, einmalig)</button>
            </div>
            <div class="quiz-progress" id="loc-bar" style="display:none;margin-top:8px"><span style="width:0%"></span></div>
            <small>Läuft komplett auf deinem PC, ohne Internet. Startet erst beim Aufnehmen, nutzt nur wenige Kerne mit niedriger Priorität und beendet sich nach 10 Minuten Pause (gibt den Arbeitsspeicher frei). Die Leistungs-Stufe gilt auch für Ollama.</small>
          </div>` : ''}
          <label class="field"><span>Groq-Schlüssel für die Spracherkennung (gratis, optional)</span>
            <div class="row"><input class="input" type="password" id="set-groq" value="${esc(s.groqKey || '')}" placeholder="gsk_…" autocomplete="off"><button class="btn small" id="set-groqtest" type="button">Testen</button></div>
            <small>Gratis auf <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> (Google-Login, keine Kreditkarte). Reicht für ca. 8 Stunden Unterricht pro Tag. Claude selbst kann leider kein Audio hören – darum übernimmt das Whisper.</small>
          </label>
          <label class="field"><span>Mikrofon</span><select class="input" id="set-mic"><option value="">Standard-Mikrofon von Windows</option>${s.micId ? `<option value="${esc(s.micId)}" selected>${esc(s.micLabel || 'Gewähltes Mikrofon')}</option>` : ''}</select><small>Gilt für Groq-, Gemini- und Offline-Erkennung. Ein Headset- oder USB-Mikrofon nah beim Lehrer bringt am meisten.</small></label>
          <div class="grid2">
            <label class="field"><span>Sprache</span><select class="input" id="set-slang">
              <option value="fach" ${s.speechLang !== 'auto' ? 'selected' : ''}>Sprache des Fachs (empfohlen – Deutsch schreibt englische Fachbegriffe mit)</option>
              <option value="auto" ${s.speechLang === 'auto' ? 'selected' : ''}>Automatisch Deutsch/Englisch erkennen (experimentell)</option></select></label>
            <label class="field"><span>Offline-Erkennung (Whisper)</span><select class="input" id="set-wmodel">
              <option value="base" ${s.whisperModel !== 'small' ? 'selected' : ''}>Schnell (base, ~80 MB)</option>
              <option value="small" ${s.whisperModel === 'small' ? 'selected' : ''}>Genauer bei Fachbegriffen (small, ~250 MB)</option></select></label>
          </div>
          <label class="field"><span>Eigene Fachbegriffe (für alle Fächer)</span><input class="input" id="set-gloss" value="${esc(s.glossary || '')}" placeholder="z. B. Prof. Huber, Spring Boot, Mathcad, Packet Tracer"><small>Die KI korrigiert falsch verstandene Wörter damit. Pro Fach: ⚙️ → Fächer.</small></label>
          <label class="check"><input type="checkbox" id="set-awake" ${s.keepAwake ? 'checked' : ''}> Bildschirm während der Aufnahme anlassen (am Handy wichtig – sonst stoppt die Erkennung)</label>
        </fieldset>
        ${window.vaultAPI ? `<fieldset><legend>🗂️ Notizordner (wie Obsidian)</legend>
          <p class="spend" id="vault-path">${Vault.V.root ? `📁 <b>${esc(Vault.V.root)}</b>` : 'Noch kein Ordner gewählt.'}</p>
          <div class="row wrap"><button class="btn small" id="set-vault" type="button">Ordner wählen …</button>${Vault.V.root ? '<a class="btn small ghost" href="#/notes" id="set-vault-open">Öffnen</a>' : ''}</div>
          <label class="check"><input type="checkbox" id="set-vsync" ${s.vaultSync ? 'checked' : ''}> Jede Stunde automatisch als Notiz (.md) speichern – Ordner pro Fach, Fotos in „Anhänge“</label>
          <label class="check"><input type="checkbox" id="set-vtrans" ${s.vaultTranscript ? 'checked' : ''}> Transkript zusätzlich in „Transkripte“ ablegen</label>
          <label class="check"><input type="checkbox" id="set-vconv" ${s.autoConvert ? 'checked' : ''}> Neue PDFs, Fotos, Videos & Word-Dateien automatisch in Notizen umwandeln</label>
        </fieldset>` : ''}
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
        ${window.desktopAPI ? `<fieldset><legend>🖥️ Mini-Fenster & Tastenkürzel</legend>
          <p class="muted small" id="sc-list">…</p>
          <div class="row wrap"><button class="btn small" id="set-mini" type="button">Mini-Fenster öffnen</button></div>
          <p class="muted small">Das Mini-Fenster bleibt über anderen Programmen. Während einer Aufnahme ist immer ein roter Punkt sichtbar (Mini-Fenster bzw. Symbol unten rechts).</p>
        </fieldset>
        <fieldset><legend>📱 Handy als Tafel-Kamera & Mikrofon</legend>
          <p class="muted small">Handy-Browser öffnen, QR-Code scannen – keine App nötig. Handy und Laptop müssen im selben WLAN sein (im Schul-WLAN klappt das oft nicht → Handy-Hotspot einschalten und den Laptop damit verbinden).</p>
          <button class="btn small primary" id="set-phone" type="button">📱 Handy verbinden</button>
        </fieldset>` : ''}
        <fieldset><legend>🤝 Profil teilen (für Kollegen)</legend>
          <p class="muted small">Exportiert Fächer, Fachbegriffe, Regeln und KI-Einstellungen. Kollegen importieren die Datei und tragen nur ihren eigenen Schlüssel ein.</p>
          <label class="check"><input type="checkbox" id="prof-keys"> Meine Schlüssel mit exportieren (nur für eigene Geräte!)</label>
          <div class="row wrap"><button class="btn small" id="prof-export" type="button">⬇ Profil exportieren</button><button class="btn small" id="prof-import" type="button">⬆ Profil importieren</button></div>
        </fieldset>
        ${Setup.isDesktop() ? `<fieldset><legend>ℹ️ Über AutoDoku</legend>
          <p class="spend" id="upd-status">Version ${esc((window.AUTODOKU_INFO || {}).version || '')}</p>
          <div class="row wrap"><button class="btn small" id="upd-check" type="button">Nach Updates suchen</button><button class="btn small primary" id="upd-install" type="button" style="display:none">⬆ Jetzt aktualisieren</button><button class="btn small" id="setup-open" type="button">🧰 Einrichtung prüfen</button></div>
          <div class="quiz-progress" id="upd-bar" style="display:none;margin-top:8px"><span style="width:0%"></span></div>
          <small>Notizen und Einstellungen bleiben bei Updates erhalten.</small>
        </fieldset>` : ''}
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
            provider: (el.querySelector('input[name=prov]:checked') || {}).value || 'auto',
            groqKey: ($('#set-groq', el) || {}).value.trim(),
            localPower: ($('#set-lpower', el) || {}).value || 'normal',
            ...($('#set-omodel', el) && $('#set-omodel', el).value ? { ollamaModel: $('#set-omodel', el).value } : {}),
            geminiKey: $('#set-gkey', el).value.trim(),
            mode: (el.querySelector('input[name=mode]:checked') || {}).value || 'custom',
            liveUpdates: $('#set-liveupd', el).checked,
            modelLive: $('#set-mlive', el).value.trim() || 'claude-haiku-5-5',
            modelFinal: $('#set-mfinal', el).value.trim() || 'claude-haiku-5-5',
            interval: +$('#set-interval', el).value, minWords: +$('#set-minwords', el).value,
            keepAwake: $('#set-awake', el).checked,
            micId: ($('#set-mic', el) || {}).value || '', micLabel: (($('#set-mic', el) || {}).selectedOptions || [{}])[0].textContent || '',
            speechEngine: $('#set-speech', el).value, studentName: $('#set-name', el).value.trim(), className: $('#set-class', el).value.trim(),
            suggestImages: $('#set-images', el).checked, appendTranscript: $('#set-transcript', el).checked,
            speechLang: $('#set-slang', el).value, whisperModel: $('#set-wmodel', el).value, glossary: $('#set-gloss', el).value.trim(),
            oaPreset: $('#oa-preset', el).value, oaBase: $('#oa-base', el).value.trim(), oaKey: $('#oa-key', el).value.trim(),
            oaModel: $('#oa-model', el).value.trim(), oaModelLive: $('#oa-model-live', el).value.trim(), oaVision: $('#oa-vision', el).checked,
            ruleNotes: $('#rule-notes', el).value.trim(), ruleListen: $('#rule-listen', el).value.trim(), ruleIgnore: $('#rule-ignore', el).value.trim(),
            ignoreJokes: $('#rule-jokes', el).checked, termNotes: $('#rule-terms', el).checked, termFolder: $('#rule-termfolder', el).value.trim() || 'Begriffe',
            ...(window.vaultAPI ? { vaultSync: $('#set-vsync', el).checked, vaultTranscript: $('#set-vtrans', el).checked, autoConvert: $('#set-vconv', el).checked } : {}),
          });
          toast('Gespeichert ✓');
          if (st.session) renderAll(st.session);
        },
      }],
    });
    const el = m.el;
    // KI-Anbieter
    const provNow = () => (el.querySelector('input[name=prov]:checked') || {}).value || 'auto';
    const renderProv = () => {
      const p = provNow();
      $$('.prov .mode', el).forEach(x => x.classList.toggle('on', x.querySelector('input').value === p));
      $$('.prov-box', el).forEach(b => { b.style.display = b.dataset.for.split(' ').includes(p) ? '' : 'none'; });
      const cs = AI.chrome.state;
      const ctext = { available: '✅ Chrome-KI ist bereit (lokal, gratis).', downloadable: '⬇ Chrome-KI kann geladen werden – Button drücken (einmalig, braucht WLAN).', downloading: `⏳ Chrome-KI lädt … ${Math.round((AI.chrome.progress || 0) * 100)} %`, unavailable: '❌ Dein Laptop/Chrome kann die lokale KI nicht – nimm Gemini (gratis).', unsupported: '❌ Dieser Browser hat keine eingebaute KI (aktuelles Google Chrome am PC nötig) – nimm Gemini (gratis).', checking: '… prüfe Chrome-KI' }[cs] || cs;
      $('#prov-status', el).textContent = p === 'chrome' ? ctext : '';
    };
    // Ollama
    const renderOllama = () => {
      const o = AI.ollama, ost = $('#ollama-status', el); if (!ost) return;
      const rec = AI.recommendedModel();
      const c = o.ctl || {};
      if (o.pulling) ost.textContent = `⏳ Lade ${o.pulling.model} … ${Math.round((o.pulling.progress || 0) * 100)} %`;
      else if (c.install && c.install.state === 'running') ost.textContent = `⏳ Richte Ollama ein … ${Math.round((c.install.progress || 0) * 100)} %`;
      else if (o.state === 'running') ost.innerHTML = o.models.length ? `✅ Ollama läuft · Modell: <b>${esc(AI.ollamaModel())}</b>${c.loaded && c.loaded.length ? ' (im Speicher)' : ''}` : `✅ Ollama läuft – lade jetzt ein Modell (empfohlen für deinen PC: <b>${esc(rec)}</b>).`;
      else if (o.state === 'stopped') ost.innerHTML = o.models.length ? `💤 Ollama ist installiert und startet automatisch, wenn die KI gebraucht wird · Modell: <b>${esc(AI.ollamaModel())}</b>` : '💤 Ollama ist installiert – lade ein Modell.';
      else if (o.state === 'missing') ost.innerHTML = '⬇ Ollama ist noch nicht installiert. Ein Klick – AutoDoku lädt nur das Nötige (≈ 40 MB) und richtet es ohne Autostart ein.';
      else if (o.state === 'checking') ost.textContent = '… suche Ollama';
      else ost.innerHTML = '❌ Ollama nicht gefunden. In der Desktop-App installiert AutoDoku es selbst, im Browser: ollama.com.';
      const sel = $('#set-omodel', el);
      const cur = sel.value || Settings.get().ollamaModel || AI.ollamaModel();
      const opts = [...new Set([...o.models, rec, 'qwen3:4b', 'qwen3:1.7b', 'gemma3:4b', 'qwen3:8b'])];
      sel.innerHTML = opts.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}${o.models.includes(m) ? ' ✓' : m === rec ? ' (empfohlen)' : ''}${/gemma3/.test(m) ? ' – liest Tafelfotos' : ''}</option>`).join('');
      const usable = o.state === 'running' || o.state === 'stopped';
      $('#ollama-pull', el).style.display = usable && !o.models.includes(sel.value) ? '' : 'none';
      sel.style.display = usable ? '' : 'none';
      $('#ollama-install', el).style.display = o.state === 'missing' ? '' : 'none';
      $('#ollama-dl', el).style.display = o.state === 'offline' ? '' : 'none';
      const na = $('#ollama-noauto', el); if (na) na.style.display = c.autostart ? '' : 'none';
    };
    if ($('#ollama-status', el)) {
      AI.checkOllama().then(renderOllama);
      $('#set-omodel', el).onchange = renderOllama;
      $('#ollama-pull', el).onclick = async () => {
        const m = $('#set-omodel', el).value;
        const b = $('#ollama-pull', el); b.disabled = true;
        const bar = $('#ollama-bar', el); bar.style.display = '';
        try {
          await AI.pullOllama(m, (pr) => { bar.firstElementChild.style.width = Math.round((pr.progress || 0) * 100) + '%'; renderOllama(); });
          Settings.set({ ollamaModel: m });
          toast(`✅ Modell ${esc(m)} bereit`, 'ok');
        } catch (e) { toast('Modell laden: ' + esc(e.message), 'err', 8000); }
        b.disabled = false; bar.style.display = 'none'; renderOllama();
      };
      $('#ollama-install', el).onclick = async () => {
        const b = $('#ollama-install', el); b.disabled = true;
        const bar = $('#ollama-bar', el); bar.style.display = '';
        try {
          await fetch('/ollamactl/install', { method: 'POST' });
          for (;;) {
            await new Promise(r => setTimeout(r, 800));
            await AI.checkOllama(); renderOllama();
            const ins = (AI.ollama.ctl || {}).install || {};
            bar.firstElementChild.style.width = Math.round((ins.progress || 0) * 100) + '%';
            if (ins.state === 'done') break;
            if (ins.state === 'error') throw new Error(ins.error);
          }
          toast('✅ Ollama eingerichtet – jetzt noch ein Modell laden', 'ok');
        } catch (e) { toast('Ollama einrichten: ' + esc(e.message), 'err', 9000); }
        b.disabled = false; bar.style.display = 'none'; renderOllama();
      };
      const oq = $('#ollama-quit', el);
      if (oq) {
        fetch('/sys/ollama-quit').then(r => r.json()).then(j => { oq.checked = j.on; }).catch(() => {});
        oq.onchange = () => fetch('/sys/ollama-quit?on=' + (oq.checked ? '1' : '0'));
        $('#ollama-noauto', el).onclick = async () => { await fetch('/ollamactl/autostart?off=1', { method: 'POST' }); toast('Ollama startet nicht mehr mit Windows – AutoDoku startet es bei Bedarf.', 'ok'); await AI.checkOllama(); renderOllama(); };
      }
    }
    // Updates
    if ($('#upd-check', el)) {
      const us = $('#upd-status', el);
      const showUpd = (u) => {
        if (!u) { us.textContent = `Version ${(window.AUTODOKU_INFO || {}).version || ''} · Update-Prüfung gerade nicht möglich (Internet?)`; return; }
        us.innerHTML = u.newer ? `⬆ Neue Version <b>${esc(u.latest)}</b> verfügbar (du hast ${esc(u.current)}).` : `✅ Version ${esc(u.current)} – du bist aktuell.`;
        $('#upd-install', el).style.display = u.newer ? '' : 'none';
      };
      Setup.checkUpdate(false).then(showUpd);
      $('#upd-check', el).onclick = async () => { us.textContent = '… prüfe'; showUpd(await Setup.checkUpdate(true)); };
      $('#upd-install', el).onclick = async () => {
        const bar = $('#upd-bar', el); bar.style.display = '';
        try {
          await Setup.installUpdate((st) => { bar.firstElementChild.style.width = Math.round((st.progress || 0) * 100) + '%'; us.textContent = st.state === 'starting' ? 'Starte Installation – AutoDoku startet gleich neu …' : `⏳ Lade Update … ${Math.round((st.progress || 0) * 100)} %`; });
        } catch (e) { toast('Update: ' + esc(e.message), 'err', 8000); bar.style.display = 'none'; }
      };
      $('#setup-open', el).onclick = () => { m.close && m.close(); openSetup(); };
    }
    // Lokale Spracherkennung (whisper.cpp)
    const renderLocal = () => {
      const ls = $('#loc-status', el); if (!ls) return;
      const L0 = Whisper.localState;
      const ins = L0.install || {};
      if (ins.state === 'running') ls.textContent = `⏳ Lade herunter … ${Math.round((ins.progress || 0) * 100)} %`;
      else if (L0.installed) ls.innerHTML = `✅ Eingerichtet: <b>${esc(L0.model.replace(/^ggml-|\.bin$/g, ''))}</b> · ${L0.running ? 'läuft gerade' : 'startet beim Aufnehmen'}`;
      else ls.innerHTML = ins.state === 'error' ? `❌ Einrichten fehlgeschlagen: ${esc(ins.error || '')}` : 'Noch nicht eingerichtet.';
      $('#loc-install', el).style.display = L0.installed || ins.state === 'running' ? 'none' : '';
    };
    if ($('#loc-status', el)) {
      Whisper.checkLocal().then(renderLocal);
      $('#loc-install', el).onclick = async () => {
        const b = $('#loc-install', el); b.disabled = true;
        const bar = $('#loc-bar', el); bar.style.display = '';
        try {
          await Whisper.installLocal((ins) => { bar.firstElementChild.style.width = Math.round((ins.progress || 0) * 100) + '%'; renderLocal(); });
          toast('✅ Lokale Spracherkennung bereit', 'ok');
          $('#set-speech', el).value = 'auto';
        } catch (e) { toast('Einrichten: ' + esc(e.message), 'err', 9000); }
        b.disabled = false; bar.style.display = 'none'; renderLocal();
      };
    }
    // Groq-Schlüssel testen (kurzer stiller Ton reicht)
    $('#set-groqtest', el).onclick = async () => {
      const b = $('#set-groqtest', el); b.disabled = true; b.textContent = '…';
      const key = $('#set-groq', el).value.trim();
      const old = Settings.get().groqKey;
      try {
        Settings.set({ groqKey: key });
        const tone = new Float32Array(16000 * 2); for (let i = 0; i < tone.length; i++) tone[i] = Math.sin(i / 8) * 0.02;
        await Whisper.groqRun(tone, 'de', {});
        b.textContent = '✓ läuft'; b.classList.add('ok');
        toast('✓ Groq-Spracherkennung bereit', 'ok');
      } catch (e) { Settings.set({ groqKey: old }); b.textContent = 'Fehler'; toast(esc(e.message), 'err', 7000); }
      b.disabled = false;
    };
    $$('input[name=prov]', el).forEach(r => r.onchange = () => { renderProv(); if (provNow() === 'ollama') AI.checkOllama().then(renderOllama); });
    AI.onChange = () => { if (el.isConnected) renderProv(); };
    AI.checkChrome().then(renderProv);
    renderProv();
    $('#chrome-load', el).onclick = async () => {
      const b = $('#chrome-load', el); b.disabled = true;
      try { await AI.checkChrome(); if (AI.chrome.state !== 'unavailable' && AI.chrome.state !== 'unsupported') await AI.prepareChrome(); toast(AI.chrome.state === 'available' ? '✅ Chrome-KI bereit' : 'Chrome-KI nicht verfügbar', AI.chrome.state === 'available' ? 'ok' : 'warn'); }
      catch (e) { toast(esc(e.message), 'err', 7000); }
      b.disabled = false; renderProv();
    };
    $('#set-gtest', el).onclick = async () => {
      const b = $('#set-gtest', el); b.disabled = true; b.textContent = '…';
      const key = $('#set-gkey', el).value.trim();
      try {
        const pick = await AI.pickGeminiModels(key);
        Settings.set({ geminiKey: key, geminiLive: pick.live, geminiFinal: pick.final });
        b.textContent = '✓ läuft'; b.classList.add('ok');
        toast(`✓ Gemini bereit (${esc(pick.final)})`, 'ok');
      } catch (e) { b.textContent = 'Fehler'; toast(esc(e.message), 'err', 7000); }
      b.disabled = false;
    };
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
    // verfügbare Mikrofone eintragen (Namen gibt's erst nach einer Mikrofon-Freigabe)
    (async () => {
      const sel = $('#set-mic', el); if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      try {
        const mics = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
        const cur = Settings.get().micId || '';
        sel.innerHTML = '<option value="">Standard-Mikrofon von Windows</option>' + mics.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'Mikrofon ' + (i + 1))}</option>`).join('') +
          (cur && !mics.some(d => d.deviceId === cur) ? `<option value="${esc(cur)}" selected>${esc(Settings.get().micLabel || 'Gewähltes Mikrofon')} (nicht angesteckt)</option>` : '');
      } catch (e) { /* egal */ }
    })();
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
    // Eigene API
    const oaHint = () => { const pr = AI.OA_PRESETS[$('#oa-preset', el).value] || {}; $('#oa-keyhint', el).innerHTML = pr.key ? `Schlüssel bekommst du auf <a href="https://${pr.key}" target="_blank" rel="noopener">${pr.key}</a>.` : ''; };
    $('#oa-preset', el).onchange = () => {
      const pr = AI.OA_PRESETS[$('#oa-preset', el).value] || {};
      if (pr.base != null) $('#oa-base', el).value = pr.base;
      if (pr.model) $('#oa-model', el).value = pr.model;
      oaHint();
    };
    if (!$('#oa-base', el).value) $('#oa-preset', el).onchange(); else oaHint();
    $('#oa-load', el).onclick = async () => {
      try {
        const list = await AI.listOpenAIModels($('#oa-base', el).value.trim(), $('#oa-key', el).value.trim());
        $('#oa-models', el).innerHTML = list.map(m => `<option value="${esc(m)}">`).join('');
        toast(`${list.length} Modelle gefunden – ins Feld klicken zum Auswählen`, 'ok');
      } catch (e) { toast('Modelle laden: ' + esc(e.message), 'err', 7000); }
    };
    $('#oa-test', el).onclick = async () => {
      const b = $('#oa-test', el); b.disabled = true; b.textContent = '…';
      const old = Settings.get();
      Settings.set({ provider: 'openai', oaBase: $('#oa-base', el).value.trim(), oaKey: $('#oa-key', el).value.trim(), oaModel: $('#oa-model', el).value.trim(), oaPreset: $('#oa-preset', el).value });
      try { const r = await AI.call({ maxTokens: 20, messages: [{ role: 'user', content: 'Antworte nur mit: ok' }] }); b.textContent = '✓ ' + (r.text || '').trim().slice(0, 12); b.classList.add('ok'); }
      catch (e) { b.textContent = 'Fehler'; toast(esc(e.message), 'err', 8000); Settings.set({ provider: old.provider }); }
      b.disabled = false;
    };
    // Desktop & Handy
    if (window.desktopAPI) {
      desktopAPI.info().then(i => {
        const nice = (a) => a.replace('CommandOrControl', 'Strg').replace(/\+/g, ' + ');
        const lbl = { window: 'Fenster ein-/ausblenden', rec: 'Aufnahme starten/pausieren', note: 'Schnellnotiz', mini: 'Mini-Fenster' };
        const scl = $('#sc-list', el);
        if (scl) scl.innerHTML = Object.entries(i.shortcuts).map(([k, a]) => `<kbd>${esc(nice(a))}</kbd> ${lbl[k]}${i.shortcutStatus[k] === false ? ' <span class="warn-txt">(belegt)</span>' : ''}`).join('<br>');
      });
      $('#set-mini', el).onclick = () => desktopAPI.openMini(false);
      $('#set-phone', el).onclick = () => { m.close(); window.DesktopBridge && DesktopBridge.connectPhone(); };
    }
    // Profil
    $('#prof-export', el).onclick = () => {
      const withKeys = $('#prof-keys', el).checked;
      download(new Blob([JSON.stringify(Rules.exportProfile(withKeys), null, 2)], { type: 'application/json' }), `AutoDoku-Profil${withKeys ? '-MIT-SCHLUESSELN' : ''}.json`);
    };
    $('#prof-import', el).onclick = () => {
      const inp = $('#import-input'); inp.value = '';
      inp.onchange = async () => {
        try {
          const r = Rules.importProfile(JSON.parse(await inp.files[0].text()));
          toast(`✓ Profil übernommen: ${r.subjects} Fächer, Regeln & KI-Einstellungen${r.keys ? ' (inkl. Schlüssel)' : ' – trag jetzt deinen eigenen Schlüssel ein'}`, 'ok', 7000);
          m.close(); openSettings();
        } catch (e) { toast('Import: ' + esc(e.message), 'err'); }
      };
      inp.click();
    };
    const vb = $('#set-vault', el);
    if (vb) vb.onclick = async () => {
      const r = await window.vaultAPI.choose();
      if (!r) return;
      await Vault.init(); Vault.renderSidebar();
      $('#vault-path', el).innerHTML = `📁 <b>${esc(r.vault)}</b>`;
      toast('🗂️ Notizordner: ' + esc(r.name), 'ok');
    };
    const vo = $('#set-vault-open', el); if (vo) vo.onclick = () => m.close();
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
        <label class="field"><span>Fachbegriffe (damit die Spracherkennung sie richtig schreibt)</span><textarea class="input" id="fs-gloss" rows="2" placeholder="z. B. Subnetzmaske, VLAN, Packet Tracer, OSPF">${esc(sub.glossary || '')}</textarea></label>
        <label class="field"><span>Regeln für dieses Fach (optional)</span><textarea class="input" id="fs-hints" rows="3" placeholder="z. B. „Lehrer heißt Prof. Huber, sagt oft ‚merken‘ bei wichtigen Sachen“ oder „Vokabeln immer mit Lautschrift“">${esc(sub.hints || '')}</textarea></label>
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
              hints: $('#fs-hints', el).value.trim(), glossary: $('#fs-gloss', el).value.trim(),
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
          <li><b>KI fasst zusammen</b><span>Alle 1–2 Minuten wird daraus eine saubere Mitschrift: Stichpunkte, Merke-Boxen, Formeln, Hausübungen.</span></li>
          <li><b>Tafel fotografieren</b><span>📷 – Formeln und Skizzen landen automatisch im Dokument.</span></li>
          <li><b>✨ Fertig → ⬇ Word</b><span>Polierte Mitschrift mit echten Word-Formeln, Bildern und Quiz-Fragen.</span></li>
        </ol>
        <h3 class="ob-h">Welche KI soll mitschreiben?</h3>
        <div class="modes prov ob-prov">${[
          ['claude', '🟠 Claude', 'Beste Mitschriften & Tafelfotos. Cloud, eigener API-Schlüssel, ein paar Cent pro Stunde. Laptop bleibt leise.'],
          ...(Setup.isDesktop() ? [['ollama', '🦙 Ollama (lokal)', `Gratis & offline auf deinem PC. AutoDoku lädt alles selbst (Modell ${esc(AI.recommendedModel())}). ${((window.AUTODOKU_INFO || {}).ramGB || 8) >= 12 ? 'Passt zu deinem PC.' : 'Dein PC hat wenig RAM – geht, ist aber langsamer.'}`]] : []),
          ['gemini', '🔷 Gemini', 'Gratis mit kostenlosem Google-Schlüssel. Cloud.'],
        ].map(([k, l, h], i) => `<label class="mode ${i === 0 ? 'on' : ''}"><input type="radio" name="obprov" value="${k}" ${i === 0 ? 'checked' : ''}><b>${l}</b><small>${h}</small></label>`).join('')}</div>
        <label class="field ob-for" data-for="claude"><span>Claude-API-Schlüssel</span>
          <input class="input" type="password" id="ob-ckey" placeholder="sk-ant-…" autocomplete="off">
          <small>Auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> → „Create Key“ (etwas Guthaben aufladen – nicht dasselbe wie ein Claude-Pro-Abo). Geht auch später in ⚙️.</small>
        </label>
        <label class="field ob-for" data-for="gemini" style="display:none"><span>Gemini-Schlüssel (gratis)</span>
          <input class="input" type="password" id="ob-gmkey" placeholder="AIza…" autocomplete="off">
          <small>Kostenlos auf <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</small>
        </label>
        <p class="fineprint ob-for" data-for="ollama" style="display:none">🦙 Nach „Los geht's“ richtet AutoDoku Ollama ein (≈ 40 MB, ohne Autostart) und lädt das KI-Modell. Ollama läuft nur, solange AutoDoku es braucht.</p>
        ${Setup.isDesktop() ? '<p class="fineprint">🎙️ Die <b>Spracherkennung</b> (Whisper large-v3-turbo) läuft lokal auf deinem PC und wird automatisch eingerichtet (einmalig ≈ 550 MB, im Hintergrund).</p>' : `<label class="field"><span>Groq-Schlüssel für die Spracherkennung (gratis, optional)</span>
          <input class="input" type="password" id="ob-gkey" placeholder="gsk_…" autocomplete="off">
          <small>Kostenlos auf <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> – sehr genaue Whisper-Erkennung.</small>
        </label>`}
        <p class="fineprint">💬 Kurz fair bleiben: Frag deine Lehrkraft, ob Mitschreiben per App ok ist. AutoDoku speichert kein Audio, nur Text – und alles bleibt auf deinem Gerät.</p>
      </div>`,
      actions: [
        { label: '🎓 Erst Demo ansehen', onClick: (el) => { obKeys(el); createDemo(); } },
        { label: 'Los geht\'s', primary: true, onClick: (el) => { obKeys(el); } },
      ],
      onClose: () => localStorage.setItem('autodoku.onboarded', '1'),
    });
    const obProv = () => (m.el.querySelector('input[name=obprov]:checked') || {}).value || 'claude';
    $$('input[name=obprov]', m.el).forEach(r => r.onchange = () => {
      $$('.ob-prov .mode', m.el).forEach(x => x.classList.toggle('on', x.querySelector('input').value === obProv()));
      $$('.ob-for', m.el).forEach(x => { x.style.display = x.dataset.for === obProv() ? '' : 'none'; });
    });
    return m;
  }

  // Einrichtung (Desktop): Spracherkennung + ggf. Ollama laden, Fortschritt anzeigen
  function openSetup(autoStart) {
    const set = Settings.get();
    const wantOllama = AI.provider() === 'ollama' || set.provider === 'ollama';
    const m = modal({
      title: '🧰 Einrichtung', wide: false,
      body: `<p class="muted small">AutoDoku lädt alles Nötige selbst. Du kannst das Fenster schließen – es läuft im Hintergrund weiter (Anzeige unten rechts).</p><div id="setup-list"></div>`,
      actions: [{ label: 'Im Hintergrund weiter' }, { label: 'Jetzt einrichten / wiederholen', primary: true, onClick: () => { Setup.start({ ollama: wantOllama, model: set.ollamaModel || AI.recommendedModel() }); return false; } }],
    });
    const off = Setup.mount($('#setup-list', m.el));
    const oc = m.close; m.close = () => { off(); oc(); };
    if (!Setup.run.steps.length) {
      Setup.run.steps = Setup.plan({ ollama: wantOllama, model: set.ollamaModel || AI.recommendedModel() });
      Whisper.checkLocal().then(L => { const w = Setup.run.steps.find(x => x.id === 'whisper'); if (w && L.installed) w.state = 'skip'; });
      AI.checkOllama().then(() => {
        const o = Setup.run.steps.find(x => x.id === 'ollama'); if (o && AI.ollama.installed) o.state = 'skip';
        const md = Setup.run.steps.find(x => x.id === 'model'); if (md && AI.ollama.models.includes(md.model)) md.state = 'skip';
        Setup.mount($('#setup-list', m.el));
      });
    }
    if (autoStart) Setup.start({ ollama: wantOllama, model: set.ollamaModel || AI.recommendedModel() });
    return m;
  }

  function obKeys(el) {
    const prov = (el.querySelector('input[name=obprov]:checked') || {}).value || 'claude';
    const c = $('#ob-ckey', el).value.trim(), gm = $('#ob-gmkey', el).value.trim(), g = ($('#ob-gkey', el) || { value: '' }).value.trim();
    const patch = { provider: prov };
    if (c) patch.apiKey = c;
    if (gm) patch.geminiKey = gm;
    if (g) patch.groqKey = g;
    if (prov === 'claude' && !c) patch.provider = 'auto';
    if (prov === 'ollama') patch.ollamaModel = AI.recommendedModel();
    Settings.set(patch);
    if (Setup.isDesktop()) setTimeout(() => openSetup(true), 300);
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
  window.UI = { toast, modal, prompt, confirmBox, lightbox };
  $('#btn-settings').onclick = openSettings;
  if (window.Vault && Vault.available) {
    document.body.classList.add('has-vault');
    const tg = $('#btn-sidebar'); if (tg) tg.onclick = () => document.body.classList.toggle('sb-open');
    const bp = $('#btn-phone'); if (bp) bp.onclick = () => window.DesktopBridge && DesktopBridge.connectPhone();
    Vault.init().then(() => { Vault.renderSidebar(); if (location.hash.startsWith('#/notes')) route(); });
  }
  window.addEventListener('hashchange', route);
  route();
  setTimeout(onboarding, 400);
  // Umstieg auf Claude (einmalig): bessere Mitschriften -> "Beste Qualität" statt Sparmodus
  if (!localStorage.getItem('autodoku.v32')) {
    try { localStorage.setItem('autodoku.v32', '1'); } catch (e) { /* egal */ }
    const set = Settings.get();
    if (set.mode === 'spar') Settings.set(Object.assign({ mode: 'normal' }, (({ liveUpdates, modelLive, modelFinal, interval, minWords }) => ({ liveUpdates, modelLive, modelFinal, interval, minWords }))(Store.MODES.normal)));
  }
  // Beim Start (Desktop): fehlt etwas? -> im Hintergrund einrichten. Neue Version? -> Hinweis
  setTimeout(async () => {
    if (!localStorage.getItem('autodoku.onboarded')) return;
    if (Setup.isDesktop()) {
      const L = await Whisper.checkLocal();
      await AI.checkOllama();
      const set = Settings.get();
      const needOllama = set.provider === 'ollama' && (!AI.ollama.installed || !AI.ollama.models.length);
      if (!L.installed || needOllama) Setup.start({ ollama: needOllama, model: set.ollamaModel || AI.recommendedModel() });
      const u = await Setup.checkUpdate(false);
      if (u && u.newer) toast(`⬆ AutoDoku ${esc(u.latest)} ist da – ⚙️ → Über AutoDoku → „Jetzt aktualisieren“`, 'ok', 12000);
    }
    if (!AI.ready() && !localStorage.getItem('autodoku.aiHint')) {
      try { localStorage.setItem('autodoku.aiHint', '1'); } catch (e) { /* egal */ }
      toast('🧠 Wähle einmal deine KI: Claude (Schlüssel) oder Ollama (lokal, gratis).', 'warn', 10000);
      openSettings();
    }
  }, 3000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // für Tests
  window.AutoDoku = { st, createDemo, liveUpdate, finalize, applyLive, splitSections, parseTasks, exportWord,
    startRecording, stopRecording, startLesson, openSetup, openSettings, addPhotos, newSession, save, saveNow, curRecMs, renderAll, appendSeg, toast, route, vaultOn, syncToVault };
})();
