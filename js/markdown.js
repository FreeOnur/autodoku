/*
 * AutoDoku – Mini-Markdown für Mitschriften
 * Ein Parser, zwei Ausgaben: HTML (App, mit KaTeX) und Blöcke für den Word-Export.
 *
 * Unterstützt: # Überschriften, - Listen (verschachtelt), 1. Listen, **fett**, *kursiv*,
 * ==markiert==, `code`, $inline$, $$display$$, ```code```, | Tabellen |,
 * > [!MERKE] Boxen, ![Bild](img:ID | search:Begriff), ---
 */
(function (root) {
  'use strict';

  const CALLOUTS = {
    MERKE: { label: 'Merke', icon: '💡', color: '2563EB', fill: 'EFF6FF' },
    DEFINITION: { label: 'Definition', icon: '📘', color: '7C3AED', fill: 'F5F3FF' },
    SATZ: { label: 'Satz', icon: '📐', color: '7C3AED', fill: 'F5F3FF' },
    FORMEL: { label: 'Formel', icon: '🧮', color: '0D9488', fill: 'F0FDFA' },
    BEISPIEL: { label: 'Beispiel', icon: '✏️', color: '16A34A', fill: 'F0FDF4' },
    ACHTUNG: { label: 'Achtung', icon: '⚠️', color: 'DC2626', fill: 'FEF2F2' },
    TIPP: { label: 'Tipp', icon: '✨', color: 'D97706', fill: 'FFFBEB' },
    PRUEFUNG: { label: 'Prüfungsrelevant', icon: '🎯', color: 'DB2777', fill: 'FDF2F8' },
    AUFGABE: { label: 'Aufgabe', icon: '📝', color: '0891B2', fill: 'ECFEFF' },
    ZUSAMMENFASSUNG: { label: 'Auf einen Blick', icon: '⚡', color: '4F46E5', fill: 'EEF2FF' },
    INFO: { label: 'Info', icon: 'ℹ️', color: '475569', fill: 'F8FAFC' },
    QUOTE: { label: '', icon: '', color: '94A3B8', fill: 'F8FAFC' },
  };
  CALLOUTS['PRÜFUNG'] = CALLOUTS.PRUEFUNG;
  CALLOUTS.WICHTIG = CALLOUTS.ACHTUNG;
  CALLOUTS.HINWEIS = CALLOUTS.INFO;
  CALLOUTS.SUMMARY = CALLOUTS.ZUSAMMENFASSUNG;

  // ---------- Inline ----------
  const INLINE_RE = /(\\\$)|(\$\$[^$]+?\$\$)|(\$[^$\n]+?\$)|(`[^`\n]+`)|(\*\*\*[^*\n]+?\*\*\*)|(\*\*[^\n]+?\*\*)|(==[^\n]+?==)|(\*[^*\s\n][^*\n]*?\*)/g;

  function parseInline(s, marks) {
    marks = marks || {};
    const out = [];
    let last = 0;
    const push = (v) => { if (v) out.push(Object.assign({ k: 'text', v }, marks)); };
    s = String(s || '');
    const re = new RegExp(INLINE_RE.source, 'g'); // eigene Instanz (Rekursion!)
    let m;
    while ((m = re.exec(s))) {
      push(s.slice(last, m.index));
      const tok = m[0];
      if (m[1]) push('$');
      else if (m[2]) out.push(Object.assign({ k: 'math', v: tok.slice(2, -2).trim() }, marks));
      else if (m[3]) out.push(Object.assign({ k: 'math', v: tok.slice(1, -1).trim() }, marks));
      else if (m[4]) out.push(Object.assign({ k: 'code', v: tok.slice(1, -1) }, marks));
      else if (m[5]) out.push(...parseInline(tok.slice(3, -3), Object.assign({}, marks, { b: true, i: true })));
      else if (m[6]) out.push(...parseInline(tok.slice(2, -2), Object.assign({}, marks, { b: true })));
      else if (m[7]) out.push(...parseInline(tok.slice(2, -2), Object.assign({}, marks, { hl: true })));
      else if (m[8]) out.push(...parseInline(tok.slice(1, -1), Object.assign({}, marks, { i: true })));
      last = m.index + tok.length;
    }
    push(s.slice(last));
    return out;
  }

  // ---------- Blöcke ----------
  const LIST_RE = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    let l = line.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
    // Pipes in $...$ nicht trennen
    const cells = [];
    let cur = '', inMath = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '$') inMath = !inMath;
      if (c === '|' && !inMath && l[i - 1] !== '\\') { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parse(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
    const blocks = [];
    let i = 0;
    let para = [];
    let list = null;

    const flushPara = () => {
      if (para.length) blocks.push({ type: 'p', inl: parseInline(para.join(' ')) });
      para = [];
    };
    const flushList = () => { if (list) blocks.push(list); list = null; };
    const flush = () => { flushPara(); flushList(); };

    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();
      const t = line.trim();

      if (!t) { flush(); i++; continue; }

      // Code-Block
      if (/^```/.test(t)) {
        flush();
        const lang = t.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        blocks.push({ type: 'code', lang, text: buf.join('\n') });
        continue;
      }

      // Display-Mathe
      if (/^\$\$/.test(t) || /^\\\[/.test(t)) {
        flush();
        const close = t.startsWith('$$') ? '$$' : '\\]';
        let body = t.slice(2);
        if (body.trim().endsWith(close) && body.trim().length >= close.length) {
          body = body.trim().slice(0, -close.length);
          i++;
        } else {
          const buf = [body];
          i++;
          while (i < lines.length && !lines[i].includes(close)) { buf.push(lines[i]); i++; }
          if (i < lines.length) { buf.push(lines[i].slice(0, lines[i].indexOf(close))); i++; }
          body = buf.join('\n');
        }
        if (body.trim()) blocks.push({ type: 'math', tex: body.trim() });
        continue;
      }

      // Überschrift
      const h = /^(#{1,4})\s+(.*)$/.exec(t);
      if (h) {
        flush();
        blocks.push({ type: 'h', level: h[1].length, inl: parseInline(h[2].replace(/\s#+$/, '')), text: h[2] });
        i++; continue;
      }

      // Trennlinie
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); blocks.push({ type: 'hr' }); i++; continue; }

      // Bild
      const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(t);
      if (img) { flush(); blocks.push({ type: 'img', alt: img[1], src: img[2], title: img[3] || '' }); i++; continue; }

      // Callout / Zitat
      if (/^>/.test(t)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        let kind = 'QUOTE', title = '';
        const head = /^\[!([A-Za-zÄÖÜäöü]+)\]\s*(.*)$/.exec(buf[0] || '');
        if (head) {
          kind = head[1].toUpperCase();
          if (!CALLOUTS[kind]) kind = 'INFO';
          title = head[2] || '';
          buf.shift();
        }
        blocks.push({ type: 'callout', kind, title, titleInl: parseInline(title), blocks: parse(buf.join('\n')) });
        continue;
      }

      // Tabelle
      if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
        flush();
        const head = splitRow(t).map(c => parseInline(c));
        const aligns = splitRow(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(splitRow(lines[i]).map(c => parseInline(c)));
          i++;
        }
        blocks.push({ type: 'table', head, rows, aligns });
        continue;
      }

      // Liste
      const li = LIST_RE.exec(line);
      if (li) {
        flushPara();
        const indent = li[1].length;
        const level = Math.min(3, Math.floor(indent / 2));
        const ordered = /\d/.test(li[2]);
        const start = ordered ? parseInt(li[2], 10) : 1;
        let text = li[3];
        // Aufgabenliste [ ] / [x]
        let check = null;
        const cb = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        if (cb) { check = cb[1] !== ' '; text = cb[2]; }
        if (!list) list = { type: 'list', items: [] };
        list.items.push({ level, ordered, start, check, text, inl: null });
        i++;
        // Fortsetzungszeilen
        while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && /^\s{2,}/.test(lines[i]) &&
          !/^\s*(\$\$|```|>|#|\|)/.test(lines[i])) {
          list.items[list.items.length - 1].text += ' ' + lines[i].trim();
          i++;
        }
        continue;
      }

      // Absatz
      flushList();
      para.push(t);
      i++;
    }
    flush();
    for (const b of blocks) if (b.type === 'list') for (const it of b.items) it.inl = parseInline(it.text);
    return blocks;
  }

  // ---------- HTML ----------
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mathHtml(tex, display) {
    if (root.katex) {
      try {
        return root.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: 'ignore', output: 'html' });
      } catch (e) { /* fallthrough */ }
    }
    return `<code class="tex">${escHtml(tex)}</code>`;
  }

  function inlineHtml(inl) {
    return (inl || []).map(n => {
      let h;
      if (n.k === 'math') h = mathHtml(n.v, false);
      else if (n.k === 'code') h = `<code>${escHtml(n.v)}</code>`;
      else h = escHtml(n.v);
      if (n.hl) h = `<mark>${h}</mark>`;
      if (n.i) h = `<em>${h}</em>`;
      if (n.b) h = `<strong>${h}</strong>`;
      return h;
    }).join('');
  }

  function listHtml(items) {
    let html = '';
    const stack = [];
    for (const it of items) {
      const tag = it.ordered ? 'ol' : 'ul';
      while (stack.length > it.level + 1) html += `</li></${stack.pop()}>`;
      if (stack.length === it.level + 1 && stack[stack.length - 1] !== tag) { html += `</li></${stack.pop()}>`; }
      if (stack.length < it.level + 1) {
        while (stack.length < it.level + 1) {
          const st = it.ordered && it.start !== 1 ? ` start="${it.start}"` : '';
          html += `<${tag}${st}>`;
          stack.push(tag);
          if (stack.length < it.level + 1) html += '<li class="empty">';
        }
      } else {
        html += '</li>';
      }
      const box = it.check === null ? '' : `<span class="cbx ${it.check ? 'on' : ''}">${it.check ? '✓' : ''}</span>`;
      html += `<li>${box}${inlineHtml(it.inl)}`;
    }
    while (stack.length) html += `</li></${stack.pop()}>`;
    return html;
  }

  /**
   * @param blocks Ergebnis von parse()
   * @param opts {resolveImage(src) => {url, caption, credit} | null, onSearch: bool}
   */
  function toHtml(blocks, opts) {
    opts = opts || {};
    return blocks.map(b => {
      switch (b.type) {
        case 'h': return `<h${b.level + 0}>${inlineHtml(b.inl)}</h${b.level + 0}>`;
        case 'p': return `<p>${inlineHtml(b.inl)}</p>`;
        case 'hr': return '<hr>';
        case 'math': return `<div class="math-block">${mathHtml(b.tex, true)}</div>`;
        case 'code': return `<pre class="code"><code>${escHtml(b.text)}</code></pre>`;
        case 'list': return listHtml(b.items);
        case 'callout': {
          const c = CALLOUTS[b.kind] || CALLOUTS.INFO;
          const head = c.label || b.title ? `<div class="callout-head">${c.icon} ${escHtml(c.label)}${b.title ? (c.label ? ': ' : '') + inlineHtml(b.titleInl) : ''}</div>` : '';
          return `<div class="callout" style="--c:#${c.color};--f:#${c.fill}">${head}${toHtml(b.blocks, opts)}</div>`;
        }
        case 'table': {
          const th = b.head.map((c, j) => `<th style="text-align:${b.aligns[j] || 'left'}">${inlineHtml(c)}</th>`).join('');
          const tr = b.rows.map(r => `<tr>${r.map((c, j) => `<td style="text-align:${b.aligns[j] || 'left'}">${inlineHtml(c)}</td>`).join('')}</tr>`).join('');
          return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
        }
        case 'img': {
          if (b.src.startsWith('search:')) {
            const term = decodeURIComponent(b.src.slice(7)).replace(/\+/g, ' ');
            return `<div class="img-suggest" data-src="${escHtml(b.src)}" data-term="${escHtml(term)}" data-alt="${escHtml(b.alt)}"><span>🖼️ Bildvorschlag: <b>${escHtml(b.alt || term)}</b></span><span class="img-suggest-actions"><button class="btn tiny" data-action="pick-image">Bild suchen</button><button class="btn tiny ghost" data-action="drop-image" title="Vorschlag entfernen">✕</button></span></div>`;
          }
          const r = opts.resolveImage ? opts.resolveImage(b.src) : { url: b.src };
          if (!r) return '';
          const actions = opts.figureActions ? `<div class="fig-actions"><button class="btn tiny" data-action="swap-image" title="Anderes Bild suchen">🔄</button><button class="btn tiny" data-action="drop-image" title="Aus Mitschrift entfernen">✕</button></div>` : '';
          return `<figure data-src="${escHtml(b.src)}" data-alt="${escHtml(b.alt)}">${actions}<img src="${escHtml(r.url)}" alt="${escHtml(b.alt)}" loading="lazy"><figcaption>${escHtml(b.alt || r.caption || '')}${r.credit ? `<span class="credit">${escHtml(r.credit)}</span>` : ''}</figcaption></figure>`;
        }
        default: return '';
      }
    }).join('\n');
  }

  const api = { parse, parseInline, toHtml, inlineHtml, CALLOUTS, escHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MD = api;
})(typeof window !== 'undefined' ? window : globalThis);
