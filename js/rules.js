/* AutoDoku – Regeln, Fachbegriff-Notizen & Profile zum Teilen
 * - Fachbegriffe aus <terms> werden zu eigenen Notizen in "Begriffe/<Begriff>.md" (mit Rückverweis)
 * - Profil exportieren/importieren: Fächer, Fachbegriffe, Regeln, KI-Anbieter (Schlüssel nur auf Wunsch)
 *   -> an Kollegen schicken, die tragen nur noch ihren eigenen Schlüssel ein. */
(function (root) {
  'use strict';

  const V = () => root.Vault;
  const S = () => root.Store.Settings;

  function parseTerms(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.replace(/^\s*[-*\d.)]+\s*/, '').trim();
      const i = line.indexOf('|');
      if (i < 1) continue;
      const term = line.slice(0, i).replace(/\[\[|\]\]|\*\*/g, '').trim();
      const expl = line.slice(i + 1).trim();
      if (!term || term.length > 60 || expl.length < 8 || /^begriff$/i.test(term)) continue;
      if (!out.some(t => t.term.toLowerCase() === term.toLowerCase())) out.push({ term, expl });
    }
    return out.slice(0, 20);
  }

  // Begriffe-Notizen anlegen/ergänzen. source = Pfad der Notiz, aus der die Begriffe stammen
  async function writeTerms(text, { subject, source } = {}) {
    const vault = V();
    if (!vault || !vault.available || !vault.V.root) return 0;
    const set = S().get();
    if (!set.termNotes) return 0;
    const folder = vault.safeName(set.termFolder || 'Begriffe');
    const terms = parseTerms(text);
    const srcLink = source ? vault.stem(source) : '';
    let n = 0;
    for (const { term, expl } of terms) {
      const name = vault.safeName(term);
      // gibt es den Begriff schon irgendwo (auch andere Schreibweise)?
      const existing = vault.resolveLink(name, '') || vault.join(folder, name + '.md');
      let md = null;
      try { md = await vault.read(existing); } catch (e) { md = null; }
      if (md == null) {
        md = `---\ntags: [begriff${subject ? ', ' + subject.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-') : ''}]\nfach: ${subject || ''}\nerstellt: ${new Date().toISOString().slice(0, 10)}\n---\n# ${term}\n\n${expl}\n\n## Vorkommen\n${srcLink ? `- [[${srcLink}]]\n` : ''}`;
        await vault.write(existing, md);
        n++;
      } else if (srcLink && !md.includes(`[[${srcLink}]]`)) {
        md = /## Vorkommen/.test(md) ? md.replace(/## Vorkommen\n/, `## Vorkommen\n- [[${srcLink}]]\n`) : md.trimEnd() + `\n\n## Vorkommen\n- [[${srcLink}]]\n`;
        await vault.write(existing, md);
      }
    }
    if (n) await vault.refresh();
    return n;
  }

  // ---------- Profil ----------
  const SHARE_KEYS = ['provider', 'oaPreset', 'oaBase', 'oaModel', 'oaModelLive', 'oaVision', 'groqModel', 'localPower', 'ollamaModel', 'mode', 'liveUpdates', 'modelLive', 'modelFinal',
    'interval', 'minWords', 'speechEngine', 'speechLang', 'whisperModel', 'glossary', 'ruleNotes', 'ruleListen', 'ruleIgnore', 'ignoreJokes', 'termNotes', 'termFolder',
    'suggestImages', 'maxImageSuggestions', 'appendTranscript', 'vaultSync', 'vaultTranscript', 'autoConvert'];
  const KEY_KEYS = ['apiKey', 'geminiKey', 'oaKey', 'groqKey'];

  function exportProfile(withKeys) {
    const set = S().get();
    const settings = {};
    for (const k of SHARE_KEYS) settings[k] = set[k];
    if (withKeys) for (const k of KEY_KEYS) settings[k] = set[k];
    return { app: 'AutoDoku', kind: 'profil', version: 1, exportedAt: new Date().toISOString(), settings, subjects: root.Store.Subjects.all() };
  }

  function importProfile(data, { replaceSubjects } = {}) {
    if (!data || data.app !== 'AutoDoku' || data.kind !== 'profil') throw new Error('Keine AutoDoku-Profildatei');
    const patch = {};
    for (const k of SHARE_KEYS.concat(KEY_KEYS)) if (data.settings && data.settings[k] !== undefined && data.settings[k] !== '') patch[k] = data.settings[k];
    S().set(patch);
    if (Array.isArray(data.subjects)) {
      if (replaceSubjects) root.Store.Subjects.save(data.subjects);
      else data.subjects.forEach(sub => root.Store.Subjects.upsert(sub));
    }
    return { settings: Object.keys(patch).length, subjects: (data.subjects || []).length, keys: KEY_KEYS.some(k => patch[k]) };
  }

  root.Rules = { parseTerms, writeTerms, exportProfile, importProfile };
})(window);
