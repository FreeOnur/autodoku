/* AutoDoku – Handy-Seite: Tafel-Kamera & Mikrofon für den Laptop
 * Alles, was verschickt werden soll, landet zuerst in einer Warteschlange (IndexedDB) und wird
 * gesendet, sobald der Laptop erreichbar ist – nichts geht verloren, wenn der Laptop zu ist. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---------- Verbindungscode ----------
  let token = (location.hash || '').replace(/^#/, '');
  if (token) { try { localStorage.setItem('ad.token', token); } catch (e) { /* egal */ } history.replaceState(null, '', location.pathname); }
  else { try { token = localStorage.getItem('ad.token') || ''; } catch (e) { token = ''; } }
  if (!token) $('nocode').style.display = '';

  // ---------- Warteschlange (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('autodoku-phone', 1); r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('q', mode); const r = fn(t.objectStore('q')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  const qAdd = (item) => tx('readwrite', s => s.add(item)).then(updQ);
  const qFirst = () => db().then(d => new Promise((res) => { const r = d.transaction('q').objectStore('q').openCursor(); r.onsuccess = () => res(r.result ? r.result.value : null); r.onerror = () => res(null); }));
  const qDel = (id) => tx('readwrite', s => s.delete(id));
  const qCount = () => db().then(d => new Promise((res) => { const r = d.transaction('q').objectStore('q').count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); }));
  async function updQ() {
    const n = await qCount();
    $('q').textContent = n ? `📤 ${n} wartend${online ? ' – wird gesendet …' : ' – Laptop nicht erreichbar, bleibt gespeichert'}` : 'Warteschlange leer ✓';
  }

  // ---------- Verbindung ----------
  let online = false, info = null;
  async function api(path, opts) {
    return fetch(path, Object.assign({ cache: 'no-store' }, opts, { headers: Object.assign({ 'x-autodoku-token': token }, (opts && opts.headers) || {}) }));
  }
  async function ping() {
    if (!token) return;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
      const r = await api('/api/ping', { signal: ctl.signal }); clearTimeout(t);
      if (r.status === 401) { setSt('off', 'Code ungültig – neu scannen'); online = false; return; }
      info = await r.json(); online = true;
      setSt('on', info.recording && !rec ? `${info.name} · Laptop nimmt auf (${info.subject})` : `${info.name} verbunden`);
      fillSubjects();
      const w = $('mic-warn');
      if (info.recording && !rec) { w.style.display = ''; w.textContent = '⚠️ Der Laptop nimmt schon selbst auf – eine Handy-Aufnahme wird eine eigene Stunde.'; } else w.style.display = 'none';
    } catch (e) { online = false; setSt('off', 'Laptop nicht erreichbar – Fotos/Aufnahmen werden gespeichert'); }
    updQ();
  }
  function setSt(cls, t) { $('st').className = 'st ' + cls; $('st-t').textContent = t; }
  function fillSubjects() {
    const sel = $('subject');
    if (!info || !info.subjects || sel.dataset.filled) return;
    let last = ''; try { last = localStorage.getItem('ad.subject') || ''; } catch (e) { /* egal */ }
    sel.innerHTML = '<option value="">Fach wählen …</option>' + info.subjects.map(s => `<option value="${s.id}" ${s.id === last ? 'selected' : ''}>${s.emoji || ''} ${s.name}</option>`).join('');
    sel.dataset.filled = '1';
  }
  $('subject').onchange = () => { try { localStorage.setItem('ad.subject', $('subject').value); } catch (e) { /* egal */ } };

  // Sender: immer das älteste Element zuerst (Reihenfolge bleibt erhalten)
  let sending = false;
  async function pump() {
    if (sending || !online || !token) return;
    sending = true;
    try {
      for (;;) {
        const it = await qFirst();
        if (!it) break;
        let r;
        if (it.kind === 'photo') r = await api(`/api/photo?ts=${it.ts}&auto=${it.auto ? 1 : 0}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: it.blob });
        else if (it.kind === 'audio') r = await api(`/api/audio?rec=${it.rec}&seq=${it.seq}&start=${it.start}&subject=${encodeURIComponent(it.subject)}&last=${it.last ? 1 : 0}`, { method: 'POST', headers: { 'content-type': it.mime || 'audio/webm' }, body: it.blob });
        else if (it.kind === 'cmd') r = await api('/api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(it.data) });
        if (!r || !r.ok) { if (r && r.status === 401) online = false; break; }
        await qDel(it.id);
        updQ();
      }
    } catch (e) { online = false; }
    sending = false;
    updQ();
  }
  setInterval(() => { ping().then(pump); }, 4000);
  ping().then(pump);
  $('retry').onclick = () => ping().then(pump);

  // ---------- Bildschirm anlassen ----------
  let wake = null;
  async function keepAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { /* nicht unterstützt */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (camOn || rec)) keepAwake(true); });

  // ---------- Tabs ----------
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
  });

  // ---------- Kamera ----------
  const video = $('video');
  let camOn = false, stream = null;
  const canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  async function startCam() {
    if (!canCam) { $('file').click(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream; await video.play();
      camOn = true; $('shot').disabled = false; $('cam-on').textContent = 'Kamera aus'; $('cam-badge').textContent = 'Live';
      keepAwake(true);
    } catch (e) { $('cam-badge').textContent = 'Kamera blockiert – erlauben oder 📸 nutzen'; $('shot').disabled = false; }
  }
  function stopCam() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; camOn = false; $('cam-on').textContent = 'Kamera starten'; $('cam-badge').textContent = 'Kamera aus'; $('auto').checked = false; if (!rec) keepAwake(false); }
  $('cam-on').onclick = () => (camOn ? stopCam() : startCam());

  function grab(w) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return null;
    const c = document.createElement('canvas');
    const scale = Math.min(1, w / vw);
    c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  async function sendPhoto(blob, auto) {
    await qAdd({ kind: 'photo', blob, ts: Date.now(), auto: !!auto });
    const u = URL.createObjectURL(blob);
    const img = document.createElement('img'); img.src = u; $('thumbs').prepend(img);
    while ($('thumbs').children.length > 12) $('thumbs').lastChild.remove();
    $('flash').style.opacity = '.7'; setTimeout(() => { $('flash').style.opacity = '0'; }, 120);
    if (navigator.vibrate) navigator.vibrate(30);
    pump();
  }
  async function shoot(auto) {
    if (!camOn) { if (!auto) $('file').click(); return; }
    const c = grab(2400); if (!c) return;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    if (blob) sendPhoto(blob, auto);
  }
  $('shot').onclick = () => shoot(false);
  $('file').onchange = () => { const f = $('file').files[0]; if (f) sendPhoto(f, false); $('file').value = ''; };

  // Automatik: kleines Graustufenbild vergleichen; senden, wenn sich die Tafel deutlich geändert hat
  // und das Bild wieder ruhig ist (Lehrer nicht mehr davor / Kamera nicht in Bewegung)
  let lastSent = null, prev = null, stableSince = 0;
  function sig() {
    const c = grab(48); if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const g = new Float32Array(d.length / 4);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    return g;
  }
  const diff = (a, b) => { if (!a || !b || a.length !== b.length) return 999; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  setInterval(() => {
    if (!camOn || !$('auto').checked) return;
    const now = sig(); if (!now) return;
    const moving = diff(now, prev) > 4; prev = now;
    if (moving) { stableSince = Date.now(); $('cam-badge').textContent = 'Auto · wartet auf ruhiges Bild'; return; }
    if (Date.now() - stableSince < 2500) return;
    const change = diff(now, lastSent);
    if (change > 9) { lastSent = now; shoot(true); $('cam-badge').textContent = 'Auto · Foto gesendet'; }
    else $('cam-badge').textContent = 'Auto · Tafel unverändert';
  }, 1200);

  // ---------- Mikrofon ----------
  let rec = null; // { id, subject, seq, start, mr, stream, timer, chunkStart }
  const CHUNK_MS = 15000;
  function pickMime() {
    const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const m of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  function newRecorder() {
    const mime = pickMime();
    const mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const parts = []; const chunkStart = Date.now(); const seq = rec.seq++;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    mr.onstop = async () => {
      if (!parts.length) return;
      const blob = new Blob(parts, { type: mr.mimeType || mime || 'audio/webm' });
      await qAdd({ kind: 'audio', rec: mr._rec, seq, start: chunkStart, subject: mr._subject, mime: blob.type, blob, last: !!mr._last });
      pump();
    };
    mr._rec = rec.id; mr._subject = rec.subject;
    mr.start();
    return mr;
  }
  async function startRec() {
    const subject = $('subject').value;
    if (!subject) { alert('Bitte zuerst das Fach wählen.'); return; }
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { alert('Mikrofon blockiert – in den Browser-Einstellungen erlauben.'); return; }
    rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject, seq: 0, start: Date.now(), stream: s };
    await qAdd({ kind: 'cmd', data: { cmd: 'start', rec: rec.id, subject, start: rec.start } });
    rec.mr = newRecorder();
    rec.timer = setInterval(() => { // alle 15 s ein vollständiges Stück (jedes Stück einzeln abspielbar)
      const old = rec.mr; rec.mr = newRecorder(); old.stop();
    }, CHUNK_MS);
    rec.tick = setInterval(renderRec, 500);
    keepAwake(true); renderRec(); pump();
  }
  async function stopRec() {
    if (!rec) return;
    const r = rec;
    clearInterval(r.timer); clearInterval(r.tick);
    r.mr._last = true;
    await new Promise(res => { r.mr.addEventListener('stop', () => setTimeout(res, 50), { once: true }); r.mr.stop(); });
    r.stream.getTracks().forEach(t => t.stop());
    await qAdd({ kind: 'cmd', data: { cmd: 'stop', rec: r.id } });
    rec = null; renderRec(); if (!camOn) keepAwake(false); pump();
  }
  function renderRec() {
    const b = $('rec');
    b.classList.toggle('on', !!rec); b.textContent = rec ? 'Stopp' : 'Start';
    const s = rec ? Math.floor((Date.now() - rec.start) / 1000) : 0;
    $('time').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    $('subject').disabled = !!rec;
  }
  $('rec').onclick = () => (rec ? stopRec() : startRec());
  window.addEventListener('beforeunload', (e) => { if (rec) { e.preventDefault(); e.returnValue = ''; } });
  if (!window.isSecureContext) { $('mic-warn').style.display = ''; $('mic-warn').textContent = 'Diese Seite ist nicht sicher geöffnet – Kamera-Livebild und Mikrofon gehen nur über https:// (die Adresse aus dem QR-Code).'; }
  updQ();
})();
