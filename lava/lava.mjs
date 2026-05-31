#!/usr/bin/env node
// Lava — execution engine.
//
// Slice 1 (core): containers, constants, update, bracketed math, predicates
//   (is / and / or / not), if-then-else, print, comments.
// Slice 2 (actions): flat sealed actions with capability footprints.
//   - create action "name" [reads <list>] [writes <list>] as <body> end
//   - actions are called from the top-level orchestrator: name()
//   - actions CANNOT call other actions
//   - an action body may only touch state named in its header; the loader
//     statically rejects any read/write outside the declared footprint
//   - printing is a write to the built-in `Console` origin, so an action that
//     prints must declare `writes Console`
//   - the top level is ambient authority: it may read/write/print/call freely
//
// Not yet: patterns, classes, states, loops, wait, filesystem, UserInput, match.

import { readFileSync } from 'node:fs';

// Lava is built on match: a pattern's text-shape is compiled to a match grammar
// and executed by the match VM we ship in ../dist.
import { parse as matchParse, compile as matchCompile, fastMatch } from '../dist/esm/index.js';

const KEYWORDS = new Set([
  'create', 'container', 'constant', 'action', 'pattern', 'of', 'type', 'with', 'value',
  'int', 'string', 'update', 'to', 'if', 'then', 'else',
  'and', 'or', 'not', 'is', 'print', 'Print',
  'reads', 'writes', 'as', 'end',
  'loop', 'until', 'times', 'break',
  'extract', 'from', 'start', 'stop', 'at', 'after', 'before', 'char',
]);
const BINOPS = new Set(['+', '-', '*', '/', '^', '√']);
const BUILTIN_ORIGINS = new Set(['Console']);

class LavaError extends Error {}
class BreakSignal {} // control-flow sentinel for `break`, caught by the enclosing loop

// ---------- match dialect ----------
// Lava's pattern language is match under a strict dialect:
//   - no quoted character literals anywhere (markers included): `pipe`, not "|"
//   - canonical name per byte: `minus` not dash/hyphen, `period` not dot
//   - `unreserved character` is the named class for letter/digit/-/./_/~
const CANONICAL_CHARS = {
  minus: '-', period: '.', underscore: '_', tilde: '~', pipe: '|',
  colon: ':', semicolon: ';', comma: ',', slash: '/', backslash: '\\',
  at: '@', hash: '#', dollar: '$', percent: '%', ampersand: '&',
  asterisk: '*', plus: '+', equals: '=', question: '?', caret: '^',
  backtick: '`', space: ' ', tab: '\t', exclamation: '!',
  'double quote': '"', 'single quote': "'",
  'open paren': '(', 'close paren': ')', 'open bracket': '[', 'close bracket': ']',
  'open brace': '{', 'close brace': '}', 'less than': '<', 'greater than': '>',
};
// synonyms match accepts but Lava forbids → point at the one canonical spelling
const FORBIDDEN_SYNONYM = { dash: 'minus', hyphen: 'minus', dot: 'period', bang: 'exclamation' };
// canonical name → the name match's own grammar uses (match has no `minus`)
const TO_MATCH_NAME = { minus: 'hyphen', period: 'period', exclamation: 'exclamation' };

// Turn a Lava shape into a match grammar body. Word-level: letters/spaces form
// words, parentheses pass through, everything else (quotes especially) is rejected.
function shapeToMatchBody(shape, lineNo) {
  const out = [];
  let i = 0;
  while (i < shape.length) {
    const ch = shape[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '(' || ch === ')') { out.push(ch); i++; continue; }
    if (ch === '"') throw new LavaError(`Quoted literals are not allowed in patterns — use a character name (line ${lineNo})`);
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      let w = ''; while (i < shape.length && /[A-Za-z0-9]/.test(shape[i])) w += shape[i++];
      out.push({ word: w });
      continue;
    }
    throw new LavaError(`Unexpected '${ch}' in pattern (line ${lineNo})`);
  }
  // reassemble into a flat token list of words/parens, then phrase-rewrite
  const words = out.map(t => (typeof t === 'string' ? t : t.word));
  let s = words.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');

  // reject forbidden synonyms (whole-word)
  for (const [bad, good] of Object.entries(FORBIDDEN_SYNONYM)) {
    if (new RegExp(`\\b${bad}\\b`).test(s))
      throw new LavaError(`'${bad}' is not allowed — use '${good}' (line ${lineNo})`);
  }
  // expand the named class, then map canonical names match doesn't share
  s = s.replace(/\bunreserved character\b/g, '(letter or digit or hyphen or period or underscore or tilde)');
  for (const [lava, m] of Object.entries(TO_MATCH_NAME)) s = s.replace(new RegExp(`\\b${lava}\\b`, 'g'), m);
  return s;
}

