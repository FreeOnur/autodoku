/* AutoDoku – Desktop-Brücke (nur in der Desktop-App)
 * - meldet den Aufnahme-Zustand an Mini-Fenster & Infobereich
 * - Befehle von Tastenkürzeln / Mini-Fenster (Aufnahme an/aus, Schnellnotiz)
 * - Handy: Tafelfotos & Audio-Stücke vom Handy übernehmen */
(function (root) {
  'use strict';
  const D = root.desktopAPI;
  if (!D) { root.DesktopBridge = null; return; }
  const A = () => root.AutoDoku;
  const { Settings, Subjects, Sessions } = root.Store;
  const UI = () => root.UI;
  const esc = (s) => root.MD.escHtml(s == null ? '' : s);

  // ---------- Zustand ----------
  const phone = { recs: {}, queue: [], busy: false, lastAudio: 0 };
  const phoneActive = () => Object.values(phone.recs).some(r => !r.stopped) && Date.now() - phone.lastAudio < 120000;

  function state() {
    const app = A(); if (!app) return {};
    const st = app.st, s = st.session;
    const rec = !!(st.live && st.live.recording);
    const sub = s ? Subjects.get(s.subjectId) : null;
    return {
      recording: rec, ms: s ? app.curRecMs(s) : 0, subject: sub ? sub.name : '', title: s ? (s.title || '') : '',
      lessonOpen: !!(s && s.kind === 'lesson'), phoneRec: phoneActive(),
      subjects: Subjects.all().map(x => ({ id: x.id, name: x.name, emoji: x.emoji })),
    };
  }
  let lastKey = '';
  function push(force) {
    const s = state();
    const key = JSON.stringify(Object.assign({}, s, { ms: Math.floor((s.ms || 0) / 10000) }));
    if (force || key !== lastKey) { lastKey = key; D.sendState(s); }
  }
  setInterval(push, 1000);

  // ---------- Befehle ----------
  D.onCmd(async (c) => {
    const app = A(); if (!app) return;
    const st = app.st;
    if (c.cmd === 'toggleRec') {
      if (st.live && st.live.recording) { app.stopRecording(); push(true); return; }
      const s = st.session;
      if (s && s.kind === 'lesson') {
        if (!location.hash.includes(s.id)) location.hash = '#/stunde/' + s.id;
        setTimeout(() => { app.startRecording(); push(true); }, 300);
        return;
      }
      const last = localStorage.getItem('autodoku.lastSubject');
      if (last && Subjects.all().some(x => x.id === last)) { await app.startLesson(last); setTimeout(() => push(true), 800); }
      else { D.miniCmd({ cmd: 'show' }); UI().toast('Wähle ein Fach, um die Aufnahme zu starten.', 'warn'); }
    } else if (c.cmd === 'note') {
      const text = String(c.text || '').trim(); if (!text) return;
      const s = st.session;
      if (s && s.kind === 'lesson') {
        const x = { t: app.curRecMs(s), text, kind: 'note' };
        s.segments.push(x); app.save(s); if (location.hash.includes(s.id)) app.appendSeg(x);
        D.notify({ title: 'Notiz gespeichert', body: text.slice(0, 80) });
      } else if (root.Vault && root.Vault.V.root) {
        const p = '_Eingang/Schnellnotizen.md';
        let md = ''; try { md = await root.Vault.read(p); } catch (e) { md = '# Schnellnotizen\n'; }
        await root.Vault.write(p, md.trimEnd() + `\n- ${new Date().toLocaleString('de-AT')}: ${text}\n`);
        D.notify({ title: 'Schnellnotiz gespeichert', body: '_Eingang/Schnellnotizen.md' });
      }
    }
  });
  // zuletzt benutztes Fach merken (für Strg+Alt+R ohne offene Stunde)
  setInterval(() => { const s = A() && A().st.session; if (s && s.kind === 'lesson') localStorage.setItem('autodoku.lastSubject', s.subjectId); }, 5000);

  // ---------- Handy ----------
  D.onPhone((kind, d) => { phone.queue.push({ kind, d }); work(); });

  async function work() {
    if (phone.busy) return;
    phone.busy = true;
    try {
      while (phone.queue.length) {
        const { kind, d } = phone.queue.shift();
        try {
          if (kind === 'photo') await onPhoto(d);
          else if (kind === 'audio') await onAudio(d);
          else if (kind === 'cmd') await onCmd(d);
        } catch (e) { console.error('Handy', e); UI().toast('Handy: ' + esc(e.message), 'err', 6000); }
      }
    } finally { phone.busy = false; push(true); }
  }

  // Foto -> laufende/offene Stunde, sonst in den Notizordner (_Eingang) und automatisch umwandeln
  async function onPhoto(d) {
    const app = A(), st = app.st;
    const file = new File([d.bytes], `Tafel ${new Date(d.ts).toLocaleTimeString('de-AT').replace(/:/g, '-')}.jpg`, { type: d.mime || 'image/jpeg' });
    const openRec = Object.values(phone.recs).find(r => !r.stopped && r.sessionId);
    let s = null;
    if (openRec) s = await Sessions.get(openRec.sessionId);
    if (!s && st.session && st.session.kind === 'lesson' && ((st.live && st.live.recording) || Date.now() - (st.session.updatedAt || 0) < 15 * 60000)) s = st.session;
    if (s) {
      if (st.session && st.session.id === s.id) s = st.session;
      UI().toast('📱 Tafelfoto vom Handy …', 'ok', 2500);
      await app.addPhotos(s, [file]);
      return;
    }
    if (root.Vault && root.Vault.V.root) {
      const stamp = new Date(d.ts);
      const pad = (n) => String(n).padStart(2, '0');
      const p = root.Vault.uniquePath(`_Eingang/Tafel ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}.jpg`);
      await root.Vault.write(p, d.bytes);
      UI().toast('📱 Tafelfoto im Notizordner (_Eingang) – wird in Notizen umgewandelt', 'ok', 4000);
      if (root.Convert) root.Convert.enqueue(p);
    } else UI().toast('📱 Foto empfangen – öffne eine Stunde oder wähle einen Notizordner, damit es gespeichert wird.', 'warn', 6000);
  }

  async function sessionFor(recId, subjectId, start) {
    const app = A();
    let r = phone.recs[recId];
    if (r && r.sessionId) { const s = await Sessions.get(r.sessionId); if (s) return (app.st.session && app.st.session.id === s.id) ? app.st.session : s; }
    r = phone.recs[recId] = phone.recs[recId] || { start: start || Date.now() };
    const subId = Subjects.all().some(x => x.id === subjectId) ? subjectId : (Subjects.all()[0] || {}).id;
    const s = app.newSession(subId);
    s.createdAt = r.start; s.source = 'phone'; s.status = 'paused';
    await Sessions.put(s);
    r.sessionId = s.id;
    UI().toast(`📱 Handy-Aufnahme: neue Stunde ${esc(Subjects.get(subId).name)}`, 'ok', 5000);
    D.notify({ title: 'Handy-Aufnahme', body: Subjects.get(subId).name });
    return s;
  }

  async function onCmd(d) {
    if (d.cmd === 'start') { phone.recs[d.rec] = phone.recs[d.rec] || { start: d.start || Date.now() }; phone.lastAudio = Date.now(); await sessionFor(d.rec, d.subject, d.start); }
    else if (d.cmd === 'stop') {
      const r = phone.recs[d.rec]; if (!r) return;
      r.stopped = true;
      let s = r.sessionId && await Sessions.get(r.sessionId);
      if (!s) return;
      if (r.carry) s = await flushCarry(r, (A().st.session && A().st.session.id === s.id) ? A().st.session : s);
      // Rest einarbeiten und (wenn eingestellt) fertig polieren
      const set = Settings.get();
      if (root.AI.ready() && set.autoFinalize !== false && s.segments.length) {
        location.hash = '#/stunde/' + s.id;
        await new Promise(res => setTimeout(res, 700));
        const live = A().st.session && A().st.session.id === s.id ? A().st.session : s;
        await A().finalize(live);
      }
      D.notify({ title: 'Handy-Aufnahme fertig', body: (s.title || Subjects.get(s.subjectId).name) });
    }
  }

  const phoneLang = (s) => {
    const sub = Subjects.get(s.subjectId), set = Settings.get();
    return set.speechLang === 'auto' && !/^en/.test(sub.speechLang || '') ? 'auto' : (sub.speechLang || 'de').split('-')[0];
  };
  async function pushSegs(s, segs, offset) {
    const app = A();
    s = app.st.session && app.st.session.id === s.id ? app.st.session : (await Sessions.get(s.id)) || s;
    for (const x of segs) {
      const seg = { t: Math.round(offset + x.t * 1000), text: x.text, kind: 'speech', src: 'phone' };
      s.segments.push(seg);
      if (app.st.session === s && location.hash.includes(s.id)) app.appendSeg(seg);
    }
    return s;
  }
  // aufgehobenen Rest (nach der letzten Pause) allein transkribieren
  async function flushCarry(r, s) {
    const carry = r.carry; r.carry = null;
    if (!carry || carry.length < 3200) return s;
    const segs = await root.Whisper.transcribeLong(carry, phoneLang(s), null, { continued: true });
    s = await pushSegs(s, segs, r.carryOffset);
    await A().saveNow(s);
    return s;
  }

  async function onAudio(d) {
    phone.lastAudio = Date.now();
    const app = A();
    let s = await sessionFor(d.rec, d.subject, d.start);
    const r = phone.recs[d.rec];
    let audio;
    try { audio = await root.Whisper.decodeFile(d.bytes); } catch (e) { console.warn('Audio-Stück nicht lesbar', e); return; }
    const set = Settings.get();
    const lang = phoneLang(s);
    // Das Handy schneidet stur alle 15 s – oft mitten im Wort. Darum: Rest nach der letzten Pause
    // aufheben und vor das nächste Stück hängen (beim Stopp bzw. beim letzten Stück wird er mitgenommen).
    let offset = (d.start || r.start) - r.start;
    if (r.carry && r.carrySeq === d.seq - 1) {
      const joined = new Float32Array(r.carry.length + audio.length);
      joined.set(r.carry, 0); joined.set(audio, r.carry.length);
      offset = r.carryOffset;
      audio = joined;
      r.carry = null;
    } else if (r.carry) s = await flushCarry(r, s);
    const segs = await root.Whisper.transcribeLong(audio, lang, null, { keepTail: !d.last, continued: !!r.started });
    r.started = true;
    if (segs.tail && segs.tail.length) { r.carry = segs.tail; r.carrySeq = d.seq; r.carryOffset = offset + (audio.length - segs.tail.length) / 16; }
    s = await pushSegs(s, segs, offset);
    s.durationMs = Math.max(s.durationMs || 0, offset + audio.length / 16);
    await app.saveNow(s);
    // Live-Zusammenfassung wie bei der Laptop-Aufnahme
    const pending = s.segments.slice(s.cursor || 0).map(x => x.text).join(' ').split(/\s+/).filter(Boolean).length;
    if (root.AI.ready() && set.liveUpdates && pending >= set.minWords && !(app.st.live && app.st.live.busy)) {
      try { await app.liveUpdate(s, false); } catch (e) { /* egal */ }
    }
  }
  // ---------- „Handy verbinden“-Fenster mit QR-Code ----------
  function loadQr() {
    if (root.qrcode) return Promise.resolve();
    return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/qrcode/qrcode.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  }
  const rankIp = (u) => (/\/\/192\.168\./.test(u) ? 0 : /\/\/10\./.test(u) ? 1 : /\/\/172\.(1[6-9]|2\d|3[01])\./.test(u) ? 2 : 3);
  async function connectPhone() {
    const m = UI().modal({ title: '📱 Handy verbinden', wide: false, body: '<div class="spinner"></div>' });
    const r = await D.phoneStart();
    await loadQr().catch(() => null);
    if (!r.ok) { m.el.querySelector('.modal-body').innerHTML = `<p>Konnte die Handy-Verbindung nicht starten: ${esc(r.error)}</p>`; return; }
    const urls = r.urls.slice().sort((a, b) => rankIp(a) - rankIp(b));
    if (!urls.length) { m.el.querySelector('.modal-body').innerHTML = '<p>Kein WLAN gefunden. Verbinde den Laptop mit einem WLAN oder dem Handy-Hotspot.</p>'; return; }
    const qr = (u) => { if (!root.qrcode) return ''; const q = root.qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); };
    const body = m.el.querySelector('.modal-body');
    const draw = (u) => {
      body.innerHTML = `<div class="phone-connect">
        <div class="qr">${qr(u)}</div>
        <ol class="ob-steps small-steps">
          <li><b>Mit der Handy-Kamera scannen</b><span>Handy im selben WLAN wie der Laptop (Schul-WLAN blockiert das oft → Handy-Hotspot einschalten und den Laptop damit verbinden).</span></li>
          <li><b>„Verbindung nicht privat“ → Erweitert → Weiter</b><span>Das ist normal: Der Laptop hat ein eigenes Zertifikat. Die Verbindung ist trotzdem verschlüsselt.</span></li>
          <li><b>Kamera & Mikrofon erlauben</b><span>Tafel-Fotos und Aufnahmen gehen sofort an AutoDoku. Ist der Laptop zu, speichert das Handy alles und schickt es später.</span></li>
        </ol>
        <p class="muted small">Windows fragt beim ersten Mal, ob AutoDoku im <b>privaten Netzwerk</b> erreichbar sein darf → <b>Zulassen</b>.</p>
        ${urls.length > 1 ? `<p class="muted small">Andere Adressen: ${urls.map(x => `<a href="#" data-url="${esc(x)}">${esc(x.replace(/#.*/, '').replace('https://', ''))}</a>`).join(' · ')}</p>` : ''}
        <p class="muted small mono">${esc(u.replace(/#.*/, ''))}</p>
        <div class="row wrap"><button class="btn small ghost" id="ph-new">Neuen Code (altes Handy trennen)</button><button class="btn small ghost danger" id="ph-off">Handy-Verbindung ausschalten</button></div>
      </div>`;
      body.querySelectorAll('[data-url]').forEach(a => a.onclick = (e) => { e.preventDefault(); draw(a.dataset.url); });
      body.querySelector('#ph-new').onclick = async () => { const nu = (await D.phoneNewToken()).sort((a, b) => rankIp(a) - rankIp(b)); draw(nu[0]); UI().toast('Neuer Code – bitte am Handy neu scannen.', 'ok'); };
      body.querySelector('#ph-off').onclick = async () => { await D.phoneStop(); m.close(); UI().toast('Handy-Verbindung aus.'); };
    };
    draw(urls[0]);
  }

  root.DesktopBridge = { connectPhone, state, push, phone };
})(window);
