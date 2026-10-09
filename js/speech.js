/* AutoDoku – Live-Spracherkennung (Web Speech API, Chrome/Edge/Safari) */
(function (root) {
  'use strict';

  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const isAndroid = /Android/i.test(navigator.userAgent);

  class LiveTranscriber {
    constructor(h) {
      this.h = h || {};      // onFinal(text), onInterim(text), onState(state), onError(msg, fatal)
      this.rec = null;
      this.want = false;     // soll laufen
      this.lang = 'de-AT';
      this.restarts = 0;
      this.lastFinalAt = 0;
      this.androidBuf = '';
    }

    static supported() { return !!SR; }

    start(lang) {
      if (!SR) { this.h.onError && this.h.onError('Dieser Browser kann keine Live-Spracherkennung. Nimm Chrome oder Edge (am Handy: Chrome).', true); return false; }
      this.lang = lang || this.lang;
      this.want = true;
      this._spawn();
      return true;
    }

    stop() {
      this.want = false;
      if (this.rec) { try { this.rec.stop(); } catch (e) { /* egal */ } }
      this._state('stopped');
    }

    _state(s) { this.state = s; this.h.onState && this.h.onState(s); }

    _spawn() {
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      // Android-Chrome liefert bei continuous doppelte Ergebnisse -> dort Einzelphrasen + Neustart
      rec.continuous = !isAndroid;
      rec.maxAlternatives = 1;

      rec.onstart = () => { this._state('listening'); };
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) {
            const clean = txt.trim();
            if (clean) { this.lastFinalAt = Date.now(); this.h.onFinal && this.h.onFinal(clean); }
          } else {
            interim += txt;
          }
        }
        this.h.onInterim && this.h.onInterim(interim.trim());
      };
      rec.onerror = (e) => {
        const err = e.error;
        if (err === 'no-speech' || err === 'aborted') return;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          this.want = false;
          this.h.onError && this.h.onError('Mikrofon blockiert. Erlaube den Zugriff in der Adressleiste (🔒/🎤) und starte neu.', true);
          return;
        }
        if (err === 'network') { this.h.onError && this.h.onError('Spracherkennung braucht Internet – Verbindung prüfen.', false); return; }
        if (err === 'audio-capture') { this.h.onError && this.h.onError('Kein Mikrofon gefunden.', true); this.want = false; return; }
        this.h.onError && this.h.onError('Spracherkennung: ' + err, false);
      };
      rec.onend = () => {
        this.h.onInterim && this.h.onInterim('');
        if (this.want) {
          this._state('restarting');
          // Chrome beendet nach Stille/~60 s – einfach neu starten
          setTimeout(() => { if (this.want) { try { this._spawn(); } catch (e) { /* nochmal */ } } }, isAndroid ? 120 : 250);
        } else {
          this._state('stopped');
        }
      };
      this.rec = rec;
      try { rec.start(); } catch (e) {
        // "already started" – kurz warten
        setTimeout(() => { if (this.want) { try { rec.start(); } catch (e2) { /* egal */ } } }, 400);
      }
    }
  }

  root.LiveTranscriber = LiveTranscriber;
})(window);