function compileShape(shape, lineNo) {
  const body = shapeToMatchBody(shape, lineNo);
  let cp;
  try { cp = matchCompile(matchParse('main: ' + body)); }
  catch (e) { throw new LavaError(`pattern shape is not valid match: ${e.message} (line ${lineNo})`); }
  return cp;
}

function markerChar(marker, lineNo) {
  if (marker.type === 'char') return null; // positional, handled separately
  const c = CANONICAL_CHARS[marker.name];
  if (c === undefined) throw new LavaError(`'${marker.name}' is not a known character name (line ${lineNo})`);
  return c;
}

function makeMarker(anchor, rest, lineNo) {
  rest = rest.trim();
  if (anchor !== 'at' && anchor !== 'after' && anchor !== 'before')
    throw new LavaError(`Expected at/after/before in pattern anchor (line ${lineNo})`);
  if (rest.startsWith('char ')) {
    const n = parseInt(rest.slice(5).trim(), 10);
    if (!Number.isInteger(n) || n < 1) throw new LavaError(`'char' needs a positive position (line ${lineNo})`);
    return { anchor, marker: { type: 'char', position: n } };
  }
  if (/["']/.test(rest)) throw new LavaError(`Quoted literals are not allowed as markers — use a character name (line ${lineNo})`);
  return { anchor, marker: { type: 'name', name: rest } };
}

// split on `sep` only at top paren-depth (so shapes like `any of (a, b)` stay whole)
function splitTopLevel(text, sep) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

const PAT_ENC = new TextEncoder();
const PAT_DEC = new TextDecoder();

// Anchor the line position in JS, shape the capture with the match VM.
function applyPattern(def, text) {
  let begin = 0;
  if (def.start) {
    const { anchor, marker } = def.start;
    if (marker.type === 'char') begin = anchor === 'at' ? marker.position - 1 : marker.position;
    else {
      const ch = markerChar(marker, def.line);
      const idx = text.indexOf(ch);
      if (idx < 0) throw new LavaError(`pattern start marker '${marker.name}' not found in source`);
      begin = anchor === 'after' ? idx + 1 : idx;
    }
  }
  let regionEnd = text.length;
  if (def.stop) {
    const { anchor, marker } = def.stop;
    if (marker.type === 'char') regionEnd = anchor === 'at' ? marker.position : marker.position - 1;
    else {
      const ch = markerChar(marker, def.line);
      const idx = text.indexOf(ch, begin);
      if (idx >= 0) regionEnd = anchor === 'at' ? idx + 1 : idx;
    }
  }
  if (begin < 0 || begin > text.length || begin > regionEnd)
    throw new LavaError(`pattern matched no region in source`);

  const bytes = PAT_ENC.encode(text.slice(begin, regionEnd));
  const consumed = fastMatch(def.cp, bytes);
  if (consumed <= 0) throw new LavaError(`pattern shape did not match the source`);
  return PAT_DEC.decode(bytes.slice(0, consumed));
}

// ---------- comment stripping (quote-aware) ----------
function stripComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '~' && !inQuote) return line.slice(0, i);
  }
  return line;
}

