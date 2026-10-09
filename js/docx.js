/*
 * AutoDoku – Word-Export (.docx) ohne externe Vorlage
 * Baut WordprocessingML direkt: eigene Formatvorlagen, Listen, farbige Merke-Boxen,
 * Tabellen, Bilder mit Bildunterschrift und echte Word-Formeln (OMML).
 */
(function (root) {
  'use strict';

  const LatexOMML = root.LatexOMML || (typeof require !== 'undefined' ? require('./latex2omml.js') : null);
  const MD = root.MD || (typeof require !== 'undefined' ? require('./markdown.js') : null);
  const getJSZip = () => root.JSZip || (typeof require !== 'undefined' ? require('jszip') : null);

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134; // A4, 2 cm Ränder
  const TEXT_W = PAGE_W - 2 * MARGIN; // in twips
  const EMU_PER_TWIP = 635;

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // ungültige XML-Steuerzeichen entfernen
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

  const hex = (c) => String(c || '334155').replace('#', '').toUpperCase();

  function mix(hexColor, amount) { // mit Weiß mischen -> helle Füllfarbe
    const h = hex(hexColor);
    const n = parseInt(h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amount); g = Math.round(g + (255 - g) * amount); b = Math.round(b + (255 - b) * amount);
    return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
  }

  // ---------- Bausteine ----------
  function rPr(o) {
    if (!o) return '';
    let x = '';
    if (o.style) x += `<w:rStyle w:val="${o.style}"/>`;
    if (o.font) x += `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>`;
    if (o.b) x += '<w:b/><w:bCs/>';
    if (o.i) x += '<w:i/><w:iCs/>';
    if (o.caps) x += '<w:caps/>';
    if (o.color) x += `<w:color w:val="${hex(o.color)}"/>`;
    if (o.spacing) x += `<w:spacing w:val="${o.spacing}"/>`;
    if (o.sz) x += `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`;
    if (o.hl) x += '<w:highlight w:val="yellow"/>';
    if (o.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(o.shd)}"/>`;
    return x ? `<w:rPr>${x}</w:rPr>` : '';
  }

  function run(text, o) {
    const parts = String(text).split('\n');
    const body = parts.map((p, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(p)}</w:t>`).join('');
    return `<w:r>${rPr(o)}${body}</w:r>`;
  }

  function pPr(o) {
    if (!o) return '';
    let x = '';
    if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
    if (o.keepNext) x += '<w:keepNext/>';
    if (o.keepLines) x += '<w:keepLines/>';
    if (o.pageBreakBefore) x += '<w:pageBreakBefore/>';
    if (o.num) x += `<w:numPr><w:ilvl w:val="${o.num.lvl}"/><w:numId w:val="${o.num.id}"/></w:numPr>`;
    if (o.bdr) x += `<w:pBdr>${o.bdr}</w:pBdr>`;
    if (o.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(o.shd)}"/>`;
    if (o.spacing) {
      const s = o.spacing;
      x += `<w:spacing${s.before != null ? ` w:before="${s.before}"` : ''}${s.after != null ? ` w:after="${s.after}"` : ''}${s.line != null ? ` w:line="${s.line}" w:lineRule="auto"` : ''}/>`;
    }
    if (o.ind) {
      const d = o.ind;
      x += `<w:ind${d.left != null ? ` w:left="${d.left}"` : ''}${d.right != null ? ` w:right="${d.right}"` : ''}${d.hanging != null ? ` w:hanging="${d.hanging}"` : ''}${d.firstLine != null ? ` w:firstLine="${d.firstLine}"` : ''}/>`;
    }
    if (o.jc) x += `<w:jc w:val="${o.jc}"/>`;
    return x ? `<w:pPr>${x}</w:pPr>` : '';
  }

  const para = (o, content) => `<w:p>${pPr(o)}${content || ''}</w:p>`;

  function inlineXml(inl, base) {
    base = base || {};
    return (inl || []).map(n => {
      if (n.k === 'math') {
        const om = LatexOMML.latexToOMML(n.v, { display: false });
        return n.hl ? om.split('</w:rPr>').join('<w:highlight w:val="yellow"/></w:rPr>') : om;
      }
      const o = Object.assign({}, base);
      if (n.b) o.b = true;
      if (n.i) o.i = true;
      if (n.hl) o.hl = true;
      if (n.k === 'code') { o.font = 'Consolas'; o.shd = 'F1F5F9'; o.color = 'BE185D'; o.sz = Math.max(18, (base.sz || 22) - 2); }
      return run(n.v, o);
    }).join('');
  }

  // ---------- Kontext ----------
  class Ctx {
    constructor(opts) {
      this.accent = hex(opts.accent || '4F46E5');
      this.images = opts.images || {};
      this.media = []; // {name, data, rid}
      this.rels = [];
      this.nums = []; // zusätzliche nummerierte Listen
      this.docPrId = 1;
      this.figure = 0;
    }
    newOrderedNum(start) {
      const id = 10 + this.nums.length;
      this.nums.push({ id, start: start || 1 });
      return id;
    }
  }

  // ---------- Blöcke -> XML ----------
  function blocksXml(blocks, ctx, wrap) {
    // wrap: zusätzliche Absatzformatierung (z. B. Merke-Box)
    return blocks.map(b => blockXml(b, ctx, wrap)).join('');
  }

  function withWrap(o, wrap) {
    if (!wrap || !wrap.bdr) return o;
    const r = Object.assign({}, o, { bdr: wrap.bdr, shd: wrap.shd });
    const ind = Object.assign({}, o.ind || {});
    ind.left = (ind.left || 0) + wrap.indLeft;
    ind.right = (ind.right || 0) + wrap.indRight;
    r.ind = ind;
    r.spacing = Object.assign({ before: 0, after: 60 }, o.spacing || {});
    return r;
  }

  function blockXml(b, ctx, wrap) {
    switch (b.type) {
      case 'h': {
        const lvl = Math.min(4, b.level);
        // #-Überschrift innerhalb der Notizen = H1 des Abschnitts
        return para(withWrap({ style: `Heading${lvl}` }, wrap), inlineXml(b.inl));
      }
      case 'p':
        return para(withWrap({}, wrap), inlineXml(b.inl));
      case 'hr':
        return para({ bdr: `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${mix(ctx.accent, 0.6)}"/>`, spacing: { before: 120, after: 240 } }, '');
      case 'math':
        return para(withWrap({ spacing: { before: 120, after: 120 }, keepLines: true }, wrap), LatexOMML.latexToOMML(b.tex, { display: true }));
      case 'code': {
        const lines = b.text.split('\n');
        return lines.map((l, i) => para(withWrap({
          style: 'Code',
          spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 160 : 0 },
        }, wrap), run(l.length ? l : ' ', null))).join('');
      }
      case 'list': {
        let ordId = null;
        let prevTopOrdered = false;
        return b.items.map(it => {
          let num;
          if (it.ordered) {
            if (ordId === null || (it.level === 0 && !prevTopOrdered)) ordId = ctx.newOrderedNum(it.level === 0 ? it.start : 1);
            num = { id: ordId, lvl: it.level };
          } else {
            num = { id: 1, lvl: it.level };
          }
          if (it.level === 0) prevTopOrdered = it.ordered;
          let content = inlineXml(it.inl);
          if (it.check !== null && it.check !== undefined) content = run(it.check ? '☑ ' : '☐ ', { font: 'Segoe UI Symbol' }) + content;
          const o = { style: 'ListParagraph', num, spacing: { before: 0, after: 60 } };
          if (wrap && wrap.bdr) {
            const ind = 360 * (it.level + 1) + 300;
            o.ind = { left: ind + wrap.indLeft, hanging: 300, right: wrap.indRight };
            o.bdr = wrap.bdr; o.shd = wrap.shd;
          }
          return para(o, content);
        }).join('');
      }
      case 'callout': {
        const c = MD.CALLOUTS[b.kind] || MD.CALLOUTS.INFO;
        let inner = '';
        if (c.label || b.title) {
          const head = run(`${c.icon ? c.icon + '  ' : ''}${c.label}${b.title && c.label ? ': ' : ''}`, { b: true, color: c.color }) +
            (b.title ? inlineXml(b.titleInl, { b: true, color: c.color }) : '');
          inner += para({ keepNext: true, spacing: { before: 0, after: 80 } }, head);
        }
        inner += blocksXml(b.blocks, ctx, { narrow: true });
        if (!/<\/w:p>$/.test(inner)) inner += para({ spacing: { before: 0, after: 0 } }, '');
        const none = (side) => `<w:${side} w:val="nil"/>`;
        const tbl = `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblBorders>${none('top')}<w:left w:val="single" w:sz="36" w:space="0" w:color="${c.color}"/>${none('bottom')}${none('right')}${none('insideH')}${none('insideV')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="220" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="220" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${TEXT_W}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${TEXT_W}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl>`;
        return para({ spacing: { before: 0, after: 0, line: 160 } }, '') + tbl + para({ spacing: { before: 0, after: 80, line: 200 } }, '');
      }
      case 'table': return tableXml(b, ctx);
      case 'img': return imageXml(b, ctx, wrap);
      case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'titleblock': return titleXml(b, ctx);
      case 'tasks': return tasksXml(b, ctx);
      case 'raw': return b.xml || '';
      default: return '';
    }
  }

  function cellXml(content, o) {
    o = o || {};
    const shd = o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(o.fill)}"/>` : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${o.w}" w:type="dxa"/>${shd}<w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;
  }

  function tableXml(b, ctx) {
    const cols = Math.max(b.head.length, ...b.rows.map(r => r.length));
    const w = Math.floor(TEXT_W / cols);
    const border = mix(ctx.accent, 0.75);
    const grid = Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('');
    const tblPr = `<w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblBorders>` +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${border}"/>`).join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
    const jc = (j) => (b.aligns && b.aligns[j] === 'center') ? 'center' : (b.aligns && b.aligns[j] === 'right') ? 'right' : 'left';
    const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${Array.from({ length: cols }, (_, j) =>
      cellXml(para({ spacing: { before: 0, after: 0 }, jc: jc(j), keepNext: true }, inlineXml(b.head[j] || [], { b: true, color: 'FFFFFF' })), { w, fill: ctx.accent })).join('')}</w:tr>`;
    const rows = b.rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: cols }, (_, j) =>
      cellXml(para({ spacing: { before: 0, after: 0 }, jc: jc(j) }, inlineXml(r[j] || [])), { w, fill: ri % 2 ? mix(ctx.accent, 0.93) : 'FFFFFF' })).join('')}</w:tr>`).join('');
    return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${head}${rows}</w:tbl>` + para({ spacing: { before: 0, after: 120 } }, '');
  }

  function b64ToBytes(b64) {
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }

  function imageXml(b, ctx, wrap) {
    if (!b.src || b.src.startsWith('search:')) return '';
    const id = b.src.startsWith('img:') ? b.src.slice(4) : b.src;
    const im = ctx.images[id];
    if (!im || !im.dataUrl) return '';
    const m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/.exec(im.dataUrl);
    if (!m) return '';
    const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
    const n = ctx.media.length + 1;
    const name = `image${n}.${ext}`;
    const rid = `rIdImg${n}`;
    ctx.media.push({ name, data: b64ToBytes(m[2]) });
    ctx.rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    const maxW = (TEXT_W - (wrap ? 600 : 0)) * EMU_PER_TWIP * (b.scale || 0.85);
    const maxH = 9.5 * 360000;
    let w = im.w || 800, h = im.h || 600;
    let cx = maxW, cy = maxW * h / w;
    if (cy > maxH) { cy = maxH; cx = maxH * w / h; }
    cx = Math.round(cx); cy = Math.round(cy);
    const pid = ctx.docPrId++;
    const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${pid}" name="Bild ${pid}" descr="${esc(b.alt || im.caption || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pid}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    ctx.figure++;
    const cap = b.alt || im.caption || '';
    let x = para(withWrap({ jc: 'center', keepNext: true, spacing: { before: 160, after: 60 } }, wrap), drawing);
    x += para(withWrap({ style: 'Caption', jc: 'center' }, wrap),
      run(`Abb. ${ctx.figure}`, { b: true, color: ctx.accent }) + (cap ? run(`: ${cap}`, null) : '') +
      (im.credit ? run(`  ·  ${im.credit}`, { color: '94A3B8', sz: 16 }) : ''));
    return x;
  }

  function titleXml(b, ctx) {
    const label = [b.emoji, (b.subject || '').toUpperCase()].filter(Boolean).join('  ');
    let x = '';
    x += para({ spacing: { before: 0, after: 40 } },
      run(label, { b: true, color: ctx.accent, sz: 20, spacing: 20 }) +
      (b.date ? run(`   ·   ${b.date}`, { color: '64748B', sz: 20 }) : ''));
    x += para({ style: 'Title' }, inlineXml(MD.parseInline(b.title || 'Mitschrift')));
    if (b.subtitle) x += para({ style: 'Subtitle' }, inlineXml(MD.parseInline(b.subtitle)));
    const meta = (b.meta || []).filter(Boolean).join('   ·   ');
    x += para({
      spacing: { before: 60, after: 280 },
      bdr: `<w:bottom w:val="single" w:sz="12" w:space="8" w:color="${ctx.accent}"/>`,
    }, meta ? run(meta, { color: '64748B', sz: 18 }) : '');
    return x;
  }

  function tasksXml(b, ctx) {
    if (!b.items || !b.items.length) return '';
    const icon = { hausuebung: '🏠', test: '🎯', abgabe: '📤', mitbringen: '🎒', info: 'ℹ️' };
    const label = { hausuebung: 'Hausübung', test: 'Test/SA', abgabe: 'Abgabe', mitbringen: 'Mitbringen', info: 'Info' };
    const cols = [1700, 5938, 2000];
    const fill = mix(ctx.accent, 0.92);
    let rows = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${['Art', 'Was', 'Bis wann'].map((h, j) => cellXml(para({ spacing: { before: 0, after: 0 } }, run(h, { b: true, color: 'FFFFFF' })), { w: cols[j], fill: ctx.accent })).join('')}</w:tr>`;
    b.items.forEach((t, i) => {
      const f = i % 2 ? fill : 'FFFFFF';
      rows += `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
        cellXml(para({ spacing: { before: 0, after: 0 } }, run(`${icon[t.type] || '📌'} ${label[t.type] || 'Info'}`, { b: true })), { w: cols[0], fill: f }) +
        cellXml(para({ spacing: { before: 0, after: 0 } }, inlineXml(MD.parseInline(t.text || ''))), { w: cols[1], fill: f }) +
        cellXml(para({ spacing: { before: 0, after: 0 } }, run(t.due || '–', { color: t.due ? 'DC2626' : '94A3B8', b: !!t.due })), { w: cols[2], fill: f }) +
        '</w:tr>';
    });
    const border = mix(ctx.accent, 0.7);
    const tblPr = `<w:tblPr><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblBorders>` +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${border}"/>`).join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>';
    return para({ style: 'Heading1' }, run(b.heading || '📌 Hausübungen & Termine', null)) +
      `<w:tbl>${tblPr}<w:tblGrid>${cols.map(c => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>` +
      para({ spacing: { before: 0, after: 200 } }, '');
  }

  // ---------- Paket-Teile ----------
  function stylesXml(accent) {
    const dark = '0F172A';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:color w:val="1E293B"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-AT" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="60" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="${dark}"/><w:kern w:val="28"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="475569"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="3" w:color="${mix(accent, 0.7)}"/></w:pBdr><w:spacing w:before="360" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="${dark}"/><w:sz w:val="27"/><w:szCs w:val="27"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/><w:color w:val="334155"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${accent}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="240" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:color w:val="0F172A"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  }

  function numberingXml(nums) {
    const bullets = ['•', '◦', '▪', '–', '•'];
    const lvls = (fmt) => bullets.map((c, i) => {
      const left = 360 * (i + 1) + 300;
      if (fmt === 'bullet') {
        return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${c}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="300"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="64748B"/></w:rPr></w:lvl>`;
      }
      const f = ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter'][i];
      const t = ['%1.', '%2)', '%3.', '%4.', '%5)'][i];
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${f}"/><w:lvlText w:val="${t}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="300"/></w:pPr><w:rPr><w:b/></w:rPr></w:lvl>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
${nums.map(n => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride><w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('\n')}
</w:numbering>`;
  }

  const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS}><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr><w:decimalSymbol w:val=","/><w:listSeparator w:val=";"/></w:settings>`;

  function headerXml(text) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${run(text, null)}</w:p></w:hdr>`;
  }

  function footerXml(text) {
    const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${run((text ? text + '   ·   ' : '') + 'Seite ', null)}${fld('PAGE')}${run(' von ', null)}${fld('NUMPAGES')}</w:p></w:ftr>`;
  }

  /**
   * @param {object} doc
   *   doc.blocks   – Blockliste (aus MD.parse + Sonderblöcke titleblock/tasks/pagebreak)
   *   doc.accent   – Akzentfarbe (Hex)
   *   doc.images   – { id: {dataUrl, w, h, caption, credit} }
   *   doc.header, doc.footer, doc.title, doc.author
   * @returns {Promise<Blob|Uint8Array>}
   */
  async function buildDocx(doc) {
    const JSZip = getJSZip();
    const ctx = new Ctx({ accent: doc.accent, images: doc.images });
    const body = blocksXml(doc.blocks || [], ctx, null);
    const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>`;
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title || 'Mitschrift')}</dc:title><dc:subject>${esc(doc.subject || '')}</dc:subject><dc:creator>${esc(doc.author || 'AutoDoku')}</dc:creator><cp:lastModifiedBy>AutoDoku</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AutoDoku</Application></Properties>`);
    zip.file('word/document.xml', document);
    zip.file('word/styles.xml', stylesXml(ctx.accent));
    zip.file('word/numbering.xml', numberingXml(ctx.nums));
    zip.file('word/settings.xml', SETTINGS);
    zip.file('word/header1.xml', headerXml(doc.header || 'AutoDoku'));
    zip.file('word/footer1.xml', footerXml(doc.footer || ''));
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${ctx.rels.join('')}</Relationships>`);
    for (const m of ctx.media) zip.file(`word/media/${m.name}`, m.data);
    const isBrowser = typeof window !== 'undefined' && typeof Blob !== 'undefined';
    return zip.generateAsync({
      type: isBrowser ? 'blob' : 'nodebuffer',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  const api = { buildDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocxBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);
