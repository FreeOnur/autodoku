/* AutoDoku – Live-Spracherkennung (Web Speech API)
 * Bevorzugt die Offline-Erkennung direkt im Chrome (processLocally) – funktioniert auch,
 * wenn das Schul-WLAN Googles Spracherkennungs-Server blockiert. Sonst Server-Erkennung. */
(function (root) {
  'use strict';

  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const hasLocal = !!(SR && typeof SR.available === 'function');

  // Sprachpakete gibt es meist nur für Hauptvarianten (de-DE statt de-AT)
  const localLangs = (lang) => {
    const base = (lang || 'de-DE').split('-')[0];
    const main = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', it: 'it-IT', es: 'es-ES' }[base];
    return [...new Set([lang, main].filter(Boolean))];
  };

  async function localStatus(lang) {
    if (!hasLocal) return { status: 'unsupported', lang };
    let best = { status: 'unavailable', lang };
    for (const l of localLangs(lang)) {
      try {
        const st = await SR.available({ langs: [l], processLocally: true });
        if (st === 'available') return { status: st, lang: l };
        if (st !== 'unavailable' && best.status === 'unavailable') best = { status: st, lang: l };
      } catch (e) { /* nächste Variante */ }
    }
    return best;
  }

  async function installLocal(lang) {
    if (!hasLocal || typeof SR.install !== 'function') return false;
    for (const l of localLangs(lang)) {
      try {
        const ok = await SR.install({ langs: [l], processLocally: true });
        if (ok) return l;
      } catch (e) { /* nächste */ }
    }
    return false;
  }

  class LiveTranscriber {
    constructor(h) {
      this.h = h || {};      // onFinal, onInterim, onState, onError(msg, fatal), onNeedLocal(info)
      this.rec = null;
      this.want = false;
      this.lang = 'de-AT';
      this.local = false;    // Offline-Erkennung aktiv
      this.localLang = null;
      this.netErrors = 0;
      this.warned = false;
    }

    static supported() { return !!SR; }
    static hasLocal() { return hasLocal; }
    static localStatus(lang) { return localStatus(lang); }
    static installLocal(lang) { return installLocal(lang); }

    async start(lang) {
      if (!SR) { this.h.onError && this.h.onError('Dieser Browser kann keine Live-Spracherkennung. Nimm Google Chrome (am Handy: Chrome).', true); return false; }
      this.lang = lang || this.lang;
      this.want = true;
      this.netErrors = 0;
      // Offline-Erkennung bevorzugen, wenn das Sprachpaket schon da ist
      const st = await localStatus(this.lang);
      this.local = st.status === 'available';
      this.localLang = st.lang;
      this.localInfo = st;
      this._spawn();
      return true;
    }

    useLocal(lang) {
      this.local = true;
      this.localLang = lang || this.localLang;
      this.netErrors = 0;
      if (this.rec) { try { this.rec.abort(); } catch (e) { /* egal */ } } else if (this.want) this._spawn();
    }

    stop() {
      this.want = false;
      if (this.rec) { try { this.rec.stop(); } catch (e) { /* egal */ } }
      this._state('stopped');
    }

    _state(s) { this.state = s; this.h.onState && this.h.onState(s); }

    _spawn() {
      const rec = new SR();
      rec.lang = this.local ? this.localLang : this.lang;
      rec.interimResults = true;
      rec.continuous = !isAndroid;
      rec.maxAlternatives = 1;
      if (this.local) {
        try { rec.processLocally = true; } catch (e) { /* alt */ }
        try { if ('mode' in rec) rec.mode = 'ondevice-only'; } catch (e) { /* alt */ }
      }

      rec.onstart = () => { this._state(this.local ? 'listening-local' : 'listening'); };
      rec.onresult = (e) => {
        this.netErrors = 0;
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) { const clean = txt.trim(); if (clean) this.h.onFinal && this.h.onFinal(clean); }
          else interim += txt;
        }
        this.h.onInterim && this.h.onInterim(interim.trim());
      };
      rec.onerror = async (e) => {
        const err = e.error;
        if (err === 'no-speech' || err === 'aborted') return;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          if (this.local && err === 'service-not-allowed') { this.local = false; return; } // Offline gesperrt -> Server versuchen
          this.want = false;
          this.h.onError && this.h.onError('Mikrofon blockiert. Klick auf das 🔒/🎤-Symbol in der Adressleiste → Mikrofon „Zulassen“ und starte neu.', true);
          return;
        }
        if (err === 'language-not-supported' && this.local) { this.local = false; return; }
        if (err === 'network') {
          this.netErrors++;
          if (this.netErrors === 1) {
            // Google-Server nicht erreichbar (oft: Schul-WLAN blockiert) -> Offline-Paket, sonst Whisper/Gemini
            const st = await localStatus(this.lang);
            if (st.status === 'available') { this.useLocal(st.lang); return; }
            if (this.h.onFallback) { this.want = false; this.h.onFallback('network'); return; }
            if (!this.warned) {
              this.warned = true;
              this.h.onError && this.h.onError('Die Google-Spracherkennung ist nicht erreichbar (oft blockiert das Schul-WLAN sie). Tipp: Handy-Hotspot verwenden.', false);
            }
          }
          if (this.netErrors >= 4) {
            this.want = false;
            this.h.onError && this.h.onError('Spracherkennung gestoppt: Google-Server nicht erreichbar. Mit Handy-Hotspot nochmal starten – oder ✍️ Notizen tippen.', true);
          }
          return;
        }
        if (err === 'audio-capture') { this.want = false; this.h.onError && this.h.onError('Kein Mikrofon gefunden.', true); return; }
        this.h.onError && this.h.onError('Spracherkennung: ' + err, false);
      };
      rec.onend = () => {
        this.h.onInterim && this.h.onInterim('');
        if (this.want) {
          this._state('restarting');
          // bei Netzfehlern langsamer neu starten
          const wait = this.netErrors ? Math.min(8000, 1500 * this.netErrors) : (isAndroid ? 120 : 250);
          setTimeout(() => { if (this.want) { try { this._spawn(); } catch (e) { /* nochmal */ } } }, wait);
        } else {
          this._state('stopped');
        }
      };
      this.rec = rec;
      try { rec.start(); } catch (e) {
        setTimeout(() => { if (this.want) { try { rec.start(); } catch (e2) { /* egal */ } } }, 400);
      }
    }
  }

  root.LiveTranscriber = LiveTranscriber;
})(window);