// ---------- lexer (one logical line at a time) ----------
function isLetter(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}
function lexLine(line, lineNo) {
  const tokens = [];
  let i = 0;
  const push = (type, value, col) => tokens.push({ type, value, line: lineNo, col });
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '"') {
      const start = i; i++;
      let s = '';
      while (i < line.length && line[i] !== '"') s += line[i++];
      if (i >= line.length) throw new LavaError(`Unterminated string (line ${lineNo})`);
      i++;
      push('string', s, start + 1);
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const start = i; let n = '';
      while (i < line.length && line[i] >= '0' && line[i] <= '9') n += line[i++];
      push('number', n, start + 1);
      continue;
    }
    if ('()[],'.includes(ch)) { push(ch, ch, i + 1); i++; continue; }
    if (BINOPS.has(ch)) { push('op', ch, i + 1); i++; continue; }
    if (isLetter(ch)) {
      const start = i; let w = '';
      while (i < line.length && isLetter(line[i])) w += line[i++];
      push('word', w, start + 1);
      continue;
    }
    throw new LavaError(`Unexpected character '${ch}' (line ${lineNo}, col ${i + 1})`);
  }
  push('eol', '', line.length + 1);
  return tokens;
}
function endsWithAs(text) {
  const toks = lexLine(text, 0);
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i].type === 'eol') continue;
    return toks[i].type === 'word' && toks[i].value === 'as';
  }
  return false;
}

