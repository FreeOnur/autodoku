/* AutoDoku – Speicher: IndexedDB für Stunden (inkl. Bilder), localStorage für Einstellungen & Fächer */
(function (root) {
  'use strict';

  const DB_NAME = 'autodoku';
  const DB_VERSION = 1;
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('sessions')) {
          const s = d.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('subjectId', 'subjectId');
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('sessions', mode);
      const st = t.objectStore('sessions');
      let result;
      Promise.resolve(fn(st)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  const Sessions = {
    async all() {
      const d = await db();
      const list = await reqP(d.transaction('sessions').objectStore('sessions').getAll());
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      const d = await db();
      return reqP(d.transaction('sessions').objectStore('sessions').get(id));
    },
    async put(s) {
      s.updatedAt = Date.now();
      return tx('readwrite', st => { st.put(s); });
    },
    async remove(id) {
      return tx('readwrite', st => { st.delete(id); });
    },
    async clear() {
      return tx('readwrite', st => { st.clear(); });
    },
  };

  // ---------- Einstellungen ----------
  const DEFAULT_SETTINGS = {
    apiKey: '',
    mode: 'spar',          // spar | normal | ende
    liveUpdates: true,     // false = nur Transkript, Zusammenfassung erst bei "Fertig"
    modelLive: 'claude-haiku-5-5',
    modelFinal: 'claude-haiku-5-5',
    interval: 90,          // Sekunden zwischen Live-Updates
    minWords: 50,          // min. neue Wörter für ein Update
    studentName: '',
    className: '',
    appendTranscript: false,
    suggestImages: true,
    maxImageSuggestions: 3,
    autoFinalize: true,
    keepAwake: true,
  };

  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* voll / privat */ }
  }

  // Sparstufen: setzen Modelle & Takt auf einmal
  const MODES = {
    spar: { label: '💸 Sparmodus', hint: 'Alles mit Haiku 5.5, Live-Update alle 90 s – ca. 1–3 Cent pro Stunde', liveUpdates: true, modelLive: 'claude-haiku-5-5', modelFinal: 'claude-haiku-5-5', interval: 90, minWords: 50 },
    normal: { label: '✨ Beste Qualität', hint: 'Live mit Haiku 5.5, „Fertig“ & Tafelfotos mit Sonnet 5.5 – ca. 5–12 Cent pro Stunde', liveUpdates: true, modelLive: 'claude-haiku-5-5', modelFinal: 'claude-sonnet-5-5', interval: 75, minWords: 45 },
    ende: { label: '🪙 Nur am Ende', hint: 'Während der Stunde nur Transkript, Zusammenfassung erst bei „Fertig“ (Haiku 5.5) – unter 1 Cent pro Stunde', liveUpdates: false, modelLive: 'claude-haiku-5-5', modelFinal: 'claude-haiku-5-5', interval: 90, minWords: 50 },
  };

  const Settings = {
    get() { return Object.assign({}, DEFAULT_SETTINGS, loadJSON('autodoku.settings', {})); },
    set(patch) { const s = Object.assign(Settings.get(), patch); saveJSON('autodoku.settings', s); return s; },
  };

  // ---------- Fächer ----------
  const DEFAULT_SUBJECTS = [
    { id: 'mathe', name: 'Mathematik', emoji: '📐', color: '#3B82F6', kind: 'math', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'swp', name: 'SWP / Programmieren', emoji: '💻', color: '#10B981', kind: 'code', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'physik', name: 'Physik', emoji: '⚛️', color: '#8B5CF6', kind: 'math', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'deutsch', name: 'Deutsch', emoji: '📖', color: '#EF4444', kind: 'text', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'englisch', name: 'Englisch', emoji: '🇬🇧', color: '#F59E0B', kind: 'lang', speechLang: 'en-GB', notesLang: 'Englisch (Vokabeln mit deutscher Übersetzung)' },
    { id: 'netzwerk', name: 'Netzwerktechnik', emoji: '🌐', color: '#06B6D4', kind: 'code', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'wirtschaft', name: 'Wirtschaft & Recht', emoji: '📊', color: '#EC4899', kind: 'text', speechLang: 'de-AT', notesLang: 'Deutsch' },
    { id: 'geschichte', name: 'Geschichte', emoji: '🏛️', color: '#A16207', kind: 'text', speechLang: 'de-AT', notesLang: 'Deutsch' },
  ];

  const Subjects = {
    all() { return loadJSON('autodoku.subjects', null) || DEFAULT_SUBJECTS.slice(); },
    save(list) { saveJSON('autodoku.subjects', list); },
    get(id) { return Subjects.all().find(s => s.id === id) || { id, name: 'Allgemein', emoji: '📝', color: '#64748B', kind: 'text', speechLang: 'de-AT', notesLang: 'Deutsch' }; },
    upsert(sub) {
      const list = Subjects.all();
      const i = list.findIndex(s => s.id === sub.id);
      if (i >= 0) list[i] = sub; else list.push(sub);
      Subjects.save(list);
    },
    remove(id) { Subjects.save(Subjects.all().filter(s => s.id !== id)); },
  };

  // ---------- Backup ----------
  async function exportAll() {
    return { app: 'AutoDoku', version: 1, exportedAt: new Date().toISOString(), subjects: Subjects.all(), sessions: await Sessions.all() };
  }
  async function importAll(data) {
    if (!data || data.app !== 'AutoDoku') throw new Error('Keine AutoDoku-Sicherung');
    if (Array.isArray(data.subjects)) Subjects.save(data.subjects);
    for (const s of data.sessions || []) await Sessions.put(s);
    return (data.sessions || []).length;
  }

  const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Gesamtkosten (nur Anzeige)
  const Spend = {
    get() { return loadJSON('autodoku.spend', { input: 0, output: 0, cost: 0, since: Date.now() }); },
    add(u) { const s = Spend.get(); s.input += u.input || 0; s.output += u.output || 0; s.cost += u.cost || 0; saveJSON('autodoku.spend', s); return s; },
    reset() { saveJSON('autodoku.spend', { input: 0, output: 0, cost: 0, since: Date.now() }); },
  };

  root.Store = { Sessions, Settings, Subjects, Spend, MODES, exportAll, importAll, uid, DEFAULT_SUBJECTS };
})(window);
