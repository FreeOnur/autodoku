# AutoDoku – Du chillst, ich schreib mit.

AutoDoku hört im Unterricht mit, macht daraus **live eine saubere Mitschrift** und exportiert sie als **Word-Dokument mit echten Formeln** (die bearbeitbaren Gleichungen aus Einfügen → Formel, nicht nur Bilder).

## Was es kann

| | |
|---|---|
| 🎙️ **Live-Transkript** | Fach antippen → Mikrofon hört zu, Text erscheint live |
| ⚡ **Live-Zusammenfassung** | alle 1–2 Minuten macht Claude daraus Stichpunkte, Merke-, Definitions- und Formel-Boxen |
| 🧮 **Mathe richtig** | „x hoch zwei durch zwei a“ → $\frac{x^2}{2a}$, in Word als echte Formel (Brüche, Wurzeln, Summen, Integrale, Matrizen, Fallunterscheidungen …) |
| 📷 **Tafelfotos** | Tafel, Folie oder Heft fotografieren → Claude überträgt den Inhalt inkl. Formeln, das Foto kommt mit Bildunterschrift ins Dokument |
| 🖼️ **Bilder suchen** | beim Fertigstellen sucht AutoDoku passende, frei lizenzierte Abbildungen (Wikimedia Commons, mit Quellenangabe) – 🔄 zum Austauschen |
| 📌 **Hausübungen & Termine** | werden automatisch erkannt und gesammelt (Startseite) |
| 🆘 **„Was war gerade?“** | kurz weggeträumt? Ein Tipp → Zusammenfassung der letzten 3 Minuten + Antwortvorschlag, falls gerade eine Frage gestellt wurde |
| ✨ **Fertig & polieren** | am Ende eine polierte Version: „Auf einen Blick“-Box, logisch sortiert, Begriffe-Tabelle, „Teste dich selbst“ mit Lösungen |
| ⬇ **Word-Export** | farbige Boxen, Tabellen, Bilder, Kopf-/Fußzeile, Seitenzahlen |
| 📚 **KI-Lernzettel** & 🧠 **Quiz** | aus mehreren Stunden einen Lernzettel bzw. Karteikarten erstellen |
| 💬 **Fragen** | Fragen zur Stunde stellen („Erklär mir das einfacher“) |

Jedes Fach hat eigene Einstellungen: Englisch wird z. B. auf Englisch erkannt und mit Vokabeltabellen dokumentiert, SWP mit Code-Blöcken.

## Starten (PC)

1. **`start.bat`** doppelklicken → AutoDoku öffnet sich im Browser auf `http://localhost:5317`.
   (Braucht Node.js – hast du für Angular sowieso. Alternativ: `node server.js`.)
2. Nimm **Chrome oder Edge** (Firefox hat keine Live-Spracherkennung).
3. Beim ersten Start den **Claude-API-Schlüssel** eintragen:
   [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → Schlüssel erstellen (braucht etwas Guthaben unter *Billing*).
   Ohne Schlüssel funktioniert nur das Transkript.
4. Ohne Schlüssel ausprobieren: ⚙️ → **Demo-Stunde anlegen** → **⬇ Word**.

## Am Handy

AutoDoku läuft online unter **https://freeonur.github.io/autodoku/** (GitHub Pages, Repo `FreeOnur/autodoku`).

Am Handy in **Chrome** öffnen → Menü ⋮ → **„Zum Startbildschirm hinzufügen“** → AutoDoku läuft wie eine App.
Öffentlich ist nur der Programmcode – deine Mitschriften und dein API-Schlüssel bleiben nur auf deinem Gerät (auch der Schlüssel muss am Handy einmal extra eingetragen werden).
Wichtig: Bildschirm anlassen (macht AutoDoku automatisch) – wenn das Handy sperrt, pausiert die Erkennung.

**Updates veröffentlichen:** geänderte Dateien auf github.com/FreeOnur/autodoku hochladen (*Add file → Upload files*, für Unterordner die URL `…/upload/main/js` usw.) – nach 1–2 Minuten ist die neue Version online.

## Tipps für gute Mitschriften

- Gerät möglichst **nah zum Lehrer** bzw. Richtung Tafel legen.
- Bei Formeln an der Tafel lieber kurz **📷 fotografieren** – das ist genauer als die Spracherkennung.
- **✍️ Notiz** für Dinge wie „kommt sicher zur SA“ – Notizen gewichtet Claude besonders.
- Am Ende **✨ Fertig** drücken, dann **⬇ Word**.
- In ⚙️ Einstellungen: Name & Klasse für den Kopf des Word-Dokuments, Update-Intervall, Transkript-Anhang.

## Kosten & Sparstufen

Die Zusammenfassungen laufen über die Claude API (Abrechnung nach Tokens; 1 Token ≈ ¾ Wort). In ⚙️ → **Sparstufe**:

| Sparstufe | Was passiert | ca. pro 50-min-Stunde |
|---|---|---|
| 💸 **Sparmodus** (Standard) | alles mit Claude Haiku 5.5, Live-Update alle 90 s | 1–3 Cent |
| ✨ **Beste Qualität** | live Haiku 5.5, „Fertig“ & Tafelfotos mit Sonnet 5.5 | 5–12 Cent |
| 🪙 **Nur am Ende** | während der Stunde nur Transkript, am Ende eine Zusammenfassung | unter 1 Cent |

Preise (Okt. 2026, pro 1 Mio. Tokens): Haiku 5.5 $0,10 rein / $0,50 raus, Sonnet 5.5 $2 / $10 – aktuell auf der [Preisseite](https://platform.claude.com/docs/en/about-claude/pricing).
Eine Stunde im Sparmodus braucht grob 150.000 Tokens – mit Haiku 5.5 sind das nur ein paar Cent. AutoDoku zeigt bei jeder Stunde 💰 an, was sie gekostet hat, und in ⚙️ den Gesamtverbrauch.
Tafelfotos lesen ist mit „Beste Qualität“ genauer (vor allem bei Formeln).

## Datenschutz & Fairness

- **Kein Audio wird gespeichert**, nur Text. Alles (Mitschriften, Fotos, Schlüssel) bleibt lokal im Browser – Sicherung über ⚙️ → *Sicherung exportieren*.
- Die Live-Spracherkennung von Chrome/Edge verarbeitet das Audio auf Servern von Google bzw. Microsoft; die Zusammenfassungen gehen an die Claude API.
- **Frag deine Lehrkraft kurz, ob Mitschreiben per App okay ist.** Das ist fair, und es geht auch um die Hausordnung.

## Für Neugierige (SWP 😉)

Reines HTML/CSS/JavaScript, kein Build-Schritt:

```
index.html            App-Hülle
css/app.css           Design (dunkle „Tafel“ + helles „Papier“)
js/app.js             Oberfläche, Aufnahme-Ablauf, Export
js/speech.js          Live-Spracherkennung (Web Speech API, Auto-Neustart)
js/claude.js          Claude API direkt aus dem Browser (inkl. Streaming)
js/prompts.js         alle Anweisungen an Claude – hier kannst du den Stil anpassen
js/markdown.js        Mini-Markdown → HTML (mit KaTeX)
js/latex2omml.js      LaTeX → Word-Formeln (OMML), selbst geschrieben
js/docx.js            baut die .docx-Datei direkt (Formatvorlagen, Listen, Boxen, Bilder)
js/images.js          Fotos verkleinern, Wikimedia-Commons-Suche
js/store.js           IndexedDB + Einstellungen
sw.js, manifest       installierbar als App (PWA)
server.js, start.bat  lokaler Mini-Server
```