// ---------- parser ----------
class Parser {
  constructor(tokens, names, inAction = false) {
    this.t = tokens; this.p = 0; this.names = names; this.inAction = inAction;
  }
  peek(o = 0) { return this.t[this.p + o]; }
  next() { return this.t[this.p++]; }
  isWord(v) { return this.peek().type === 'word' && this.peek().value === v; }
  expect(type, value) {
    const tok = this.peek();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const want = value !== undefined ? `'${value}'` : type;
      throw new LavaError(`Expected ${want}, got '${tok.value || tok.type}' (line ${tok.line}, col ${tok.col})`);
    }
    return this.next();
  }
  eatWord(v) { if (this.isWord(v)) { this.next(); return true; } return false; }

  parseStatement() {
    const tok = this.peek();
    if (tok.type !== 'word') throw new LavaError(`Expected a statement (line ${tok.line})`);
    switch (tok.value) {
      case 'create':
        if (this.inAction) throw new LavaError(`Declarations are not allowed inside an action (line ${tok.line})`);
        return this.parseCreate();
      case 'update': return { kind: 'effects', effects: this.parseEffectList() };
      case 'if': return this.parseIf();
      case 'print': case 'Print': return { kind: 'effects', effects: this.parseEffectList() };
      default: return { kind: 'effects', effects: this.parseEffectList() }; // a call, possibly comma-chained
    }
  }

  parseCreate() {
    this.expect('word', 'create');
    const w = this.expect('word');
    if (w.value !== 'container' && w.value !== 'constant')
      throw new LavaError(`Expected 'container' or 'constant', got '${w.value}' (line ${w.line})`);
    const name = this.expect('string').value;
    this.expect('word', 'of'); this.expect('word', 'type');
    const types = this.parseType();
    this.expect('word', 'with'); this.expect('word', 'value');
    const value = this.parseLiteral();
    return { kind: 'create', isConst: w.value === 'constant', name, types, value };
  }
  parseType() {
    const types = [this.parseTypeWord()];
    while (this.peek().type === 'op' && this.peek().value === '/') { this.next(); types.push(this.parseTypeWord()); }
    return types;
  }
  parseTypeWord() {
    const w = this.expect('word');
    if (w.value !== 'int' && w.value !== 'string') throw new LavaError(`Unknown type '${w.value}' (line ${w.line})`);
    return w.value;
  }
  parseLiteral() {
    const tok = this.peek();
    if (tok.type === 'string') { this.next(); return { type: 'string', value: tok.value }; }
    let neg = false;
    if (tok.type === 'op' && tok.value === '-') { this.next(); neg = true; }
    const num = this.expect('number');
    return { type: 'int', value: (neg ? -1 : 1) * parseInt(num.value, 10) };
  }

  parseIf() {
    this.expect('word', 'if'); this.expect('(');
    const pred = this.parsePred();
    this.expect(')'); this.expect('word', 'then');
    const thenE = this.parseEffectList();
    let elseE = null;
    if (this.eatWord('else')) elseE = this.parseEffectList();
    return { kind: 'if', pred, thenE, elseE };
  }
  parseEffectList() {
    const effects = [this.parseEffect()];
    while (this.peek().type === ',') { this.next(); effects.push(this.parseEffect()); }
    return effects;
  }
  parseEffect() {
    const tok = this.peek();
    if (this.isWord('break')) {
      this.next();
      if (this.inAction) throw new LavaError(`'break' cannot appear inside an action (line ${tok.line})`);
      return { op: 'break' };
    }
    if (tok.type === 'word' && (tok.value === 'print' || tok.value === 'Print')) {
      this.next(); this.expect('('); const expr = this.parseExpr(); this.expect(')');
      return { op: 'print', expr };
    }
    if (this.isWord('update')) {
      this.next(); const name = this.parseName(); this.expect('word', 'to'); const expr = this.parseExpr();
      return { op: 'update', name, expr };
    }
    if (tok.type === 'word' && !KEYWORDS.has(tok.value)) return this.parseCall(); // action call
    throw new LavaError(`Expected an effect (print / update / action call), got '${tok.value || tok.type}' (line ${tok.line})`);
  }
  parseCall() {
    if (this.inAction)
      throw new LavaError(`Actions cannot call other actions (line ${this.peek().line})`);
    const words = [];
    while (this.peek().type === 'word' && !KEYWORDS.has(this.peek().value)) words.push(this.next().value);
    this.expect('('); this.expect(')');
    return { op: 'call', name: words.join(' ') };
  }

  // greedy multi-word name resolution against the known-name set
  parseName() {
    if (this.peek().type !== 'word' || KEYWORDS.has(this.peek().value))
      throw new LavaError(`Expected a name (line ${this.peek().line})`);
    const words = [this.next().value];
    while (this.peek().type === 'word' && !KEYWORDS.has(this.peek().value)) {
      const candidate = words.join(' ') + ' ' + this.peek().value;
      if (this.names.has(candidate)) words.push(this.next().value); else break;
    }
    return words.join(' ');
  }

  // footprint list: bare names separated by commas, terminated by 'writes'/'as'
  parseFootprintList() {
    const list = [this.parseFootprintName()];
    while (this.peek().type === ',') { this.next(); list.push(this.parseFootprintName()); }
    return list;
  }
  parseFootprintName() {
    const words = [];
    while (this.peek().type === 'word' && this.peek().value !== 'writes' && this.peek().value !== 'as')
      words.push(this.next().value);
    if (words.length === 0) throw new LavaError(`Expected a name in footprint (line ${this.peek().line})`);
    return words.join(' ');
  }
  parseActionHeader() {
    this.expect('word', 'create'); this.expect('word', 'action');
    const name = this.expect('string').value;
    let reads = [], writes = [];
    if (this.eatWord('reads')) reads = this.parseFootprintList();
    if (this.eatWord('writes')) writes = this.parseFootprintList();
    this.expect('word', 'as');
    return { name, reads, writes };
  }

  // extract <PatternName> from <source> — apply a pattern to a string source
  parseExtract() {
    this.expect('word', 'extract');
    const words = [];
    while (this.peek().type === 'word' && !this.isWord('from')) words.push(this.next().value);
    if (words.length === 0) throw new LavaError(`Expected a pattern name after 'extract' (line ${this.peek().line})`);
    this.expect('word', 'from');
    const source = this.parseName();
    return { kind: 'extract', pattern: words.join(' '), source };
  }

  // pattern body clauses: optional `start <at|after> M`, optional `stop <at|before> M`,
  // and exactly one shape clause. Markers are canonical char names or `char N`.
  parsePatternBody(bodyText, lineNo) {
    const clauses = splitTopLevel(bodyText, ',').map(c => c.trim()).filter(Boolean);
    let start = null, stop = null, shape = null;
    for (const clause of clauses) {
      const w = clause.split(/\s+/);
      if (w[0] === 'start') start = makeMarker(w[1], w.slice(2).join(' '), lineNo);
      else if (w[0] === 'stop') stop = makeMarker(w[1], w.slice(2).join(' '), lineNo);
      else if (shape !== null) throw new LavaError(`A pattern may have only one shape (line ${lineNo})`);
      else shape = clause;
    }
    if (!shape) throw new LavaError(`Pattern has no shape (line ${lineNo})`);
    return { start, stop, cp: compileShape(shape, lineNo), shape, line: lineNo };
  }

  // loop / loop until (cond) / loop n times / loop (create container ...) [until (cond)]
  parseLoopHeader() {
    this.expect('word', 'loop');
    let local = null, cond = null, count = null, mode = 'infinite';
    if (this.peek().type === '(') { this.next(); local = this.parseCreate(); this.expect(')'); }
    if (this.eatWord('until')) {
      this.expect('('); cond = this.parsePred(); this.expect(')'); mode = 'until';
    } else if (this.peek().type === 'number') {
      count = parseInt(this.next().value, 10); this.expect('word', 'times'); mode = 'times';
    }
    if (this.peek().type !== 'eol')
      throw new LavaError(`Unexpected '${this.peek().value}' in loop header (line ${this.peek().line})`);
    return { mode, count, cond, local };
  }

  // expressions: at most one binary op per level; '[ ]' groups
  parseExpr() {
    const left = this.parsePrimary();
    if (this.peek().type === 'op') {
      const op = this.next().value;
      const right = this.parsePrimary();
      if (this.peek().type === 'op') throw new LavaError(`More than one operation needs brackets (line ${this.peek().line})`);
      return { kind: 'binop', op, left, right };
    }
    return left;
  }
  parsePrimary() {
    const tok = this.peek();
    if (this.isWord('extract')) return this.parseExtract();
    if (tok.type === 'op' && tok.value === '√') { this.next(); return { kind: 'sqrt', operand: this.parsePrimary() }; }
    if (tok.type === 'op' && tok.value === '-') { this.next(); const n = this.expect('number'); return { kind: 'lit', type: 'int', value: -parseInt(n.value, 10) }; }
    if (tok.type === 'number') { this.next(); return { kind: 'lit', type: 'int', value: parseInt(tok.value, 10) }; }
    if (tok.type === 'string') { this.next(); return { kind: 'lit', type: 'string', value: tok.value }; }
    if (tok.type === '[') { this.next(); const e = this.parseExpr(); this.expect(']'); return e; }
    if (tok.type === 'word' && !KEYWORDS.has(tok.value)) return { kind: 'ref', name: this.parseName() };
    throw new LavaError(`Expected a value (line ${tok.line}, col ${tok.col})`);
  }

  // predicates: or < and < not < comparison
  parsePred() { return this.parseOr(); }
  parseOr() { let l = this.parseAnd(); while (this.isWord('or')) { this.next(); l = { kind: 'or', left: l, right: this.parseAnd() }; } return l; }
  parseAnd() { let l = this.parseNot(); while (this.isWord('and')) { this.next(); l = { kind: 'and', left: l, right: this.parseNot() }; } return l; }
  parseNot() {
    if (this.eatWord('not')) return { kind: 'not', operand: this.parseNot() };
    if (this.peek().type === '(') { this.next(); const p = this.parsePred(); this.expect(')'); return p; }
    const left = this.parseExpr(); this.expect('word', 'is'); const right = this.parseExpr();
    return { kind: 'is', left, right };
  }
}

