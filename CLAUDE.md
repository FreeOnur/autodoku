# AutoDoku – Hinweise für Claude

## Bei jeder Änderung
- Code ist reines HTML/CSS/JS ohne Build-Schritt; Desktop-Teil in `desktop/` (Electron, Node).
- Nach Änderungen alle JS-Dateien auf Syntax prüfen: `for f in js/*.js desktop/*.js; do node -e "new (require('vm').Script)(require('fs').readFileSync('$f','utf8'))"; done`
- Im Browser testen (Playwright/Headless Chrome mit `window.AUTODOKU_INFO={desktop:true,…}` für Desktop-Funktionen). whisper.cpp und Ollama lassen sich mit kleinen Node-Nachbauten von `/health`, `/inference` bzw. `/api/*` simulieren.
- README aktuell halten (Funktionen, Größen, Screenshots unter `docs/readme/`, Format `.webp`). Dafür den Skill `readme-creator` nutzen, falls vorhanden.

## Neue Version veröffentlichen
1. Version in `package.json` erhöhen (SemVer).
2. `build/release-notes.md` für die neue Version anpassen (wird zum Release-Text).
3. Committen und auf `main` pushen.
4. Release bauen: Tag `vX.Y.Z` pushen **oder** den Workflow *Release* manuell starten (`workflow_dispatch` auf `main`).
   GitHub Actions baut auf `windows-latest` mit electron-builder `AutoDoku-Setup.exe` und veröffentlicht das Release.
5. Prüfen: Release hat `AutoDoku-Setup.exe` + `latest.yml`; `https://github.com/FreeOnur/autodoku/releases/latest/download/AutoDoku-Setup.exe` lädt.

Installierte Apps holen Updates selbst (`desktop/updater.js`, GitHub Releases API).

## Wichtig
- Große Downloads (Whisper-Modell, Ollama) nie ins Repo oder in die .exe – die App lädt sie nach `%APPDATA%\AutoDoku`.
- Ollama nur starten, wenn es gebraucht wird; beim Beenden entladen und schließen (`desktop/ollama.js`).
- Commits als FreeOnur, mit `Co-Authored-By`-Zeile.
