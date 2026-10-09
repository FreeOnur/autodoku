/*
 * AutoDoku – LaTeX → OMML (native Word-Formeln)
 * Wandelt eine praxistaugliche LaTeX-Teilmenge in Office Math Markup um,
 * sodass Formeln in Word als echte, bearbeitbare Gleichungen erscheinen.
 */
(function (root) {
  'use strict';

  const SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
    varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
    leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥', neq: '≠', ne: '≠', approx: '≈',
    equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', doteq: '≐',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', subsetneq: '⊊',
    cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
    oplus: '⊕', otimes: '⊗', odot: '⊙',
    to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐',
    Leftrightarrow: '⇔', leftrightarrow: '↔', iff: '⟺', implies: '⟹', impliedby: '⟸', mapsto: '↦',
    uparrow: '↑', downarrow: '↓', longrightarrow: '⟶', Longrightarrow: '⟹', longleftarrow: '⟵',
    rightleftharpoons: '⇌', nearrow: '↗', searrow: '↘',
    infty: '∞', partial: '∂', nabla: '∇', angle: '∠', measuredangle: '∡', perp: '⊥', parallel: '∥',
    degree: '°', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', hbar: 'ℏ',
    ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', triangle: '△', square: '□', checkmark: '✓', therefore: '∴',
    because: '∵', top: '⊤', bot: '⊥', wp: '℘', mid: '∣', nmid: '∤', vert: '|', Vert: '‖',
    langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
    quad: ' ', qquad: '  ', ',': ' ', ':': ' ', '>': ' ', ';': ' ',
    '!': '', ' ': ' ', '{': '{', '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_',
    '|': '‖', backslash: '\\', colon: ':', lbrace: '{', rbrace: '}', dagger: '†', euro: '€',
    cdotp: '⋅', centerdot: '⋅', smallsetminus: '∖', complement: '∁', models: '⊨', vdash: '⊢',
    approxeq: '≊', asymp: '≍', bigstar: '★', diamond: '⋄', Box: '□', S: '§', P: '¶', copyright: '©',
  };

  const NARY = {
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀', bigoplus: '⨁', bigotimes: '⨂',
  };

  const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot',
    'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker', 'gcd', 'deg', 'arg',
    'hom', 'Pr', 'sgn', 'tr', 'rank', 'ggT', 'kgV']);
  const LIMFUNCS = new Set(['lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'argmax', 'argmin']);
  const LIMNAMES = { limsup: 'lim sup', liminf: 'lim inf', argmax: 'arg max', argmin: 'arg min' };

  const ACCENTS = {
    hat: '̂', widehat: '̂', tilde: '̃', widetilde: '̃', dot: '̇',
    ddot: '̈', vec: '⃗', overrightarrow: '⃗', check: '̌', breve: '̆',
    acute: '́', grave: '̀', overleftarrow: '⃖',
  };

  const FONTS = {
    mathbb: { scr: 'double-struck', sty: 'p' }, Bbb: { scr: 'double-struck', sty: 'p' },
    mathcal: { scr: 'script' }, mathscr: { scr: 'script' }, mathfrak: { scr: 'fraktur' },
    mathrm: { sty: 'p' }, rm: { sty: 'p' }, mathbf: { sty: 'b' }, bf: { sty: 'b' }, mathit: { sty: 'i' },
    boldsymbol: { sty: 'bi' }, bm: { sty: 'bi' }, mathsf: { scr: 'sans-serif', sty: 'p' },
    mathtt: { scr: 'monospace', sty: 'p' }, mathnormal: {},
  };

  const TEXTCMDS = new Set(['text', 'textrm', 'textbf', 'textit', 'mbox', 'textsf', 'texttt', 'textnormal', 'hbox']);

  const DELIMS = {
    '{': '{', '}': '}', lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', vert: '|', lvert: '|',
    rvert: '|', Vert: '‖', lVert: '‖', rVert: '‖', '|': '‖', lfloor: '⌊', rfloor: '⌋', lceil: '⌈',
    rceil: '⌉', backslash: '\\', uparrow: '↑', downarrow: '↓',
  };

  const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'nonumber',
    'notag', 'left.', 'right.', 'allowbreak', 'nobreak', 'relax', 'strut', 'centering', 'hfill', 'small',
    'large', 'Large', 'normalsize', 'footnotesize']);

  const RELATIONS = new Set(['=', '<', '>']);
  const RELCMDS = new Set(['leq', 'le', 'geq', 'ge', 'neq', 'ne', 'approx', 'equiv', 'sim', 'simeq',
    'cong', 'propto', 'll', 'gg', 'to', 'rightarrow', 'Rightarrow', 'Leftrightarrow', 'iff', 'implies',
    'mapsto', 'in', 'notin', 'subset', 'subseteq', 'leqslant', 'geqslant', 'longrightarrow', 'quad', 'qquad']);

  // ---------- Tokenizer ----------
  function tokenize(s) {
    const toks = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        const n = s[i + 1];
        if (n === undefined) { i++; continue; }
        if (/[a-zA-Z]/.test(n)) {
          let j = i + 1;
          while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
          const name = s.slice(i + 1, j);
          i = j;
          if (TEXTCMDS.has(name)) {
            // rohen Text in geschweiften Klammern übernehmen (Leerzeichen bleiben erhalten)
            while (i < s.length && s[i] === ' ') i++;
            if (s[i] === '{') {
              let depth = 0, k = i;
              for (; k < s.length; k++) {
                if (s[k] === '\\') { k++; continue; }
                if (s[k] === '{') depth++;
                else if (s[k] === '}') { depth--; if (depth === 0) break; }
              }
              const raw = s.slice(i + 1, k).replace(/\\([%$&#_{}])/g, '$1').replace(/\\,|~/g, ' ');
              toks.push({ k: 'text', cmd: name, v: raw });
              i = k + 1;
            } else {
              toks.push({ k: 'text', cmd: name, v: '' });
            }
          } else {
            toks.push({ k: 'cmd', v: name });
          }
        } else if (n === '\\') {
          toks.push({ k: 'nl' });
          i += 2;
          // optionales [2mm] nach Zeilenumbruch ignorieren
          const m = /^\s*\[[^\]]*\]/.exec(s.slice(i));
          if (m) i += m[0].length;
        } else {
          toks.push({ k: 'cmd', v: n });
          i += 2;
        }
      } else if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') {
        toks.push({ k: c }); i++;
      } else if (/\s/.test(c)) {
        i++;
      } else if (c === '~') {
        toks.push({ k: 'char', v: ' ' }); i++;
      } else if (/[0-9]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        // Dezimalkomma (3{,}14) wird über Gruppen erledigt
        toks.push({ k: 'num', v: s.slice(i, j) });
        i = j;
      } else if (c === "'") {
        let j = i; let p = '';
        while (s[j] === "'") { p += '′'; j++; }
        toks.push({ k: 'char', v: p.length === 2 ? '″' : p.length === 3 ? '‴' : p }); i = j;
      } else {
        toks.push({ k: 'char', v: c }); i++;
      }
    }
    return toks;
  }

  // ---------- Parser ----------
  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; }
    peek(o = 0) { return this.t[this.i + o]; }
    next() { return this.t[this.i++]; }
    eof() { return this.i >= this.t.length; }

    parseSeq(stop) {
      const out = [];
      while (!this.eof()) {
        const tk = this.peek();
        if (stop && stop(tk)) break;
        if (tk.k === '}') { this.i++; continue; } // verirrte Klammer
        const start = this.i;
        const node = this.parseScripted();
        if (node) out.push(node);
        if (this.i === start) this.i++; // Sicherheitsnetz gegen Endlosschleifen
      }
      return out;
    }

    // Argument: {gruppe} oder ein einzelnes Atom
    parseArg() {
      const tk = this.peek();
      if (!tk) return [];
      if (tk.k === '{') {
        this.i++;
        const c = this.parseSeq(t => t.k === '}');
        if (this.peek() && this.peek().k === '}') this.i++;
        return c;
      }
      if (tk.k === 'num' && tk.v.length > 1) {
        const first = tk.v[0];
        tk.v = tk.v.slice(1);
        return [{ t: 'r', v: first }];
      }
      if (tk.k === '^' || tk.k === '_' || tk.k === '}' || tk.k === '&' || tk.k === 'nl') return [];
      const a = this.parseAtom();
      return a ? [a] : [];
    }

    parseOptArg() {
      const tk = this.peek();
      if (tk && tk.k === 'char' && tk.v === '[') {
        this.i++;
        const c = this.parseSeq(t => t.k === 'char' && t.v === ']');
        if (this.peek()) this.i++;
        return c;
      }
      return null;
    }

    parseScripted() {
      let base = this.parseAtom();
      if (base === null) return null;
      let sb = null, sp = null;
      while (this.peek() && (this.peek().k === '^' || this.peek().k === '_')) {
        const k = this.next().k;
        const arg = this.parseArg();
        if (k === '^') {
          if (sp) { base = this.mkScript(base, sb, sp); sb = null; }
          sp = arg;
        } else {
          if (sb) { base = this.mkScript(base, sb, sp); sp = null; }
          sb = arg;
        }
        // Striche nach Exponent (f^2') – selten, als Text anhängen
      }
      return this.mkScript(base, sb, sp);
    }

    mkScript(base, sb, sp) {
      if (!sb && !sp) return base;
      if (base.t === 'gc') {
        if (base.pos === 'bot' && sb && !sp) return { t: 'limLow', e: [base], lim: sb };
        if (base.pos === 'top' && sp && !sb) return { t: 'limUpp', e: [base], lim: sp };
      }
      if (sb && sp) return { t: 'subsup', e: [base], sb, sp };
      if (sp) return { t: 'sup', e: [base], s: sp };
      return { t: 'sub', e: [base], s: sb };
    }

    // passende schließende Klammer finden -> Delimiter-Objekt
    tryDelim() {
      const open = this.peek().v;
      const close = open === '(' ? ')' : ']';
      let brace = 0, depth = 0, j = this.i + 1;
      for (; j < this.t.length; j++) {
        const tk = this.t[j];
        if (tk.k === '{') brace++;
        else if (tk.k === '}') { if (brace === 0) return null; brace--; }
        else if (tk.k === 'nl' || tk.k === '&') { if (brace === 0) return null; }
        else if (tk.k === 'cmd' && (tk.v === 'right' || tk.v === 'end') && brace === 0) return null;
        else if (tk.k === 'char' && brace === 0) {
          if (tk.v === open) depth++;
          else if (tk.v === close) { if (depth === 0) break; depth--; }
        }
      }
      if (j >= this.t.length) return null;
      const closeIdx = j;
      this.i++;
      const inner = this.parseSeq(() => this.i === closeIdx);
      this.i = closeIdx + 1;
      return { t: 'd', o: open, c: close, e: inner };
    }

    readDelim() {
      const tk = this.next();
      if (!tk) return '';
      if (tk.k === 'char') return tk.v === '.' ? '' : tk.v;
      if (tk.k === 'cmd') return DELIMS[tk.v] !== undefined ? DELIMS[tk.v] : (SYMBOLS[tk.v] || '');
      if (tk.k === '{' || tk.k === '}') return tk.k;
      return '';
    }

    readEnvName() {
      let name = '';
      if (this.peek() && this.peek().k === '{') {
        this.i++;
        while (!this.eof() && this.peek().k !== '}') {
          const tk = this.next();
          name += tk.v || '';
        }
        this.i++;
      }
      return name;
    }

    parseAtom() {
      const tk = this.next();
      if (!tk) return null;
      switch (tk.k) {
        case 'num': return { t: 'r', v: tk.v };
        case 'char': {
          if (tk.v === '(' || tk.v === '[') {
            this.i--;
            const d = this.tryDelim();
            if (d) return d;
            this.i++;
          }
          const map = { '-': '−', '*': '∗', '<': '<', '>': '>' };
          return { t: 'r', v: map[tk.v] || tk.v };
        }
        case '{': {
          const c = this.parseSeq(t => t.k === '}');
          if (this.peek() && this.peek().k === '}') this.i++;
          return { t: 'grp', c };
        }
        case 'text': {
          const s = { nor: true };
          if (tk.cmd === 'textbf') s.b = true;
          if (tk.cmd === 'textit') s.i = true;
          return { t: 'sty', s, c: [{ t: 'r', v: tk.v }] };
        }
        case 'cmd': return this.parseCmd(tk.v);
        case '^': case '_':
          this.i--;
          return { t: 'r', v: '' };
        case '&': return { t: 'aln' };
        case 'nl': return null;
        default: return null;
      }
    }

    parseNaryBody(isInt) {
      const out = [];
      while (!this.eof()) {
        const tk = this.peek();
        if (tk.k === '}' || tk.k === '&' || tk.k === 'nl') break;
        if (tk.k === 'cmd' && (tk.v === 'right' || tk.v === 'end' || tk.v === 'middle')) break;
        if (out.length > 0) {
          if (tk.k === 'char' && (RELATIONS.has(tk.v) || tk.v === ',' || (!isInt && (tk.v === '+' || tk.v === '-')))) break;
          if (tk.k === 'cmd' && (RELCMDS.has(tk.v) || (!isInt && (tk.v === 'pm' || tk.v === 'mp')))) break;
        }
        // Differential bei Integralen: d + Variable -> mitnehmen und abbrechen
        if (isInt && out.length > 0 && this.isDifferential()) {
          out.push(this.parseScripted());
          out.push(this.parseScripted());
          break;
        }
        const start = this.i;
        const n = this.parseScripted();
        if (n) out.push(n);
        if (this.i === start) this.i++;
      }
      return out;
    }

    isDifferential() {
      const a = this.peek(), b = this.peek(1);
      if (!a || !b) return false;
      const isD = (a.k === 'char' && a.v === 'd') ||
        (a.k === 'cmd' && a.v === 'mathrm' && b.k === '{') ||
        (a.k === 'text' && a.v === 'd');
      if (!isD) return false;
      if (a.k === 'cmd') return true;
      return (b.k === 'char' && /[a-zA-Z]/.test(b.v)) || (b.k === 'cmd' && /^(theta|varphi|phi|tau|omega|alpha|beta|lambda|mu|rho|sigma|xi|eta)$/.test(b.v));
    }

    parseLimits(node) {
      while (this.peek() && (this.peek().k === '^' || this.peek().k === '_' ||
        (this.peek().k === 'cmd' && (this.peek().v === 'limits' || this.peek().v === 'nolimits')))) {
        const tk = this.next();
        if (tk.k === 'cmd') continue;
        const arg = this.parseArg();
        if (tk.k === '^') node.sup = arg; else node.sub = arg;
      }
    }

    parseCmd(name) {
      if (IGNORE.has(name)) return null;
      if (NARY[name]) {
        const isInt = /int$/.test(name);
        const node = { t: 'nary', chr: NARY[name], sub: null, sup: null, isInt };
        this.parseLimits(node);
        node.e = this.parseNaryBody(isInt);
        return node;
      }
      if (LIMFUNCS.has(name)) {
        const node = { t: 'func', name: [{ t: 'r', v: LIMNAMES[name] || name }], lim: null, sp: null };
        this.parseLimits(node);
        node.lim = node.sub || null;
        node.sp = node.sup || null;
        node.e = this.funcArg();
        return node;
      }
      if (FUNCS.has(name)) {
        const node = { t: 'func', name: [{ t: 'r', v: name }] };
        this.parseLimits(node);
        node.e = this.funcArg();
        return node;
      }
      if (Object.prototype.hasOwnProperty.call(ACCENTS, name)) {
        return { t: 'acc', chr: ACCENTS[name], e: this.parseArg() };
      }
      if (FONTS[name]) {
        return { t: 'sty', s: Object.assign({}, FONTS[name]), c: this.parseArg() };
      }
      if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) {
        return { t: 'r', v: SYMBOLS[name] };
      }
      switch (name) {
        case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
          const n = this.parseArg();
          const d = this.parseArg();
          return { t: 'f', n, d, lin: name === 'tfrac' };
        }
        case 'binom': case 'dbinom': case 'tbinom': case 'choose': {
          const n = this.parseArg();
          const d = this.parseArg();
          return { t: 'd', o: '(', c: ')', e: [{ t: 'f', n, d, noBar: true }] };
        }
        case 'sqrt': {
          const deg = this.parseOptArg();
          return { t: 'rad', deg, e: this.parseArg() };
        }
        case 'left': {
          const o = this.readDelim();
          const c = this.parseSeq(t => t.k === 'cmd' && t.v === 'right');
          let cl = '';
          if (this.peek() && this.peek().k === 'cmd' && this.peek().v === 'right') { this.i++; cl = this.readDelim(); }
          return { t: 'd', o, c: cl, e: c };
        }
        case 'right': this.readDelim(); return null;
        case 'middle': return { t: 'r', v: this.readDelim() };
        case 'big': case 'Big': case 'bigg': case 'Bigg': case 'bigl': case 'bigr': case 'Bigl':
        case 'Bigr': case 'biggl': case 'biggr': case 'Biggl': case 'Biggr': case 'bigm': case 'Bigm':
          return { t: 'r', v: this.readDelim() };
        case 'begin': return this.parseEnv();
        case 'end': this.readEnvName(); return null;
        case 'overline': case 'bar': return { t: 'bar', pos: 'top', e: this.parseArg() };
        case 'underline': return { t: 'bar', pos: 'bot', e: this.parseArg() };
        case 'overbrace': return { t: 'gc', chr: '⏞', pos: 'top', e: this.parseArg() };
        case 'underbrace': return { t: 'gc', chr: '⏟', pos: 'bot', e: this.parseArg() };
        case 'overset': case 'stackrel': { const a = this.parseArg(); const b = this.parseArg(); return { t: 'limUpp', e: b, lim: a }; }
        case 'underset': { const a = this.parseArg(); const b = this.parseArg(); return { t: 'limLow', e: b, lim: a }; }
        case 'xrightarrow': case 'xleftarrow': {
          const below = this.parseOptArg();
          const lim = this.parseArg();
          const arrow = { t: 'r', v: name === 'xrightarrow' ? '⟶' : '⟵' };
          const up = { t: 'limUpp', e: [arrow], lim };
          return below ? { t: 'limLow', e: [up], lim: below } : up;
        }
        case 'boxed': case 'fbox': return { t: 'box', e: this.parseArg() };
        case 'operatorname': case 'operatorname*': {
          const n = this.parseArg();
          const node = { t: 'func', name: n };
          this.parseLimits(node);
          if (node.sub) { node.lim = node.sub; }
          node.e = this.funcArg();
          return node;
        }
        case 'pmod': {
          const a = this.parseArg();
          return { t: 'grp', c: [{ t: 'sty', s: { sty: 'p' }, c: [{ t: 'r', v: ' (mod ' }] }, ...a, { t: 'r', v: ')' }] };
        }
        case 'bmod': case 'mod': return { t: 'sty', s: { sty: 'p' }, c: [{ t: 'r', v: ' mod ' }] };
        case 'not': {
          const nx = this.peek();
          if (nx && nx.k === 'char' && nx.v === '=') { this.i++; return { t: 'r', v: '≠' }; }
          if (nx && nx.k === 'cmd' && nx.v === 'in') { this.i++; return { t: 'r', v: '∉' }; }
          if (nx && nx.k === 'cmd' && nx.v === 'subset') { this.i++; return { t: 'r', v: '⊄' }; }
          if (nx && nx.k === 'cmd' && nx.v === 'equiv') { this.i++; return { t: 'r', v: '≢' }; }
          return { t: 'r', v: '̸' };
        }
        case 'color': this.parseArg(); return null;
        case 'textcolor': case 'colorbox': this.parseArg(); return { t: 'grp', c: this.parseArg() };
        case 'phantom': case 'hphantom': case 'vphantom': this.parseArg(); return null;
        case 'label': case 'hspace': case 'vspace': case 'kern': case 'mkern': this.parseArg(); return null;
        case 'tag': { const a = this.parseArg(); return { t: 'grp', c: [{ t: 'r', v: ' (' }, ...a, { t: 'r', v: ')' }] }; }
        case 'cancel': case 'bcancel': case 'xcancel': return { t: 'grp', c: this.parseArg() };
        case 'unit': case 'si': case 'SI': {
          // siunitx: \SI{5}{\meter}
          if (name === 'SI') { const v = this.parseArg(); const u = this.parseArg(); return { t: 'grp', c: [...v, { t: 'r', v: ' ' }, { t: 'sty', s: { sty: 'p' }, c: u }] }; }
          return { t: 'sty', s: { sty: 'p' }, c: this.parseArg() };
        }
        default:
          return { t: 'sty', s: { sty: 'p' }, c: [{ t: 'r', v: name }] };
      }
    }

    funcArg() {
      const tk = this.peek();
      if (!tk || tk.k === '}' || tk.k === '&' || tk.k === 'nl') return [];
      if (tk.k === 'char' && /[=+\-<>,]/.test(tk.v)) return [];
      if (tk.k === 'cmd' && (RELCMDS.has(tk.v) || tk.v === 'right' || tk.v === 'end')) return [];
      const n = this.parseScripted();
      return n ? [n] : [];
    }

    parseRows() {
      const rows = [];
      let row = [];
      while (!this.eof()) {
        const cell = this.parseSeq(t => t.k === '&' || t.k === 'nl' || (t.k === 'cmd' && t.v === 'end'));
        row.push(cell);
        const tk = this.next();
        if (!tk) break;
        if (tk.k === '&') continue;
        if (tk.k === 'nl') { rows.push(row); row = []; continue; }
        if (tk.k === 'cmd' && tk.v === 'end') { this.readEnvName(); break; }
      }
      if (row.length && !(row.length === 1 && row[0].length === 0)) rows.push(row);
      return rows;
    }

    parseEnv() {
      const name = this.readEnvName().replace('*', '');
      if (name === 'array' || name === 'tabular' || name === 'alignat') {
        if (this.peek() && this.peek().k === '{') this.parseArg();
      }
      const rows = this.parseRows();
      const MATRIX = { matrix: ['', ''], smallmatrix: ['', ''], array: ['', ''], pmatrix: ['(', ')'],
        bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], tabular: ['', ''] };
      if (MATRIX[name]) {
        const m = { t: 'm', rows };
        const [o, c] = MATRIX[name];
        return o || c ? { t: 'd', o, c, e: [m] } : m;
      }
      if (name === 'cases' || name === 'dcases' || name === 'rcases') {
        const arr = {
          t: 'eqArr',
          rows: rows.map(cells => {
            const out = [];
            cells.forEach((c, idx) => { if (idx > 0) out.push({ t: 'r', v: '  ' }); out.push(...c); });
            return out;
          }),
        };
        return name === 'rcases' ? { t: 'd', o: '', c: '}', e: [arr] } : { t: 'd', o: '{', c: '', e: [arr] };
      }
      // aligned, align, split, gather, eqnarray, multline …
      return {
        t: 'eqArr',
        rows: rows.map(cells => {
          const out = [];
          cells.forEach((c, idx) => { if (idx > 0) out.push({ t: 'aln' }); out.push(...c); });
          return out;
        }),
      };
    }
  }

  // ---------- Serialisierung ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function runXml(v, sty, aln) {
    let mr = '';
    if (sty && sty.nor) mr += '<m:nor/>';
    else {
      if (sty && sty.scr) mr += `<m:scr m:val="${sty.scr}"/>`;
      if (sty && sty.sty) mr += `<m:sty m:val="${sty.sty}"/>`;
    }
    if (aln) mr += '<m:aln/>';
    let wr = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';
    if (sty && sty.nor && sty.b) wr += '<w:b/>';
    if (sty && sty.nor && sty.i) wr += '<w:i/>';
    return `<m:r>${mr ? `<m:rPr>${mr}</m:rPr>` : ''}<w:rPr>${wr}</w:rPr><m:t xml:space="preserve">${esc(v)}</m:t></m:r>`;
  }

  function prep(nodes) {
    const out = [];
    let pendingAln = false;
    for (const n of nodes || []) {
      if (!n) continue;
      if (n.t === 'aln') { pendingAln = true; continue; }
      if (n.t === 'r') {
        const last = out[out.length - 1];
        if (pendingAln) { out.push({ t: 'r', v: n.v, aln: true }); pendingAln = false; continue; }
        if (last && last.t === 'r' && !last.noMerge) { last.v += n.v; continue; }
        out.push({ t: 'r', v: n.v });
        continue;
      }
      if (pendingAln) { out.push({ t: 'r', v: '', aln: true, noMerge: true }); pendingAln = false; }
      out.push(n);
    }
    if (pendingAln) out.push({ t: 'r', v: '', aln: true });
    return out;
  }

  function S(nodes, ctx) {
    return prep(nodes).map(n => ser(n, ctx)).join('');
  }

  const E = (tag, inner) => inner ? `<m:${tag}>${inner}</m:${tag}>` : `<m:${tag}/>`;

  function ser(n, ctx) {
    switch (n.t) {
      case 'r': return n.v === '' && !n.aln ? '' : runXml(n.v, ctx.sty, n.aln);
      case 'grp': return S(n.c, ctx);
      case 'sty': {
        const s = Object.assign({}, ctx.sty || {}, n.s);
        if (n.s.nor) { delete s.scr; delete s.sty; }
        return S(n.c, Object.assign({}, ctx, { sty: s }));
      }
      case 'f':
        return `<m:f>${n.noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : n.lin ? '<m:fPr><m:type m:val="skw"/></m:fPr>' : ''}${E('num', S(n.n, ctx))}${E('den', S(n.d, ctx))}</m:f>`;
      case 'sup': return `<m:sSup>${E('e', S(n.e, ctx))}${E('sup', S(n.s, ctx))}</m:sSup>`;
      case 'sub': return `<m:sSub>${E('e', S(n.e, ctx))}${E('sub', S(n.s, ctx))}</m:sSub>`;
      case 'subsup': return `<m:sSubSup>${E('e', S(n.e, ctx))}${E('sub', S(n.sb, ctx))}${E('sup', S(n.sp, ctx))}</m:sSubSup>`;
      case 'rad':
        if (n.deg && n.deg.length) return `<m:rad>${E('deg', S(n.deg, ctx))}${E('e', S(n.e, ctx))}</m:rad>`;
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${E('e', S(n.e, ctx))}</m:rad>`;
      case 'nary': {
        let pr = '';
        if (n.chr !== '∫') pr += `<m:chr m:val="${n.chr}"/>`;
        pr += `<m:limLoc m:val="${n.isInt ? 'subSup' : 'undOvr'}"/>`;
        if (!n.sub) pr += '<m:subHide m:val="1"/>';
        if (!n.sup) pr += '<m:supHide m:val="1"/>';
        return `<m:nary><m:naryPr>${pr}</m:naryPr>${E('sub', S(n.sub, ctx))}${E('sup', S(n.sup, ctx))}${E('e', S(n.e, ctx))}</m:nary>`;
      }
      case 'func': {
        const pctx = Object.assign({}, ctx, { sty: { sty: 'p' } });
        let name = S(n.name, pctx);
        if (n.lim) name = `<m:limLow>${E('e', name)}${E('lim', S(n.lim, ctx))}</m:limLow>`;
        else if (n.sub && n.sup) name = `<m:sSubSup>${E('e', name)}${E('sub', S(n.sub, ctx))}${E('sup', S(n.sup, ctx))}</m:sSubSup>`;
        else if (n.sub) name = `<m:sSub>${E('e', name)}${E('sub', S(n.sub, ctx))}</m:sSub>`;
        else if (n.sup) name = `<m:sSup>${E('e', name)}${E('sup', S(n.sup, ctx))}</m:sSup>`;
        if (n.lim && n.sp) name = `<m:sSup>${E('e', name)}${E('sup', S(n.sp, ctx))}</m:sSup>`;
        return `<m:func>${E('fName', name)}${E('e', S(n.e, ctx))}</m:func>`;
      }
      case 'd': {
        // Klammern immer explizit angeben (manche Programme raten sonst falsch)
        const pr = `<m:begChr m:val="${esc(n.o)}"/><m:endChr m:val="${esc(n.c)}"/>`;
        return `<m:d><m:dPr>${pr}</m:dPr>${E('e', S(n.e, ctx))}</m:d>`;
      }
      case 'm': {
        const cols = Math.max(1, ...n.rows.map(r => r.length));
        const rows = n.rows.map(r => {
          const cells = r.slice();
          while (cells.length < cols) cells.push([]);
          return `<m:mr>${cells.map(c => E('e', S(c, ctx))).join('')}</m:mr>`;
        }).join('');
        return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${rows}</m:m>`;
      }
      case 'eqArr':
        return `<m:eqArr>${n.rows.map(r => E('e', S(r, ctx))).join('') || '<m:e/>'}</m:eqArr>`;
      case 'acc': return `<m:acc><m:accPr><m:chr m:val="${n.chr}"/></m:accPr>${E('e', S(n.e, ctx))}</m:acc>`;
      case 'bar': return `<m:bar><m:barPr><m:pos m:val="${n.pos}"/></m:barPr>${E('e', S(n.e, ctx))}</m:bar>`;
      case 'gc':
        return `<m:groupChr><m:groupChrPr><m:chr m:val="${n.chr}"/><m:pos m:val="${n.pos}"/><m:vertJc m:val="${n.pos === 'bot' ? 'top' : 'bot'}"/></m:groupChrPr>${E('e', S(n.e, ctx))}</m:groupChr>`;
      case 'limLow': return `<m:limLow>${E('e', S(n.e, ctx))}${E('lim', S(n.lim, ctx))}</m:limLow>`;
      case 'limUpp': return `<m:limUpp>${E('e', S(n.e, ctx))}${E('lim', S(n.lim, ctx))}</m:limUpp>`;
      case 'box': return `<m:borderBox>${E('e', S(n.e, ctx))}</m:borderBox>`;
      default: return '';
    }
  }

  function parse(latex) {
    let src = String(latex || '').trim();
    // Zeilenumbrüche ohne Umgebung -> aligned
    if (/\\\\/.test(src) && !/\\begin\s*\{/.test(src)) src = `\\begin{aligned}${src}\\end{aligned}`;
    const p = new Parser(tokenize(src));
    return p.parseSeq(null);
  }

  /**
   * @param {string} latex
   * @param {{display?: boolean}} [opts]
   * @returns {string} OMML-XML (<m:oMath> oder <m:oMathPara>)
   */
  function latexToOMML(latex, opts) {
    const display = opts && opts.display;
    let inner;
    try {
      inner = S(parse(latex), { sty: null });
    } catch (e) {
      inner = runXml(latex, { nor: true });
    }
    if (!inner) inner = runXml(' ', null);
    const om = `<m:oMath>${inner}</m:oMath>`;
    if (!display) return om;
    return `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${om}</m:oMathPara>`;
  }

  const api = { latexToOMML, _parse: parse, _tokenize: tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LatexOMML = api;
})(typeof window !== 'undefined' ? window : globalThis);