// ---------- capability analysis ----------
function collectReadsWrites(stmts) {
  const reads = new Set(), writes = new Set();
  const expr = (n) => {
    if (n.kind === 'ref') reads.add(n.name);
    else if (n.kind === 'extract') reads.add(n.source);
    else if (n.kind === 'binop') { expr(n.left); expr(n.right); }
    else if (n.kind === 'sqrt') expr(n.operand);
  };
  const pred = (n) => {
    if (n.kind === 'is') { expr(n.left); expr(n.right); }
    else if (n.kind === 'and' || n.kind === 'or') { pred(n.left); pred(n.right); }
    else if (n.kind === 'not') pred(n.operand);
  };
  const eff = (e) => {
    if (e.op === 'update') { writes.add(e.name); expr(e.expr); }
    else if (e.op === 'print') { writes.add('Console'); expr(e.expr); }
    // 'break' / 'call' touch no state and never appear in an action body
  };
  const stmt = (s) => {
    if (s.kind === 'effects') s.effects.forEach(eff);
    else if (s.kind === 'if') { pred(s.pred); s.thenE.forEach(eff); if (s.elseE) s.elseE.forEach(eff); }
  };
  stmts.forEach(stmt);
  return { reads, writes };
}

// ---------- interpreter ----------
class Interpreter {
  constructor() {
    this.env = new Map(); this.actions = new Map(); this.patterns = new Map();
    this.names = new Set(); this.constants = new Set();
  }

