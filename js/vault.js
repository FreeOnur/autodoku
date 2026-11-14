/* AutoDoku – Notizordner wie Obsidian
 * Links: Ordnerbaum (Suche, neu, umbenennen, verschieben, Papierkorb, Drag & Drop)
 * Rechts: Tabs mit Markdown-Editor/Vorschau, PDF (ausfüllen + speichern), Bilder, Video/Audio,
 *         Code/Text, Word-Vorschau, Mathcad & alles andere per Klick im passenden Programm.
 * Neue Dateien werden automatisch in Notizen umgewandelt (siehe convert.js). */
(function (root) {
  'use strict';

  const API = root.vaultAPI || null;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => root.MD.escHtml(s == null ? '' : s);
  const UI = () => root.UI;

  const EXT = {
    md: ['md', 'markdown'],
    text: ['txt', 'csv', 'log', 'ini', 'cfg', 'conf', 'env', 'gitignore'],
    code: ['js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'htm', 'css', 'scss', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sql', 'sh', 'bat', 'ps1', 'xml', 'yml', 'yaml', 'toml', 'vb', 'dart', 'swift', 'r', 'm', 'lua', 'asm', 'vhd', 'vhdl', 'ino'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
    video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
    audio: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'],
    pdf: ['pdf'],
    docx: ['docx'],
    mathcad: ['mcdx', 'xmcd', 'mcd', 'mcdt'],
    office: ['doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt'],
  };
  const extOf = (p) => (/\.([^./\\]+)$/.exec(p || '') || [])[1] ? (/\.([^./\\]+)$/.exec(p)[1]).toLowerCase() : '';
  const kindOf = (p) => { const e = extOf(p); for (const [k, list] of Object.entries(EXT)) if (list.includes(e)) return k; return 'other'; };
  const ICON = { dir: '📁', md: '📝', text: '📄', code: '🧩', image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', docx: '📘', mathcad: '🧮', office: '📊', other: '📎' };
  const baseName = (p) => (p || '').split('/').pop();
  const dirName = (p) => { const i = (p || '').lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');
  const join = (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/');
  const url = (p) => '/vault/' + p.split('/').map(encodeURIComponent).join('/');
  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Notiz';

  const V = {
    available: !!API,
    root: '', name: '',
    files: [], byPath: new Map(),
    expanded: new Set(JSON.parse(localStorage.getItem('autodoku.expanded') || '[]')),
    tabs: JSON.parse(localStorage.getItem('autodoku.tabs') || '[]'),
    active: null,
    docs: new Map(), // path -> {content, saved, timer, mode}
    filter: '',
    selfWrites: new Map(), // path -> time (eigene Schreibvorgänge im Watcher ignorieren)
    pdf: null,
  };

  // ---------- Daten ----------
  async function init() {
    if (!API) return;
    const g = await API.get();
    V.root = g.vault; V.name = g.name;
    if (V.root) await refresh();
    if (!V.listening) { API.onChanged(onChanged); V.listening = true; }
    if (V.root && root.Convert) { root.Convert.baseline(); root.Convert.onVaultChanged(); }
  }

  async function refresh() {
    V.files = await API.list();
    V.byPath = new Map(V.files.map(f => [f.path, f]));
    renderTree();
  }

  let refreshTimer = null;
  function onChanged(list) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await refresh();
      // geöffnete Datei von außen geändert? -> neu laden, wenn nicht ungespeichert
      for (const p of list) {
        const t = V.selfWrites.get(p);
        if (t && Date.now() - t < 2500) continue;
        const d = V.docs.get(p);
        if (d && !d.dirty && V.active === p && ['md', 'text', 'code'].includes(kindOf(p))) {
          try { const c = await API.read(p); if (c !== d.content) { d.content = c; d.saved = c; renderFile(); } } catch (e) { /* gelöscht */ }
        }
      }
      if (root.Convert) root.Convert.onVaultChanged(list);
    }, 250);
  }

  async function write(p, data) {
    V.selfWrites.set(p, Date.now());
    const r = await API.write(p, data);
    if (!V.byPath.has(p)) await refresh();
    return r;
  }
  async function read(p) { return API.read(p); }
  async function readBinary(p) { return API.read(p, 'binary'); }

  // Eindeutigen Dateinamen finden
  function uniquePath(p) {
    if (!V.byPath.has(p)) return p;
    const e = extOf(p), b = e ? p.slice(0, -(e.length + 1)) : p;
    let i = 2; while (V.byPath.has(`${b} ${i}${e ? '.' + e : ''}`)) i++;
    return `${b} ${i}${e ? '.' + e : ''}`;
  }

  // Obsidian-artige Auflösung: [[Name]] -> Datei irgendwo im Ordner
  function resolveLink(target, fromPath) {
    if (!target) return null;
    let t = target.replace(/#.*$/, '').replace(/^\/+/, '').trim();
    if (!t) return fromPath;
    const cands = [t, t + '.md', join(dirName(fromPath || ''), t), join(dirName(fromPath || ''), t + '.md')];
    for (const c of cands) if (V.byPath.has(c) && V.byPath.get(c).type === 'file') return c;
    const low = t.toLowerCase(), lowMd = low.endsWith('.md') ? low : low + '.md';
    const byName = V.files.filter(f => f.type === 'file' && (f.name.toLowerCase() === low || f.name.toLowerCase() === lowMd || f.path.toLowerCase().endsWith('/' + low) || f.path.toLowerCase().endsWith('/' + lowMd)));
    return byName.length ? byName[0].path : null;
  }

  // ---------- Sidebar ----------
  function sidebarHtml() {
    if (!V.root) {
      return `<div class="sb-empty"><div class="pe-icon">🗂️</div><p><b>Notizordner wählen</b></p><p class="muted small">Wie ein Obsidian-Vault: Alle Mitschriften, PDFs, Bilder & Dateien an einem Ort.</p>
        <button class="btn primary small" data-sb="choose">Ordner wählen …</button>
        <button class="btn ghost small" data-sb="default">Standard: Dokumente › AutoDoku Notizen</button></div>`;
    }
    return `
      <div class="sb-head">
        <button class="sb-vault" data-sb="choose" title="${esc(V.root)} – anderen Ordner wählen">🗂️ ${esc(V.name)}</button>
        <div class="sb-tools">
          <button class="icon-btn tiny" data-sb="new-note" title="Neue Notiz (Strg+N)">📝</button>
          <button class="icon-btn tiny" data-sb="new-folder" title="Neuer Ordner">📁</button>
          <button class="icon-btn tiny" data-sb="import" title="Dateien importieren">⬆</button>
          <button class="icon-btn tiny" data-sb="collapse" title="Alles einklappen">⊟</button>
        </div>
      </div>
      <div class="sb-search"><input class="input" id="sb-filter" placeholder="Suchen … (Enter = Volltext)" value="${esc(V.filter)}"></div>
      <div class="sb-tree" id="sb-tree" tabindex="0"></div>
      <div class="sb-queue" id="sb-queue"></div>
      <div class="sb-foot">
        <a class="btn small" href="#/">🎙 Unterricht</a>
        <button class="btn small ghost" data-sb="inbox" title="Alles, was du in diesen Ordner legst, wird automatisch in Notizen umgewandelt">📥 Eingang</button>
      </div>`;
  }

  function renderSidebar() {
    const sb = $('#sidebar'); if (!sb) return;
    sb.innerHTML = sidebarHtml();
    sb.onclick = onSidebarClick;
    const f = $('#sb-filter', sb);
    if (f) {
      f.oninput = () => { V.filter = f.value; renderTree(); };
      f.onkeydown = (e) => { if (e.key === 'Enter' && f.value.trim()) fullTextSearch(f.value.trim()); if (e.key === 'Escape') { f.value = ''; V.filter = ''; renderTree(); } };
    }
    renderTree();
    bindDrop(sb);
    if (root.Convert) root.Convert.renderQueue();
  }

  function buildTree() {
    const rootNode = { path: '', children: new Map(), type: 'dir' };
    for (const f of V.files) {
      const parts = f.path.split('/');
      let node = rootNode;
      parts.forEach((part, i) => {
        const p = parts.slice(0, i + 1).join('/');
        if (!node.children.has(part)) node.children.set(part, { path: p, name: part, children: new Map(), type: i === parts.length - 1 ? f.type : 'dir' });
        node = node.children.get(part);
      });
    }
    return rootNode;
  }

  function renderTree() {
    const el = $('#sb-tree'); if (!el) return;
    const q = V.filter.trim().toLowerCase();
    if (q) {
      const hits = V.files.filter(f => f.type === 'file' && f.path.toLowerCase().includes(q)).slice(0, 300);
      el.innerHTML = hits.length ? hits.map(f => rowHtml(f.path, f.name, 'file', 0, true)).join('') : '<p class="muted small sb-pad">Nichts gefunden. Enter = Volltextsuche.</p>';
      return;
    }
    const tree = buildTree();
    const sortKids = (n) => [...n.children.values()].sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name, 'de', { numeric: true }) : (a.type === 'dir' ? -1 : 1));
    const walk = (node, depth) => sortKids(node).map(c => {
      if (c.type === 'dir') {
        const open = V.expanded.has(c.path);
        return rowHtml(c.path, c.name, 'dir', depth, false, open) + (open ? `<div class="tree-kids">${walk(c, depth + 1)}</div>` : '');
      }
      return rowHtml(c.path, c.name, 'file', depth);
    }).join('');
    el.innerHTML = V.files.length ? walk(tree, 0) : '<p class="muted small sb-pad">Noch leer. Starte eine Stunde oder zieh Dateien hier rein.</p>';
  }

  function rowHtml(p, name, type, depth, showPath, open) {
    const k = type === 'dir' ? 'dir' : kindOf(p);
    const label = type === 'file' && k === 'md' ? name.replace(/\.md$/i, '') : name;
    return `<div class="tree-row ${type} ${V.active === p ? 'active' : ''}" draggable="true" data-path="${esc(p)}" data-type="${type}" style="--d:${depth}">
      ${type === 'dir' ? `<span class="caret">${open ? '▾' : '▸'}</span>` : '<span class="caret"></span>'}
      <span class="ticon">${ICON[k] || '📎'}</span><span class="tname">${esc(label)}</span>${showPath ? `<span class="tpath">${esc(dirName(p))}</span>` : ''}
    </div>`;
  }

  async function onSidebarClick(e) {
    const b = e.target.closest('[data-sb]');
    if (b) {
      const a = b.dataset.sb;
      if (a === 'choose') { const r = await API.choose(); if (r) { V.root = r.vault; V.name = r.name; V.tabs = []; V.docs.clear(); saveTabs(); await refresh(); if (root.Convert) root.Convert.baseline(); renderSidebar(); location.hash = '#/notes'; } }
      else if (a === 'default') { const r = await API.useDefault(); V.root = r.vault; V.name = r.name; await refresh(); if (root.Convert) root.Convert.baseline(); renderSidebar(); location.hash = '#/notes'; }
      else if (a === 'new-note') newNote(currentFolder());
      else if (a === 'new-folder') newFolder(currentFolder());
      else if (a === 'import') importFiles(currentFolder());
      else if (a === 'collapse') { V.expanded.clear(); saveExpanded(); renderTree(); }
      else if (a === 'inbox') { await API.mkdir('_Eingang'); V.expanded.add('_Eingang'); saveExpanded(); await refresh(); UI().toast('📥 Leg Dateien in <b>_Eingang</b> (oder zieh sie in einen Ordner) – AutoDoku macht automatisch Notizen daraus.', 'ok', 7000); }
      return;
    }
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const p = row.dataset.path;
    if (row.dataset.type === 'dir') { V.expanded.has(p) ? V.expanded.delete(p) : V.expanded.add(p); saveExpanded(); V.selectedDir = p; renderTree(); }
    else openFile(p);
  }

  function currentFolder() {
    if (V.selectedDir && V.byPath.has(V.selectedDir)) return V.selectedDir;
    return V.active ? dirName(V.active) : '';
  }
  const saveExpanded = () => localStorage.setItem('autodoku.expanded', JSON.stringify([...V.expanded]));
  const saveTabs = () => localStorage.setItem('autodoku.tabs', JSON.stringify(V.tabs.slice(-12)));

  // Kontextmenü
  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest && e.target.closest('.tree-row');
    if (!row) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, row.dataset.path, row.dataset.type);
  });
  function showMenu(x, y, p, type) {
    closeMenu();
    const k = type === 'dir' ? 'dir' : kindOf(p);
    const items = [];
    if (type === 'dir') items.push(['📝 Neue Notiz hier', () => newNote(p)], ['📁 Neuer Unterordner', () => newFolder(p)], ['⬆ Dateien hierher importieren', () => importFiles(p)]);
    else items.push(['↗ Öffnen', () => openFile(p)]);
    if (type === 'file' && root.Convert && root.Convert.canConvert(p)) items.push(['✨ In Notizen umwandeln', () => root.Convert.enqueue(p, { force: true })]);
    if (type === 'file' && k === 'md') items.push(['⬇ Als Word exportieren', () => exportWord(p)]);
    items.push(['✏️ Umbenennen', () => renameItem(p)], ['📂 Im Explorer zeigen', () => API.showInFolder(p)]);
    if (type === 'file') items.push(['🖥 Mit Standardprogramm öffnen', () => API.openExternal(p)]);
    items.push(['🗑 In den Papierkorb', () => trashItem(p)]);
    const m = document.createElement('div');
    m.className = 'ctx-menu';
    m.innerHTML = items.map((it, i) => `<button data-i="${i}">${it[0]}</button>`).join('');
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    m.onclick = (e) => { const b = e.target.closest('button'); if (b) { closeMenu(); items[+b.dataset.i][1](); } };
    setTimeout(() => document.addEventListener('mousedown', closeMenuOutside), 0);
  }
  function closeMenuOutside(e) { if (!e.target.closest('.ctx-menu')) closeMenu(); }
  function closeMenu() { $$('.ctx-menu').forEach(m => m.remove()); document.removeEventListener('mousedown', closeMenuOutside); }

  async function newNote(folder, name, content) {
    const n = name || await UI().prompt('Name der neuen Notiz', { value: 'Neue Notiz' });
    if (!n) return null;
    const p = uniquePath(join(folder, safeName(n) + '.md'));
    await write(p, content != null ? content : `# ${n}\n\n`);
    if (folder) V.expanded.add(folder);
    saveExpanded(); await refresh();
    openFile(p, 'edit');
    return p;
  }
  async function newFolder(folder) {
    const n = await UI().prompt('Name des Ordners', { value: 'Neuer Ordner' });
    if (!n) return;
    const p = uniquePath(join(folder, safeName(n)));
    await API.mkdir(p); V.expanded.add(p); if (folder) V.expanded.add(folder); saveExpanded(); await refresh();
  }
  async function importFiles(folder) {
    const list = await API.pickFiles();
    if (!list.length) return;
    const out = await API.import(list, folder);
    await refresh();
    if (folder) { V.expanded.add(folder); saveExpanded(); renderTree(); }
    UI().toast(`⬆ ${out.length} Datei${out.length > 1 ? 'en' : ''} importiert – werden in Notizen umgewandelt …`, 'ok');
    out.forEach(p => root.Convert && root.Convert.enqueue(p));
  }
  async function renameItem(p) {
    const isMd = kindOf(p) === 'md';
    const cur = isMd ? stem(p) : baseName(p);
    const n = await UI().prompt('Neuer Name', { value: cur });
    if (!n || n === cur) return;
    const to = join(dirName(p), safeName(n) + (isMd ? '.md' : ''));
    try {
      await API.rename(p, to);
      V.tabs = V.tabs.map(t => t === p ? to : t.startsWith(p + '/') ? to + t.slice(p.length) : t);
      if (V.active === p) V.active = to;
      saveTabs(); await refresh();
      if (V.active === to) location.hash = '#/notes/' + encodeURIComponent(to);
    } catch (e) { UI().toast(esc(e.message), 'err'); }
  }
  async function moveItem(p, folder) {
    const to = join(folder, baseName(p));
    if (to === p || folder === p || folder.startsWith(p + '/')) return;
    try {
      await API.rename(p, to);
      V.tabs = V.tabs.map(t => t === p ? to : t);
      if (V.active === p) V.active = to;
      saveTabs(); V.expanded.add(folder); saveExpanded(); await refresh();
    } catch (e) { UI().toast(esc(e.message), 'err'); }
  }
  async function trashItem(p) {
    if (!await UI().confirmBox('In den Papierkorb?', `<b>${esc(baseName(p))}</b> wird in den Windows-Papierkorb verschoben (wiederherstellbar).`, 'Löschen', true)) return;
    await API.trash(p);
    V.tabs = V.tabs.filter(t => t !== p && !t.startsWith(p + '/'));
    saveTabs();
    if (V.active === p) { V.active = null; location.hash = V.tabs.length ? '#/notes/' + encodeURIComponent(V.tabs[V.tabs.length - 1]) : '#/notes'; }
    await refresh();
  }

  // Drag & Drop: Dateien von außen importieren, innerhalb verschieben
  function bindDrop(sb) {
    const tree = $('#sb-tree', sb); if (!tree) return;
    tree.addEventListener('dragstart', (e) => { const r = e.target.closest('.tree-row'); if (r) e.dataTransfer.setData('text/autodoku-path', r.dataset.path); });
    tree.addEventListener('dragover', (e) => {
      e.preventDefault();
      $$('.tree-row.drop', tree).forEach(x => x.classList.remove('drop'));
      const r = e.target.closest('.tree-row'); if (r) (r.dataset.type === 'dir' ? r : r).classList.add('drop');
    });
    tree.addEventListener('dragleave', () => $$('.tree-row.drop', tree).forEach(x => x.classList.remove('drop')));
    tree.addEventListener('drop', async (e) => {
      e.preventDefault();
      $$('.tree-row.drop', tree).forEach(x => x.classList.remove('drop'));
      const r = e.target.closest('.tree-row');
      const folder = r ? (r.dataset.type === 'dir' ? r.dataset.path : dirName(r.dataset.path)) : '';
      const inner = e.dataTransfer.getData('text/autodoku-path');
      if (inner) return moveItem(inner, folder);
      const paths = [...(e.dataTransfer.files || [])].map(f => API.pathOf(f)).filter(Boolean);
      if (!paths.length) return;
      const out = await API.import(paths, folder);
      if (folder) { V.expanded.add(folder); saveExpanded(); }
      await refresh();
      UI().toast(`⬆ ${out.length} Datei${out.length > 1 ? 'en' : ''} importiert – AutoDoku macht Notizen daraus …`, 'ok');
      out.forEach(p => root.Convert && root.Convert.enqueue(p));
    });
  }

  // Volltextsuche über alle Notizen
  async function fullTextSearch(q) {
    const ql = q.toLowerCase();
    const mds = V.files.filter(f => f.type === 'file' && ['md', 'text', 'code'].includes(kindOf(f.path)) && f.size < 2e6).slice(0, 3000);
    const view = $('#view');
    view.innerHTML = `<section class="vault-page"><h2>🔎 „${esc(q)}“</h2><div id="ft-res"><div class="spinner"></div></div></section>`;
    const res = [];
    for (const f of mds) {
      let c; try { c = await read(f.path); } catch (e) { continue; }
      const i = c.toLowerCase().indexOf(ql);
      if (i >= 0 || f.path.toLowerCase().includes(ql)) {
        const s = Math.max(0, i - 60);
        res.push({ p: f.path, snip: i >= 0 ? (s ? '…' : '') + c.slice(s, i + q.length + 80) + '…' : '' });
      }
      if (res.length > 200) break;
    }
    $('#ft-res').innerHTML = res.length ? res.map(r => `<a class="ft-hit" href="#/notes/${encodeURIComponent(r.p)}"><b>${esc(stem(r.p))}</b><small>${esc(dirName(r.p))}</small>${r.snip ? `<span>${esc(r.snip).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`)}</span>` : ''}</a>`).join('') : '<p class="empty">Nichts gefunden.</p>';
  }

  // ---------- Hauptbereich ----------
  async function show(rest) {
    if (!API) { location.hash = '#/'; return; }
    renderSidebar();
    if (!V.root) {
      $('#view').innerHTML = `<section class="vault-page welcome"><h1>🗂️ Dein Notizordner</h1>
        <p class="lead">Wähle einen Ordner für alle Mitschriften – wie ein Obsidian-Vault. Du kannst auch einen bestehenden Obsidian-Vault nehmen.</p>
        <div class="row wrap"><button class="btn primary" id="vw-choose">Ordner wählen …</button><button class="btn" id="vw-default">Dokumente › AutoDoku Notizen</button></div></section>`;
      $('#vw-choose').onclick = async () => { const r = await API.choose(); if (r) { V.root = r.vault; V.name = r.name; await refresh(); if (root.Convert) root.Convert.baseline(); show(''); } };
      $('#vw-default').onclick = async () => { const r = await API.useDefault(); V.root = r.vault; V.name = r.name; await refresh(); if (root.Convert) root.Convert.baseline(); show(''); };
      return;
    }
    if (rest) return openFile(rest, null, true);
    V.active = null; renderTree();
    const recent = V.files.filter(f => f.type === 'file').sort((a, b) => b.mtime - a.mtime).slice(0, 14);
    $('#view').innerHTML = `<section class="vault-page">
      <div class="vp-head"><h1>🗂️ ${esc(V.name)}</h1>
        <div class="row wrap"><button class="btn primary small" id="vp-new">📝 Neue Notiz</button><button class="btn small" id="vp-import">⬆ Dateien importieren</button><a class="btn small" href="#/">🎙 Stunde aufnehmen</a></div></div>
      <p class="muted">Tipp: Zieh PDFs, Fotos, Videos oder Word-Dateien links in einen Ordner – AutoDoku macht automatisch Notizen daraus. <kbd>Strg</kbd>+<kbd>O</kbd> öffnet die Schnellsuche.</p>
      <h3>Zuletzt geändert</h3>
      <div class="recent-grid">${recent.map(f => `<a class="recent" href="#/notes/${encodeURIComponent(f.path)}"><span>${ICON[kindOf(f.path)]}</span><b>${esc(kindOf(f.path) === 'md' ? stem(f.path) : f.name)}</b><small>${esc(dirName(f.path) || V.name)} · ${new Date(f.mtime).toLocaleDateString('de-AT')}</small></a>`).join('') || '<p class="empty">Noch keine Dateien.</p>'}</div>
    </section>`;
    $('#vp-new').onclick = () => newNote('');
    $('#vp-import').onclick = () => importFiles('');
  }

  async function openFile(p, mode, fromRoute) {
    if (!fromRoute) {
      if (mode) V.forceMode = mode;
      const h = '#/notes/' + encodeURIComponent(p);
      if (location.hash === h) return openFile(p, null, true);
      location.hash = h; return;
    }
    if (!V.byPath.has(p)) await refresh();
    if (!V.byPath.has(p)) { UI().toast('Datei nicht gefunden: ' + esc(p), 'err'); location.hash = '#/notes'; return; }
    if (!V.tabs.includes(p)) V.tabs.push(p);
    if (V.tabs.length > 12) V.tabs.shift();
    saveTabs();
    V.active = p;
    // Ordner aufklappen
    const parts = p.split('/'); for (let i = 1; i < parts.length; i++) V.expanded.add(parts.slice(0, i).join('/'));
    saveExpanded();
    renderTree();
    if (mode) V.forceMode = mode;
    await renderFile();
  }

  function tabsHtml() {
    return `<div class="tabs">${V.tabs.map(t => `<div class="tab ${t === V.active ? 'on' : ''}" data-tab="${esc(t)}" title="${esc(t)}"><span>${ICON[kindOf(t)]} ${esc(kindOf(t) === 'md' ? stem(t) : baseName(t))}${V.docs.get(t) && V.docs.get(t).dirty ? ' •' : ''}</span><button class="tab-x" data-close="${esc(t)}">✕</button></div>`).join('')}</div>`;
  }

  async function renderFile() {
    const p = V.active; if (!p) return;
    const k = kindOf(p);
    const view = $('#view');
    destroyPdf();
    const crumbs = p.split('/').map((s, i, a) => `<span>${esc(i === a.length - 1 && k === 'md' ? s.replace(/\.md$/, '') : s)}</span>`).join('<i>›</i>');
    view.innerHTML = `<section class="file-view" data-kind="${k}">
      ${tabsHtml()}
      <div class="fv-bar"><div class="crumbs">${crumbs}</div><div class="fv-tools" id="fv-tools"></div></div>
      <div class="fv-body" id="fv-body"></div>
    </section>`;
    $('.tabs', view).onclick = (e) => {
      const x = e.target.closest('[data-close]');
      if (x) { e.stopPropagation(); return closeTab(x.dataset.close); }
      const t = e.target.closest('[data-tab]'); if (t) openFile(t.dataset.tab);
    };
    $('.tabs', view).onauxclick = (e) => { const t = e.target.closest('[data-tab]'); if (t && e.button === 1) closeTab(t.dataset.tab); };
    const tools = $('#fv-tools'), body = $('#fv-body');
    const common = `<button class="btn tiny ghost" data-ft="external" title="Mit Standardprogramm öffnen">🖥 Extern</button><button class="btn tiny ghost" data-ft="folder" title="Im Explorer zeigen">📂</button>`;
    tools.onclick = (e) => { const b = e.target.closest('[data-ft]'); if (b) toolAction(b.dataset.ft, p); };
    try {
      if (k === 'md') return await renderMarkdown(p, tools, body, common);
      if (k === 'text' || k === 'code') return await renderCode(p, tools, body, common, k);
      const conv = root.Convert && root.Convert.canConvert(p) ? `<button class="btn tiny accent" data-ft="convert">✨ In Notizen umwandeln</button>` : '';
      if (k === 'image') { tools.innerHTML = conv + common; body.innerHTML = `<div class="media-wrap"><img class="media-img" src="${url(p)}" alt=""></div>`; return; }
      if (k === 'video') { tools.innerHTML = conv + common; body.innerHTML = `<div class="media-wrap"><video src="${url(p)}" controls></video></div>`; return; }
      if (k === 'audio') { tools.innerHTML = conv + common; body.innerHTML = `<div class="media-wrap"><audio src="${url(p)}" controls></audio></div>`; return; }
      if (k === 'pdf') return await renderPdf(p, tools, body, conv + common);
      if (k === 'docx') return await renderDocx(p, tools, body, conv + common);
      // Mathcad, Office & Rest -> Programm öffnen
      const f = V.byPath.get(p) || {};
      const app = k === 'mathcad' ? 'Mathcad' : k === 'office' ? 'Office' : 'dem Standardprogramm';
      tools.innerHTML = common;
      body.innerHTML = `<div class="other-card"><div class="big">${ICON[k]}</div><h2>${esc(baseName(p))}</h2><p class="muted">${(f.size / 1024).toFixed(0)} KB · ${f.mtime ? new Date(f.mtime).toLocaleString('de-AT') : ''}</p>
        <button class="btn primary" data-ft="external">In ${app} öffnen</button>
        ${k === 'mathcad' ? '<p class="muted small">Mathcad-Dateien öffnen sich in Mathcad Prime. Formeln aus deinen Notizen kannst du dort mit „📋 Mathcad“ (bei jeder Formel) schnell eintippen.</p>' : ''}</div>`;
      body.onclick = (e) => { const b = e.target.closest('[data-ft]'); if (b) toolAction(b.dataset.ft, p); };
    } catch (e) {
      body.innerHTML = `<p class="empty">Konnte nicht geöffnet werden: ${esc(e.message)}</p>`;
    }
  }

  function closeTab(p) {
    const d = V.docs.get(p);
    if (d && d.dirty) flushSave(p);
    V.tabs = V.tabs.filter(t => t !== p);
    V.docs.delete(p);
    saveTabs();
    if (V.active === p) {
      V.active = null;
      location.hash = V.tabs.length ? '#/notes/' + encodeURIComponent(V.tabs[V.tabs.length - 1]) : '#/notes';
    } else renderFile();
  }

  async function toolAction(a, p) {
    if (a === 'external') { const r = await API.openExternal(p); if (r) UI().toast('Konnte nicht geöffnet werden: ' + esc(r), 'err'); }
    else if (a === 'folder') API.showInFolder(p);
    else if (a === 'convert') root.Convert.enqueue(p, { force: true });
    else if (a === 'word') exportWord(p);
    else if (a === 'mode') { const d = V.docs.get(p); d.mode = { edit: 'split', split: 'read', read: 'edit' }[d.mode] || 'edit'; localStorage.setItem('autodoku.mdmode', d.mode); renderFile(); }
    else if (a === 'save-pdf') savePdf(p);
    else if (a === 'zoom-in' || a === 'zoom-out') { if (V.pdf) { V.pdf.viewer.currentScale = Math.max(0.3, Math.min(4, V.pdf.viewer.currentScale * (a === 'zoom-in' ? 1.15 : 1 / 1.15))); } }
    else if (a === 'docx-md') docxToMd(p);
  }

  // ---------- Markdown ----------
  async function loadDoc(p) {
    let d = V.docs.get(p);
    if (!d) {
      const c = await read(p);
      const wide = innerWidth > 1250;
      d = { content: c, saved: c, dirty: false, mode: localStorage.getItem('autodoku.mdmode') || (wide ? 'split' : 'read') };
      V.docs.set(p, d);
    }
    if (V.forceMode) { d.mode = V.forceMode === 'edit' && innerWidth > 1250 ? 'split' : V.forceMode; V.forceMode = null; }
    return d;
  }

  function resolveFor(p) {
    return (src) => {
      if (/^(https?:|data:)/.test(src)) return { url: src };
      let target = src.startsWith('vault:') ? src.slice(6) : decodeURIComponent(src);
      target = target.replace(/^\.\//, '');
      const r = resolveLink(target, p) || resolveLink(join(dirName(p), target), p);
      if (!r) return { url: '', kind: 'file', label: target + ' (fehlt)', path: '' };
      const k = kindOf(r);
      if (k === 'image') return { url: url(r) };
      if (k === 'video') return { url: url(r), kind: 'video' };
      if (k === 'audio') return { url: url(r), kind: 'audio' };
      if (k === 'pdf') return { kind: 'pdf', path: r, label: baseName(r) };
      if (k === 'md') return { kind: 'note', path: r, label: stem(r) };
      return { kind: 'file', path: r, label: baseName(r) };
    };
  }

  async function renderMarkdown(p, tools, body, common) {
    const d = await loadDoc(p);
    const modeLabel = { edit: '✏️ Bearbeiten', split: '◫ Geteilt', read: '👁 Lesen' }[d.mode];
    tools.innerHTML = `<button class="btn tiny" data-ft="mode" title="Ansicht wechseln (Strg+E)">${modeLabel}</button><button class="btn tiny ghost" data-ft="word" title="Als Word-Dokument exportieren">⬇ Word</button>${common}`;
    body.innerHTML = `<div class="md-pane mode-${d.mode}">
      <textarea class="md-src" id="md-src" spellcheck="true">${esc(d.content)}</textarea>
      <article class="paper md-preview" id="md-prev"></article></div>`;
    const ta = $('#md-src'), prev = $('#md-prev');
    const renderPrev = () => {
      prev.innerHTML = root.MD.toHtml(root.MD.parse(d.content), { resolveImage: resolveFor(p), mathActions: true }) || '<p class="muted">Leere Notiz – schreib links los.</p>';
    };
    renderPrev();
    let prevTimer = null;
    ta.oninput = () => {
      d.content = ta.value; d.dirty = d.content !== d.saved;
      markTab(p, d.dirty);
      clearTimeout(prevTimer); prevTimer = setTimeout(renderPrev, 180);
      clearTimeout(d.timer); d.timer = setTimeout(() => flushSave(p), 800);
    };
    ta.onkeydown = (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.oninput(); }
      if (e.key === 'Enter') { // Listen fortsetzen
        const s = ta.selectionStart, line = ta.value.slice(ta.value.lastIndexOf('\n', s - 1) + 1, s);
        const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
        if (m) {
          e.preventDefault();
          if (line.trim() === m[0].trim()) { ta.setRangeText('', s - line.length, s, 'end'); ta.oninput(); return; }
          let marker = m[2]; if (/\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.slice(-1);
          ta.setRangeText('\n' + m[1] + marker + ' ' + (m[3] ? '[ ] ' : ''), s, ta.selectionEnd, 'end'); ta.oninput();
        }
      }
    };
    ta.onpaste = async (e) => {
      const item = [...(e.clipboardData.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      const blob = item.getAsFile();
      const name = `Bild ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
      const ap = uniquePath(join(dirName(p), 'Anhänge', name));
      await write(ap, new Uint8Array(await blob.arrayBuffer()));
      ta.setRangeText(`![[${ap.slice(dirName(p) ? dirName(p).length + 1 : 0)}]]\n`, ta.selectionStart, ta.selectionEnd, 'end'); ta.oninput();
    };
    prev.onclick = (e) => onPreviewClick(e, p, d, ta);
    if (d.mode !== 'read') setTimeout(() => ta.focus(), 30);
  }

  function markTab(p, dirty) {
    const t = $(`.tab[data-tab="${CSS.escape(p)}"] span`);
    if (t) t.textContent = t.textContent.replace(/ •$/, '') + (dirty ? ' •' : '');
  }

  async function flushSave(p) {
    const d = V.docs.get(p); if (!d || d.content === d.saved) return;
    clearTimeout(d.timer);
    try { await write(p, d.content); d.saved = d.content; d.dirty = false; markTab(p, false); }
    catch (e) { UI().toast('Speichern fehlgeschlagen: ' + esc(e.message), 'err'); }
  }

  async function onPreviewClick(e, p, d, ta) {
    const w = e.target.closest('.wikilink');
    if (w) {
      e.preventDefault();
      const t = resolveLink(w.dataset.wiki, p);
      if (t) openFile(t); else if (await UI().confirmBox('Notiz anlegen?', `„${esc(w.dataset.wiki)}“ gibt es noch nicht. Anlegen?`, 'Anlegen')) newNote(dirName(p), w.dataset.wiki, `# ${w.dataset.wiki}\n\n`);
      return;
    }
    const ext = e.target.closest('.extlink');
    if (ext) {
      e.preventDefault();
      const href = ext.dataset.href;
      if (/^https?:/.test(href)) window.open(href, '_blank');
      else { const t = resolveLink(decodeURIComponent(href), p); if (t) openFile(t); }
      return;
    }
    const card = e.target.closest('[data-open]');
    if (card && card.dataset.open) return openFile(card.dataset.open);
    const tag = e.target.closest('.tag');
    if (tag) { const f = $('#sb-filter'); if (f) { f.value = tag.dataset.tag; } fullTextSearch(tag.dataset.tag); return; }
    const cb = e.target.closest('.cbx[data-line]');
    if (cb) {
      const lines = d.content.split('\n'); const i = +cb.dataset.line;
      if (lines[i] != null) {
        lines[i] = /\[ \]/.test(lines[i]) ? lines[i].replace('[ ]', '[x]') : lines[i].replace(/\[[xX]\]/, '[ ]');
        d.content = lines.join('\n'); ta.value = d.content; ta.oninput();
        $('#md-prev').innerHTML = root.MD.toHtml(root.MD.parse(d.content), { resolveImage: resolveFor(p), mathActions: true });
      }
      return;
    }
    const act = e.target.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'copy-mathcad' || a === 'copy-latex') {
        const tex = act.closest('[data-tex]').dataset.tex;
        await navigator.clipboard.writeText(a === 'copy-latex' ? tex : latexToMathcad(tex));
        UI().toast(a === 'copy-latex' ? 'LaTeX kopiert' : '📋 Mathcad-Schreibweise kopiert – in Mathcad Prime in einen Rechenbereich tippen/einfügen.', 'ok', 5000);
      } else if (a === 'copy-code') {
        await navigator.clipboard.writeText(act.closest('pre').querySelector('code').innerText);
        UI().toast('Code kopiert', 'ok');
      }
      return;
    }
    const img = e.target.closest('figure img, .media-img');
    if (img) UI().lightbox && UI().lightbox(img.src);
  }

  // LaTeX -> Mathcad-Prime-Eingabe (Tastenschreibweise)
  function latexToMathcad(tex) {
    let s = String(tex);
    const grp = (str, i) => { // {…} ab Position i
      let depth = 0, j = i;
      for (; j < str.length; j++) { if (str[j] === '{') depth++; else if (str[j] === '}') { depth--; if (!depth) break; } }
      return [str.slice(i + 1, j), j + 1];
    };
    const rep = (cmd, fn) => {
      let idx;
      while ((idx = s.indexOf(cmd)) >= 0) {
        let [a, n1] = grp(s, s.indexOf('{', idx));
        if (fn.length === 2) { const [b, n2] = grp(s, s.indexOf('{', n1)); s = s.slice(0, idx) + fn(a, b) + s.slice(n2); }
        else s = s.slice(0, idx) + fn(a) + s.slice(n1);
      }
    };
    rep('\\dfrac', (a, b) => `((${a})/(${b}))`); rep('\\frac', (a, b) => `((${a})/(${b}))`);
    rep('\\sqrt', (a) => `√(${a})`);
    rep('\\text', (a) => `"${a}"`); rep('\\mathrm', (a) => a); rep('\\vec', (a) => a + '→');
    const map = { '\\cdot': '*', '\\times': '*', '\\pm': '±', '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\infty': '∞', '\\to': '→', '\\Rightarrow': '⇒',
      '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\Delta': 'Δ', '\\varepsilon': 'ε', '\\epsilon': 'ε', '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\varphi': 'φ', '\\phi': 'φ', '\\omega': 'ω', '\\Omega': 'Ω',
      '\\left': '', '\\right': '', '\\,': '', '\\;': ' ', '\\quad': '  ', '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\ln': 'ln', '\\log': 'log', '\\exp': 'exp' };
    for (const [k, v] of Object.entries(map)) s = s.split(k).join(v);
    s = s.replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/_\{([^{}]*)\}/g, '.$1').replace(/_([A-Za-z0-9])/g, '.$1');
    s = s.replace(/[{}]/g, '').replace(/\\/g, '').replace(/&/g, '');
    // Definitionen: "x =" am Anfang -> "x:="
    s = s.replace(/^\s*([A-Za-zα-ωΑ-Ω][\w.]*(?:\([^)]*\))?)\s*=(?!=)/, '$1:=');
    return s.replace(/\s+/g, ' ').trim();
  }

  async function exportWord(p) {
    const d = V.docs.get(p);
    const md = d ? d.content : await read(p);
    const blocks = root.MD.parse(md).filter(b => b.type !== 'frontmatter');
    const firstH = blocks.find(b => b.type === 'h');
    const title = firstH ? firstH.text : stem(p);
    const rest = firstH && blocks.indexOf(firstH) === 0 ? blocks.slice(1) : blocks;
    // Bilder für Word laden
    const images = {};
    let n = 0;
    for (const b of rest) {
      if (b.type !== 'img' || /^(search:|img:)/.test(b.src)) continue;
      const r = resolveFor(p)(b.src);
      if (!r.url) continue;
      try {
        const im = await root.Images.toJpeg(r.url, 1600, 0.88);
        const id = 'v' + (++n); images[id] = { dataUrl: im.dataUrl, w: im.w, h: im.h, caption: b.alt || '' };
        b.src = 'img:' + id;
      } catch (e) { /* Bild fehlt */ }
    }
    const shift = (bl) => bl.map(b => b.type === 'h' ? Object.assign({}, b, { level: Math.max(1, b.level - 1) }) : b.type === 'callout' ? Object.assign({}, b, { blocks: shift(b.blocks) }) : b);
    const folder = dirName(p).split('/')[0] || V.name;
    const blob = await root.DocxBuilder.buildDocx({
      blocks: [{ type: 'titleblock', subject: folder, emoji: '📝', date: new Date().toLocaleDateString('de-AT'), title, meta: ['AutoDoku'] }, ...shift(rest)],
      accent: '#4F46E5', images, header: `AutoDoku · ${title}`.slice(0, 100), footer: folder, title,
    });
    const out = uniquePath(join(dirName(p), stem(p) + '.docx'));
    await write(out, new Uint8Array(await blob.arrayBuffer()));
    API.openExternal(out);
    UI().toast(`📄 ${esc(baseName(out))} gespeichert – öffnet in Word`, 'ok');
  }

  // ---------- Text & Code ----------
  async function renderCode(p, tools, body, common, k) {
    const d = await loadDoc(p);
    if (!['edit', 'read'].includes(d.mode)) d.mode = 'read';
    tools.innerHTML = `<button class="btn tiny" data-ft="mode">${d.mode === 'edit' ? '👁 Ansehen' : '✏️ Bearbeiten'}</button>${common}`;
    tools.querySelector('[data-ft="mode"]').onclick = (e) => { e.stopPropagation(); d.mode = d.mode === 'edit' ? 'read' : 'edit'; renderFile(); };
    if (d.mode === 'edit') {
      body.innerHTML = `<textarea class="code-src" id="code-src" spellcheck="false">${esc(d.content)}</textarea>`;
      const ta = $('#code-src');
      ta.oninput = () => { d.content = ta.value; d.dirty = d.content !== d.saved; markTab(p, d.dirty); clearTimeout(d.timer); d.timer = setTimeout(() => flushSave(p), 800); };
      ta.onkeydown = (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.oninput(); } };
      ta.focus();
    } else {
      let html = esc(d.content);
      if (root.hljs && k === 'code') { try { const e = extOf(p); html = root.hljs.getLanguage(e) ? root.hljs.highlight(d.content, { language: e }).value : root.hljs.highlightAuto(d.content).value; } catch (x) { /* ohne Farben */ } }
      body.innerHTML = `<pre class="code-view hljs"><code>${html}</code></pre>`;
    }
  }

  // ---------- PDF ----------
  let pdfjsP = null;
  async function pdfjs() {
    if (!pdfjsP) pdfjsP = (async () => {
      const base = new URL('vendor/pdfjs/', location.href).href;
      const lib = await import(base + 'pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      root.pdfjsLib = lib;
      const viewer = await import(base + 'pdf_viewer.mjs');
      if (!$('#pdfjs-css')) { const l = document.createElement('link'); l.id = 'pdfjs-css'; l.rel = 'stylesheet'; l.href = base + 'pdf_viewer.css'; document.head.appendChild(l); }
      return { lib, viewer, base };
    })();
    return pdfjsP;
  }
  function destroyPdf() { if (V.pdf) { try { V.pdf.task.destroy(); } catch (e) { /* egal */ } V.pdf = null; } }

  async function renderPdf(p, tools, body, extra) {
    tools.innerHTML = `<span class="muted small" id="pdf-info"></span><button class="btn tiny ghost" data-ft="zoom-out">−</button><button class="btn tiny ghost" data-ft="zoom-in">+</button><button class="btn tiny primary" data-ft="save-pdf" id="pdf-save" disabled>💾 Speichern</button>${extra}`;
    body.innerHTML = '<div class="pdf-outer"><div class="pdf-container" id="pdf-container"><div id="pdf-viewer" class="pdfViewer"></div></div></div>';
    const { lib, viewer, base } = await pdfjs();
    const container = $('#pdf-container');
    const eventBus = new viewer.EventBus();
    const linkService = new viewer.PDFLinkService({ eventBus });
    const pv = new viewer.PDFViewer({ container, eventBus, linkService, annotationMode: lib.AnnotationMode.ENABLE_FORMS, textLayerMode: 1, removePageBorders: false });
    linkService.setViewer(pv);
    const task = lib.getDocument({ url: url(p), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
    const doc = await task.promise;
    V.pdf = { doc, task, viewer: pv, path: p };
    pv.setDocument(doc); linkService.setDocument(doc, null);
    eventBus.on('pagesinit', () => { pv.currentScaleValue = 'page-width'; });
    $('#pdf-info').textContent = `${doc.numPages} Seite${doc.numPages > 1 ? 'n' : ''}`;
    doc.annotationStorage.onSetModified = () => { const b = $('#pdf-save'); if (b) { b.disabled = false; b.textContent = '💾 Speichern •'; } };
    let fields = null; try { fields = await doc.getFieldObjects(); } catch (e) { /* egal */ }
    if (fields && Object.keys(fields).length) UI().toast('📝 Dieses PDF hat Formularfelder – einfach reinklicken und ausfüllen, dann 💾 Speichern.', 'ok', 6000);
  }

  async function savePdf(p) {
    if (!V.pdf || V.pdf.path !== p) return;
    try {
      const data = await V.pdf.doc.saveDocument();
      await write(p, data);
      const b = $('#pdf-save'); if (b) { b.disabled = true; b.textContent = '💾 Gespeichert'; }
      UI().toast('PDF gespeichert ✓', 'ok');
    } catch (e) { UI().toast('PDF speichern: ' + esc(e.message), 'err'); }
  }

  // ---------- Word ----------
  async function renderDocx(p, tools, body, extra) {
    tools.innerHTML = `<button class="btn tiny" data-ft="docx-md" title="Inhalt als Markdown-Notiz speichern">→ MD</button>${extra}`;
    body.innerHTML = '<article class="paper docx-prev" id="docx-prev"><div class="spinner"></div></article>';
    const buf = await readBinary(p);
    const r = await root.mammoth.convertToHtml({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    $('#docx-prev').innerHTML = r.value || '<p class="muted">Leeres Dokument</p>';
  }
  async function docxToMd(p) {
    const buf = await readBinary(p);
    const r = await root.mammoth.convertToMarkdown({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    const out = uniquePath(join(dirName(p), stem(p) + '.md'));
    await write(out, `# ${stem(p)}\n\n${r.value.replace(/\\([.()\-#!])/g, '$1')}\n`);
    openFile(out);
  }

  // ---------- Schnellsuche (Strg+O / Strg+P) ----------
  function quickSwitcher() {
    if (!V.root) return;
    const m = UI().modal({ title: '🔎 Datei öffnen', body: '<input class="input" id="qs-in" placeholder="Name eintippen …" autocomplete="off"><div class="qs-list" id="qs-list"></div>' });
    const inp = $('#qs-in', m.el), list = $('#qs-list', m.el);
    let sel = 0, hits = [];
    const score = (f, q) => { const n = f.path.toLowerCase(); if (!q) return 1; let i = 0, s = 0; for (const ch of q) { const j = n.indexOf(ch, i); if (j < 0) return -1; s += j - i; i = j + 1; } return 1000 - s - n.length * 0.1 + (n.includes(q) ? 500 : 0); };
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      hits = V.files.filter(f => f.type === 'file').map(f => [f, score(f, q)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1] || b[0].mtime - a[0].mtime).slice(0, 30).map(x => x[0]);
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      list.innerHTML = hits.map((f, i) => `<div class="qs-hit ${i === sel ? 'on' : ''}" data-i="${i}">${ICON[kindOf(f.path)]} <b>${esc(kindOf(f.path) === 'md' ? stem(f.path) : f.name)}</b> <small>${esc(dirName(f.path))}</small></div>`).join('') || (q ? `<div class="qs-hit" data-new="1">📝 Neue Notiz „${esc(inp.value.trim())}“ anlegen</div>` : '');
    };
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel++; draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { if (hits[sel]) { m.close(); openFile(hits[sel].path); } else if (inp.value.trim()) { m.close(); newNote(currentFolder(), inp.value.trim()); } }
    };
    list.onclick = (e) => { const h = e.target.closest('.qs-hit'); if (!h) return; m.close(); if (h.dataset.new) newNote(currentFolder(), inp.value.trim()); else openFile(hits[+h.dataset.i].path); };
    draw(); setTimeout(() => inp.focus(), 30);
  }

  document.addEventListener('keydown', (e) => {
    if (!API || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'o' || k === 'p') { e.preventDefault(); quickSwitcher(); }
    else if (k === 's' && V.active) { e.preventDefault(); if (kindOf(V.active) === 'pdf') savePdf(V.active); else flushSave(V.active); }
    else if (k === 'e' && V.active && kindOf(V.active) === 'md') { e.preventDefault(); toolAction('mode', V.active); }
    else if (k === 'n' && V.root) { e.preventDefault(); newNote(currentFolder()); }
    else if (k === 'w' && V.active) { e.preventDefault(); closeTab(V.active); }
  });
  window.addEventListener('beforeunload', () => { for (const [p, d] of V.docs) if (d.dirty) { V.selfWrites.set(p, Date.now()); API && API.write(p, d.content); } });

  root.Vault = { V, available: !!API, init, show, refresh, renderSidebar, openFile, newNote, write, read, readBinary, uniquePath, resolveLink,
    kindOf, extOf, baseName, dirName, stem, join, url, safeName, ICON, latexToMathcad, exportWord };
})(window);