  run(source) {
    const raw = source.split('\n');
    this.lines = [];
    for (let i = 0; i < raw.length; i++) {
      const text = stripComment(raw[i]).trim();
      if (text !== '') this.lines.push({ text, line: i + 1 });
    }

    // pre-scan every declared name (loop-local containers live on the loop
    // header line) so footprints and multi-word refs resolve
    for (const { text } of this.lines) {
      const m = text.match(/create (container|constant) "([^"]+)"/);
      if (m) { this.names.add(m[2]); if (m[1] === 'constant') this.constants.add(m[2]); }
    }

    this.cursor = 0;
    const units = this.readUnits(false);

    // phase 1a: compile every pattern (definitions are visible file-wide)
    for (const u of units) {
      if (u.kind !== 'pattern') continue;
      const def = new Parser([], this.names).parsePatternBody(u.body, u.line);
      this.patterns.set(u.name, def);
    }

    // phase 1b: hoist + validate every action
    for (const u of units) {
      if (u.kind !== 'action') continue;
      const hdr = new Parser(lexLine(u.header, u.line), this.names).parseActionHeader();
      const body = this.buildStatements(u.bodyUnits, /*inAction*/true);
      this.validateFootprint(hdr, body);
      this.actions.set(hdr.name, { reads: new Set(hdr.reads), writes: new Set(hdr.writes), body });
    }

    // phase 2: run the orchestrator top to bottom
    for (const u of units) {
      if (u.kind === 'action' || u.kind === 'pattern') continue;
      const node = this.buildStatement(u, /*inAction*/false);
      try { this.exec(node); }
      catch (e) { if (e instanceof BreakSignal) throw new LavaError(`'break' outside a loop (line ${u.line})`); throw e; }
    }
  }

  // Read an ordered list of units from the line cursor. `loop` and
  // `create action` open blocks terminated by `end`; loops may nest.
  // A leading `else` line continues the previous statement.
  readUnits(stopAtEnd) {
    const units = [];
    while (this.cursor < this.lines.length) {
      const { text, line } = this.lines[this.cursor];

      if (text === 'end') {
        if (stopAtEnd) { this.cursor++; return units; }
        throw new LavaError(`Unexpected 'end' (line ${line})`);
      }

      if (text === 'create action' || text.startsWith('create action ')) {
        let header = text; this.cursor++;
        while (!endsWithAs(header)) {
          if (this.cursor >= this.lines.length) throw new LavaError(`Action header missing 'as' (line ${line})`);
          header += ' ' + this.lines[this.cursor].text; this.cursor++;
        }
        const bodyUnits = this.readUnits(true);
        units.push({ kind: 'action', header, line, bodyUnits });
        continue;
      }

      if (text === 'create pattern' || text.startsWith('create pattern ')) {
        // header is `create pattern "name" as`; body runs until `end`
        let header = text; this.cursor++;
        while (!endsWithAs(header)) {
          if (this.cursor >= this.lines.length) throw new LavaError(`Pattern header missing 'as' (line ${line})`);
          header += ' ' + this.lines[this.cursor].text; this.cursor++;
        }
        const nameMatch = header.match(/create pattern "([^"]+)" as$/);
        if (!nameMatch) throw new LavaError(`Malformed pattern header (line ${line})`);
        const bodyLines = [];
        while (this.cursor < this.lines.length && this.lines[this.cursor].text !== 'end')
          bodyLines.push(this.lines[this.cursor++].text);
        if (this.cursor >= this.lines.length) throw new LavaError(`Pattern missing 'end' (line ${line})`);
        this.cursor++; // consume 'end'
        units.push({ kind: 'pattern', name: nameMatch[1], body: bodyLines.join(' '), line });
        continue;
      }

      if (text === 'loop' || text.startsWith('loop ') || text.startsWith('loop(')) {
        const header = text; this.cursor++;
        const bodyUnits = this.readUnits(true);
        units.push({ kind: 'loop', header, line, bodyUnits });
        continue;
      }

      if ((text === 'else' || text.startsWith('else ')) && units.length && units[units.length - 1].kind === 'stmt') {
        units[units.length - 1].text += ' ' + text; this.cursor++; continue;
      }

      units.push({ kind: 'stmt', text, line }); this.cursor++;
    }
    if (stopAtEnd) throw new LavaError(`Missing 'end'`);
    return units;
  }

  buildStatements(units, inAction) {
    return units.map(u => this.buildStatement(u, inAction));
  }
  buildStatement(u, inAction) {
    if (u.kind === 'action') throw new LavaError(`Cannot declare an action here (line ${u.line})`);
    if (u.kind === 'pattern') throw new LavaError(`Cannot declare a pattern here (line ${u.line})`);
    if (u.kind === 'loop') {
      if (inAction) throw new LavaError(`Actions cannot loop (line ${u.line})`);
      const hdr = new Parser(lexLine(u.header, u.line), this.names).parseLoopHeader();
      const body = this.buildStatements(u.bodyUnits, false);
      return { kind: 'loop', ...hdr, body, line: u.line };
    }
    return new Parser(lexLine(u.text, u.line), this.names, inAction).parseStatement();
  }

  validateFootprint(hdr, body) {
    const errs = [];
    const declaredReads = new Set(hdr.reads), declaredWrites = new Set(hdr.writes);

    // footprint names must resolve to a real container/constant or built-in origin
    for (const r of declaredReads)
      if (!this.names.has(r) && !BUILTIN_ORIGINS.has(r))
        errs.push(`declares 'reads ${r}', which is not a known container, constant, or origin`);
    for (const w of declaredWrites) {
      if (this.constants.has(w)) errs.push(`declares 'writes ${w}', but '${w}' is a constant`);
      else if (!this.names.has(w) && !BUILTIN_ORIGINS.has(w))
        errs.push(`declares 'writes ${w}', which is not a known container or origin`);
    }

    // body may only touch what the header declares (constants are ambient reads)
    const { reads, writes } = collectReadsWrites(body);
    for (const r of reads)
      if (!declaredReads.has(r) && !this.constants.has(r))
        errs.push(`reads '${r}' but does not declare it (reads: ${[...declaredReads].join(', ') || 'none'})`);
    for (const w of writes)
      if (!declaredWrites.has(w))
        errs.push(`writes '${w}' but does not declare it (writes: ${[...declaredWrites].join(', ') || 'none'})`);

    if (errs.length)
      throw new LavaError(`action '${hdr.name}':\n  - ` + errs.join('\n  - '));
  }

  exec(stmt) {
    switch (stmt.kind) {
      case 'create': {
        if (this.env.has(stmt.name)) throw new LavaError(`'${stmt.name}' already exists`);
        this.checkType(stmt.name, stmt.types, stmt.value);
        this.env.set(stmt.name, { types: stmt.types, value: stmt.value, isConst: stmt.isConst });
        return;
      }
      case 'effects': return stmt.effects.forEach(e => this.effect(e));
      case 'if': {
        if (this.evalPred(stmt.pred)) stmt.thenE.forEach(e => this.effect(e));
        else if (stmt.elseE) stmt.elseE.forEach(e => this.effect(e));
        return;
      }
      case 'loop': return this.runLoop(stmt);
    }
  }

  runLoop(node) {
    const CAP = 1_000_000;

    // loop-local container: declared in env for the loop body, restored after
    let localName = null, hadPrev = false, prev = null;
    if (node.local) {
      localName = node.local.name;
      this.checkType(localName, node.local.types, node.local.value);
      if (this.env.has(localName)) { hadPrev = true; prev = this.env.get(localName); }
      this.env.set(localName, { types: node.local.types, value: node.local.value, isConst: false });
    }

    try {
      if (node.mode === 'times') {
        for (let c = 0; c < node.count; c++) this.runBody(node.body);
      } else {
        let i = 0;
        while (true) {
          if (node.mode === 'until' && this.evalPred(node.cond)) break; // checked before each iteration
          if (i++ >= CAP) throw new LavaError(`loop exceeded ${CAP} iterations without 'break' (line ${node.line})`);
          this.runBody(node.body);
        }
      }
    } catch (e) {
      if (!(e instanceof BreakSignal)) throw e;
    } finally {
      if (localName) { if (hadPrev) this.env.set(localName, prev); else this.env.delete(localName); }
    }
  }
  runBody(body) { for (const s of body) this.exec(s); }

  effect(e) {
    if (e.op === 'break') throw new BreakSignal();
    if (e.op === 'print') { process.stdout.write(String(this.evalExpr(e.expr).value) + '\n'); return; }
    if (e.op === 'update') {
      const cell = this.env.get(e.name);
      if (!cell) throw new LavaError(`'${e.name}' is not declared`);
      if (cell.isConst) throw new LavaError(`'${e.name}' is a constant and cannot be updated`);
      const v = this.evalExpr(e.expr);
      this.checkType(e.name, cell.types, v);
      cell.value = v;
      return;
    }
    if (e.op === 'call') {
      const def = this.actions.get(e.name);
      if (!def) throw new LavaError(`No action named '${e.name}'`);
      def.body.forEach(s => this.exec(s));
    }
  }

  checkType(name, types, v) {
    if (!types.includes(v.type))
      throw new LavaError(`'${name}' is of type ${types.join('/')}, cannot hold a ${v.type} value`);
  }

  evalExpr(node) {
    switch (node.kind) {
      case 'lit': return { type: node.type, value: node.value };
      case 'ref': {
        const cell = this.env.get(node.name);
        if (!cell) throw new LavaError(`'${node.name}' is not declared`);
        return cell.value;
      }
      case 'extract': {
        const def = this.patterns.get(node.pattern);
        if (!def) throw new LavaError(`No pattern named '${node.pattern}'`);
        const src = this.env.get(node.source);
        if (!src) throw new LavaError(`'${node.source}' is not declared`);
        if (src.value.type !== 'string') throw new LavaError(`pattern source '${node.source}' must be a string`);
        return { type: 'string', value: applyPattern(def, src.value.value) };
      }
      case 'sqrt': return num(Math.sqrt(this.numeric(node.operand)));
      case 'binop': {
        const a = this.numeric(node.left), b = this.numeric(node.right);
        switch (node.op) {
          case '+': return num(a + b);
          case '-': return num(a - b);
          case '*': return num(a * b);
          case '/': return num(a / b);
          case '^': return num(Math.pow(a, b));
          case '√': return num(Math.pow(b, 1 / a));
        }
      }
    }
  }
  numeric(node) {
    const v = this.evalExpr(node);
    if (v.type !== 'int') throw new LavaError(`Expected a number in math, got a ${v.type}`);
    return v.value;
  }
  evalPred(node) {
    switch (node.kind) {
      case 'and': return this.evalPred(node.left) && this.evalPred(node.right);
      case 'or': return this.evalPred(node.left) || this.evalPred(node.right);
      case 'not': return !this.evalPred(node.operand);
      case 'is': {
        const l = this.evalExpr(node.left), r = this.evalExpr(node.right);
        if (l.type !== r.type) throw new LavaError(`Type mismatch: cannot compare ${l.type} with ${r.type}`);
        return l.value === r.value;
      }
    }
  }
}

function num(x) { return { type: Number.isInteger(x) ? 'int' : 'float', value: x }; }

// ---------- CLI ----------
const file = process.argv[2];
if (!file) { console.error('usage: node lava.mjs <file.lava>'); process.exit(2); }
try {
  new Interpreter().run(readFileSync(file, 'utf8'));
} catch (e) {
  if (e instanceof LavaError) { console.error('lava: ' + e.message); process.exit(1); }
  throw e;
}
