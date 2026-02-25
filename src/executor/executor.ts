import { ASTNode, MatchProgram, RuleNode } from '../types/ast.js';
import { MatchResult, MatchSuccess, MatchFailure, PartialResult, RuleMatch } from '../types/result.js';
import { NAMED_CHARS, CHAR_CLASSES, describeByte } from '../stdlib/stdlib.js';

// @match-types
interface ExecSuccess {
  ok: true;
  pos: number;
  tree: RuleMatch | null;
  children: RuleMatch[];
}

interface ExecFailure {
  ok: false;
}

type ExecResult = ExecSuccess | ExecFailure;

interface MemoEntry {
  result: ExecResult;
  failOffset: number;
  failExpected: string[];
  failRuleStack: string[];
}

interface FailureState {
  offset: number;
  expected: Set<string>;
  ruleStack: string[];
}
// @match-types-end

// @match-helper
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function stringToBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

function bytesToString(bytes: Uint8Array, start: number, end: number): string {
  return decoder.decode(bytes.subarray(start, end));
}

function buildByteToCharMap(str: string, bytes: Uint8Array): Int32Array {
  const map = new Int32Array(bytes.length + 1);
  let byteIdx = 0;
  for (let charIdx = 0; charIdx < str.length; charIdx++) {
    map[byteIdx] = charIdx;
    const code = str.codePointAt(charIdx)!;
    let byteLen: number;
    if (code <= 0x7F) byteLen = 1;
    else if (code <= 0x7FF) byteLen = 2;
    else if (code <= 0xFFFF) byteLen = 3;
    else { byteLen = 4; charIdx++; }
    for (let j = 1; j < byteLen; j++) {
      map[byteIdx + j] = charIdx;
    }
    byteIdx += byteLen;
  }
  map[byteIdx] = str.length;
  return map;
}

function remapTreeOffsets(tree: RuleMatch, byteToChar: Int32Array): RuleMatch {
  return {
    rule: tree.rule,
    start: byteToChar[tree.start] ?? tree.start,
    end: byteToChar[tree.end] ?? tree.end,
    text: tree.text,
    children: remapChildrenOffsets(tree.children, byteToChar),
  };
}

function remapChildrenOffsets(children: RuleMatch[], byteToChar: Int32Array): RuleMatch[] {
  return children.map(c => remapTreeOffsets(c, byteToChar));
}
function utf8SeqLength(leadByte: number): number {
  if (leadByte < 0x80) return 1;
  if ((leadByte & 0xE0) === 0xC0) return 2;
  if ((leadByte & 0xF0) === 0xE0) return 3;
  if ((leadByte & 0xF8) === 0xF0) return 4;
  return 1;
}
// @match-helper-end

const textBlockCache = new WeakMap<object, Uint8Array>();

function getTextBlockBytes(node: { text: string }): Uint8Array {
  let cached = textBlockCache.get(node);
  if (!cached) {
    cached = stringToBytes(node.text);
    textBlockCache.set(node, cached);
  }
  return cached;
}

// @match-engine
// Tree executor: the only execution path that produces full parse trees and
// structured error diagnostics. Always runs for match()/run() calls.
// When skipFailureTracking is true (fast path confirmed success), the engine
// skips recording expected-sets and rule stacks, making execution faster.
export function execute(program: MatchProgram, input: string, skipFailureTracking?: boolean): MatchResult {
  const inputBytes = stringToBytes(input);
  const engine = new Engine(program, inputBytes, skipFailureTracking);
  return engine.run();
}

export function executePartial(program: MatchProgram, input: string): MatchSuccess | PartialResult {
  const inputBytes = stringToBytes(input);
  const engine = new Engine(program, inputBytes);
  return engine.runPartial();
}

export interface FindMatch {
  start: number;
  end: number;
  text: string;
  tree: RuleMatch;
}

/**
 * Find all non-overlapping substring matches of program in input.
 * Returns character-level offsets (not byte offsets) so results can be
 * used directly with String.prototype.slice().
 *
 * Performance: O(n * m) worst case where n = input length and m = grammar
 * complexity. For patterns that fail late at every byte position this
 * degrades to O(n²). Acceptable for line-at-a-time search; avoid calling
 * on megabyte-scale inputs with complex grammars.
 */
export function find(program: MatchProgram, input: string): FindMatch[] {
  const inputBytes = stringToBytes(input);
  const byteToChar = buildByteToCharMap(input, inputBytes);
  const results: FindMatch[] = [];
  let pos = 0;

  while (pos <= inputBytes.length) {
    const engine = new Engine(program, inputBytes);
    const result = engine.tryAt(pos);
    if (result && result.pos > pos) {
      const text = bytesToString(inputBytes, pos, result.pos);
      const charStart = byteToChar[pos];
      const charEnd = byteToChar[result.pos];
      let tree: RuleMatch;
      if (result.tree) {
        tree = remapTreeOffsets(result.tree, byteToChar);
      } else {
        tree = {
          rule: program.entryPoint,
          start: charStart,
          end: charEnd,
          text,
          children: remapChildrenOffsets(result.children, byteToChar),
        };
      }
      results.push({ start: charStart, end: charEnd, text, tree });
      pos = result.pos;
    } else {
      pos += (pos < inputBytes.length) ? utf8SeqLength(inputBytes[pos]) : 1;
    }
  }

  return results;
}

class Engine {
  private program: MatchProgram;
  private input: Uint8Array;
  private ruleMap: Map<string, RuleNode>;
  private memo: Map<string, MemoEntry>;
  private failure: FailureState;
  private ruleStack: string[];
  private extractedNodes: RuleMatch[];
  private bestPartialPos: number;
  private bestPartialTree: RuleMatch | null;
  private bestPartialChildren: RuleMatch[];
  private skipFailureTracking: boolean;

  constructor(program: MatchProgram, input: Uint8Array, skipFailureTracking?: boolean) {
    this.program = program;
    this.input = input;
    this.ruleMap = new Map();
    for (const rule of program.rules) {
      this.ruleMap.set(rule.name, rule);
    }
    this.memo = new Map();
    this.failure = { offset: 0, expected: new Set(), ruleStack: [] };
    this.ruleStack = [];
    this.extractedNodes = [];
    this.bestPartialPos = 0;
    this.bestPartialTree = null;
    this.bestPartialChildren = [];
    this.skipFailureTracking = !!skipFailureTracking;
  }

  private memoKey(rule: string, offset: number): string {
    return `${rule}@${offset}`;
  }

  private recordFailure(offset: number, expected: string) {
    if (this.skipFailureTracking) return;
    if (offset > this.failure.offset) {
      this.failure.offset = offset;
      this.failure.expected = new Set([expected]);
      this.failure.ruleStack = [...this.ruleStack];
    } else if (offset === this.failure.offset) {
      this.failure.expected.add(expected);
    }
  }

  private offsetToLineCol(offset: number): { line: number; column: number } {
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < this.input.length; i++) {
      if (this.input[i] === 0x0A) {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, column: col };
  }

  tryAt(offset: number): ExecSuccess | null {
    const entryRule = this.ruleMap.get(this.program.entryPoint);
    if (!entryRule) return null;
    const result = this.execRule(this.program.entryPoint, offset);
    if (result.ok) return result;
    return null;
  }

  // @match-run
  run(): MatchResult {
    const entryRule = this.ruleMap.get(this.program.entryPoint);
    if (!entryRule) {
      return this.buildFailure();
    }

    const result = this.execRule(this.program.entryPoint, 0);

    if (result.ok) {
      this.trackPartial(result);
      if (result.pos === this.input.length) {
        const tree = result.tree || {
          rule: this.program.entryPoint,
          start: 0,
          end: result.pos,
          text: bytesToString(this.input, 0, result.pos),
          children: result.children,
        };
        return {
          matched: true,
          bytes_consumed: result.pos,
          tree,
          extracted: this.extractedNodes,
        } as MatchSuccess;
      }
      this.recordFailure(result.pos, 'end of input');
    }

    return this.buildFailure();
  }
  // @match-run-end

  // @match-run-partial
  runPartial(): MatchSuccess | PartialResult {
    const entryRule = this.ruleMap.get(this.program.entryPoint);
    if (!entryRule) {
      return this.buildPartialResult();
    }

    const result = this.execRule(this.program.entryPoint, 0);

    if (result.ok) {
      this.trackPartial(result);
      if (result.pos === this.input.length) {
        const tree = result.tree || {
          rule: this.program.entryPoint,
          start: 0,
          end: result.pos,
          text: bytesToString(this.input, 0, result.pos),
          children: result.children,
        };
        return {
          matched: true,
          bytes_consumed: result.pos,
          tree,
          extracted: this.extractedNodes,
        } as MatchSuccess;
      }
      this.recordFailure(result.pos, 'end of input');
    }

    return this.buildPartialResult();
  }
  // @match-run-partial-end

  private trackPartial(result: ExecSuccess) {
    if (result.pos > this.bestPartialPos) {
      this.bestPartialPos = result.pos;
      this.bestPartialTree = result.tree;
      this.bestPartialChildren = [...result.children];
    }
  }

  private buildPartialResult(): PartialResult {
    const { line, column } = this.offsetToLineCol(this.failure.offset);
    let found: string;
    if (this.failure.offset >= this.input.length) {
      found = 'end of input';
    } else {
      found = describeByte(this.input[this.failure.offset]);
    }
    let partial_tree: RuleMatch | null = null;
    if (this.bestPartialPos > 0) {
      partial_tree = this.bestPartialTree || {
        rule: this.program.entryPoint,
        start: 0,
        end: this.bestPartialPos,
        text: bytesToString(this.input, 0, this.bestPartialPos),
        children: this.bestPartialChildren,
      };
    }
    return {
      matched: false,
      bytes_consumed: this.bestPartialPos,
      partial_tree,
      extracted: this.extractedNodes,
      offset: this.failure.offset,
      line,
      column,
      expected: [...this.failure.expected].sort(),
      found,
      rule_stack: this.failure.ruleStack,
    };
  }

  private buildFailure(): MatchFailure {
    const { line, column } = this.offsetToLineCol(this.failure.offset);
    let found: string;
    if (this.failure.offset >= this.input.length) {
      found = 'end of input';
    } else {
      found = describeByte(this.input[this.failure.offset]);
    }
    return {
      matched: false,
      offset: this.failure.offset,
      line,
      column,
      expected: [...this.failure.expected].sort(),
      found,
      rule_stack: this.failure.ruleStack,
    };
  }

  // @match-exec-rule
  private execRule(name: string, offset: number): ExecResult {
    const key = this.memoKey(name, offset);
    const cached = this.memo.get(key);
    if (cached) {
      if (!cached.result.ok && !this.skipFailureTracking) {
        if (cached.failOffset >= 0) {
          if (cached.failOffset > this.failure.offset) {
            this.failure.offset = cached.failOffset;
            this.failure.expected = new Set(cached.failExpected);
            this.failure.ruleStack = [...cached.failRuleStack];
          } else if (cached.failOffset === this.failure.offset) {
            for (const exp of cached.failExpected) {
              this.failure.expected.add(exp);
            }
          }
        }
      }
      return cached.result;
    }

    const rule = this.ruleMap.get(name);
    if (!rule) {
      this.recordFailure(offset, name);
      return { ok: false };
    }

    this.ruleStack.push(name);
    const savedFailureOffset = this.failure.offset;

    const result = this.execNode(rule.body, offset);

    let entry: MemoEntry;
    if (result.ok) {
      const tree: RuleMatch = {
        rule: name,
        start: offset,
        end: result.pos,
        text: bytesToString(this.input, offset, result.pos),
        children: result.tree ? [result.tree] : result.children,
      };
      const finalResult: ExecResult = {
        ok: true,
        pos: result.pos,
        tree,
        children: [],
      };
      entry = { result: finalResult, failOffset: -1, failExpected: [], failRuleStack: [] };
    } else {
      if (this.skipFailureTracking) {
        entry = { result: { ok: false }, failOffset: -1, failExpected: [], failRuleStack: [] };
      } else {
        const failOffset = this.failure.offset;
        const failExpected = failOffset > savedFailureOffset ? [...this.failure.expected] : [];
        const failRuleStack = failOffset > savedFailureOffset ? [...this.failure.ruleStack] : [];
        entry = { result: { ok: false }, failOffset, failExpected, failRuleStack };
      }
    }

    this.memo.set(key, entry);
    this.ruleStack.pop();
    return entry.result;
  }
  // @match-exec-rule-end

  // @match-exec-node
  private execNode(node: ASTNode, offset: number): ExecResult {
    switch (node.type) {
      case 'named_char': return this.execNamedChar(node, offset);
      case 'quoted_literal': return this.execQuotedLiteral(node, offset);
      case 'byte_literal': return this.execByteLiteral(node, offset);
      case 'char_class': return this.execCharClass(node, offset);
      case 'range': return this.execRange(node, offset);
      case 'any_of': return this.execAnyOf(node, offset);
      case 'none_of': return this.execNoneOf(node, offset);
      case 'except': return this.execExcept(node, offset);
      case 'sequence': return this.execSequence(node, offset);
      case 'alternative': return this.execAlternative(node, offset);
      case 'repeat': return this.execRepeat(node, offset);
      case 'joined_by': return this.execJoinedBy(node, offset);
      case 'text_block': return this.execTextBlock(node, offset);
      case 'rule_ref': return this.execRule(node.name, offset);
      case 'group': return this.execNode(node.child, offset);
      case 'until': return this.execUntil(node, offset);
      case 'isnt': return this.execIsnt(node, offset);
      case 'extract': return this.execExtract(node, offset);
      default: return { ok: false };
    }
  }
  // @match-exec-node-end

  // @match-exec-char
  private execNamedChar(node: { name: string; byte: number }, offset: number): ExecResult {
    if (offset >= this.input.length) {
      this.recordFailure(offset, node.name);
      return { ok: false };
    }
    if (this.input[offset] === node.byte) {
      return { ok: true, pos: offset + 1, tree: null, children: [] };
    }
    this.recordFailure(offset, node.name);
    return { ok: false };
  }

  private execQuotedLiteral(node: { char: string; byte: number }, offset: number): ExecResult {
    if (offset >= this.input.length) {
      this.recordFailure(offset, `"${node.char}"`);
      return { ok: false };
    }
    if (this.input[offset] === node.byte) {
      return { ok: true, pos: offset + 1, tree: null, children: [] };
    }
    this.recordFailure(offset, `"${node.char}"`);
    return { ok: false };
  }

  private execByteLiteral(node: { byte: number }, offset: number): ExecResult {
    const label = `byte 0x${node.byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (offset >= this.input.length) {
      this.recordFailure(offset, label);
      return { ok: false };
    }
    if (this.input[offset] === node.byte) {
      return { ok: true, pos: offset + 1, tree: null, children: [] };
    }
    this.recordFailure(offset, label);
    return { ok: false };
  }
  // @match-exec-char-end

  // @match-exec-class
  private execCharClass(node: { className: string }, offset: number): ExecResult {
    if (offset >= this.input.length) {
      this.recordFailure(offset, node.className);
      return { ok: false };
    }
    if (node.className === 'any character') {
      const len = utf8SeqLength(this.input[offset]);
      if (offset + len > this.input.length) {
        this.recordFailure(offset, node.className);
        return { ok: false };
      }
      return { ok: true, pos: offset + len, tree: null, children: [] };
    }
    const fn = CHAR_CLASSES[node.className];
    if (fn && fn(this.input[offset])) {
      return { ok: true, pos: offset + 1, tree: null, children: [] };
    }
    this.recordFailure(offset, node.className);
    return { ok: false };
  }
  // @match-exec-class-end

  // @match-exec-range
  private execRange(node: { low: number; high: number }, offset: number): ExecResult {
    const label = `0x${node.low.toString(16).toUpperCase().padStart(2, '0')}..0x${node.high.toString(16).toUpperCase().padStart(2, '0')}`;
    if (offset >= this.input.length) {
      this.recordFailure(offset, label);
      return { ok: false };
    }
    const b = this.input[offset];
    if (b >= node.low && b <= node.high) {
      return { ok: true, pos: offset + 1, tree: null, children: [] };
    }
    this.recordFailure(offset, label);
    return { ok: false };
  }
  // @match-exec-range-end

  // @match-exec-set
  private execAnyOf(node: { items: ASTNode[] }, offset: number): ExecResult {
    for (const item of node.items) {
      const result = this.execNode(item, offset);
      if (result.ok) return result;
    }
    return { ok: false };
  }

  private execNoneOf(node: { items: ASTNode[] }, offset: number): ExecResult {
    if (offset >= this.input.length) {
      this.recordFailure(offset, 'none of (...)');
      return { ok: false };
    }
    for (const item of node.items) {
      const result = this.execNode(item, offset);
      if (result.ok) {
        this.recordFailure(offset, 'none of (...)');
        return { ok: false };
      }
    }
    const len = utf8SeqLength(this.input[offset]);
    return { ok: true, pos: offset + len, tree: null, children: [] };
  }
  // @match-exec-set-end

  // @match-exec-except
  private execExcept(node: { base: ASTNode; exclusions: ASTNode[] }, offset: number): ExecResult {
    if (offset >= this.input.length) {
      this.recordFailure(offset, 'character');
      return { ok: false };
    }
    for (const exc of node.exclusions) {
      const excResult = this.execNode(exc, offset);
      if (excResult.ok) {
        this.recordFailure(offset, 'character (excluded)');
        return { ok: false };
      }
    }
    return this.execNode(node.base, offset);
  }
  // @match-exec-except-end

  // @match-exec-sequence
  private execSequence(node: { elements: ASTNode[] }, offset: number): ExecResult {
    let pos = offset;
    const children: RuleMatch[] = [];

    for (const element of node.elements) {
      const result = this.execNode(element, pos);
      if (!result.ok) {
        if (pos > offset) {
          this.trackPartial({ ok: true, pos, tree: null, children: [...children] });
        }
        return { ok: false };
      }
      if (result.tree) children.push(result.tree);
      else children.push(...result.children);
      pos = result.pos;
    }

    return { ok: true, pos, tree: null, children };
  }
  // @match-exec-sequence-end

  // @match-exec-alternative
  private execAlternative(node: { options: ASTNode[] }, offset: number): ExecResult {
    const savedExtractCount = this.extractedNodes.length;
    for (const option of node.options) {
      const result = this.execNode(option, offset);
      if (result.ok) return result;
      this.extractedNodes.length = savedExtractCount;
    }
    return { ok: false };
  }
  // @match-exec-alternative-end

  // @match-exec-repeat
  private execRepeat(node: ASTNode & { type: 'repeat' }, offset: number): ExecResult {
    const { child, mode, min, max } = node;

    if (mode === 'optional') {
      const result = this.execNode(child, offset);
      if (result.ok) return result;
      return { ok: true, pos: offset, tree: null, children: [] };
    }

    if (mode === 'exactly') {
      let pos = offset;
      const children: RuleMatch[] = [];
      for (let i = 0; i < (min ?? 0); i++) {
        const result = this.execNode(child, pos);
        if (!result.ok) return { ok: false };
        if (result.tree) children.push(result.tree);
        else children.push(...result.children);
        pos = result.pos;
      }
      return { ok: true, pos, tree: null, children };
    }

    if (mode === 'between') {
      let pos = offset;
      const children: RuleMatch[] = [];
      const lo = min ?? 0;
      const hi = max ?? 0;
      let count = 0;

      for (let i = 0; i < hi; i++) {
        const result = this.execNode(child, pos);
        if (!result.ok) break;
        if (result.tree) children.push(result.tree);
        else children.push(...result.children);
        pos = result.pos;
        count++;
      }

      if (count < lo) return { ok: false };
      return { ok: true, pos, tree: null, children };
    }

    let pos = offset;
    const children: RuleMatch[] = [];
    let count = 0;

    for (;;) {
      const result = this.execNode(child, pos);
      if (!result.ok) break;
      if (result.pos === pos) break;
      if (result.tree) children.push(result.tree);
      else children.push(...result.children);
      pos = result.pos;
      count++;
    }

    if (mode === 'one_or_more' && count === 0) return { ok: false };
    return { ok: true, pos, tree: null, children };
  }
  // @match-exec-repeat-end

  // @match-exec-joined-by
  private execJoinedBy(node: { element: ASTNode; separator: ASTNode; lenient: boolean }, offset: number): ExecResult {
    const firstResult = this.execNode(node.element, offset);
    if (!firstResult.ok) return { ok: false };

    let pos = firstResult.pos;
    const children: RuleMatch[] = [];
    if (firstResult.tree) children.push(firstResult.tree);
    else children.push(...firstResult.children);

    for (;;) {
      const sepResult = this.execNode(node.separator, pos);
      if (!sepResult.ok) break;

      const elemResult = this.execNode(node.element, sepResult.pos);
      if (!elemResult.ok) break;

      if (sepResult.tree) children.push(sepResult.tree);
      else children.push(...sepResult.children);
      if (elemResult.tree) children.push(elemResult.tree);
      else children.push(...elemResult.children);
      pos = elemResult.pos;
    }

    if (node.lenient) {
      const trailingSep = this.execNode(node.separator, pos);
      if (trailingSep.ok) {
        pos = trailingSep.pos;
      }
    }

    return { ok: true, pos, tree: null, children };
  }
  // @match-exec-joined-by-end

  // @match-exec-text-block
  private execTextBlock(node: { text: string }, offset: number): ExecResult {
    const bytes = getTextBlockBytes(node);
    if (offset + bytes.length > this.input.length) {
      this.recordFailure(offset, `"${node.text}"`);
      return { ok: false };
    }
    for (let i = 0; i < bytes.length; i++) {
      if (this.input[offset + i] !== bytes[i]) {
        this.recordFailure(offset + i, `"${node.text}"`);
        return { ok: false };
      }
    }
    return { ok: true, pos: offset + bytes.length, tree: null, children: [] };
  }
  // @match-exec-text-block-end

  // @match-exec-until
  private execUntil(node: { child: ASTNode; terminator: ASTNode; mode: 'including' | 'excluding' }, offset: number): ExecResult {
    let pos = offset;
    const children: RuleMatch[] = [];

    for (;;) {
      const termResult = this.execNode(node.terminator, pos);
      if (termResult.ok) {
        if (node.mode === 'including') {
          if (termResult.tree) children.push(termResult.tree);
          else children.push(...termResult.children);
          return { ok: true, pos: termResult.pos, tree: null, children };
        } else {
          return { ok: true, pos, tree: null, children };
        }
      }

      const childResult = this.execNode(node.child, pos);
      if (!childResult.ok) return { ok: false };
      if (childResult.pos === pos) return { ok: false };

      if (childResult.tree) children.push(childResult.tree);
      else children.push(...childResult.children);
      pos = childResult.pos;
    }
  }
  // @match-exec-until-end

  // @match-exec-isnt
  private execIsnt(node: { child: ASTNode; negated: ASTNode }, offset: number): ExecResult {
    const savedFailure = {
      offset: this.failure.offset,
      expected: new Set(this.failure.expected),
      ruleStack: [...this.failure.ruleStack],
    };
    const negCheck = this.execNode(node.negated, offset);
    if (negCheck.ok) {
      this.failure = savedFailure;
      this.recordFailure(offset, `not ${this.describeNode(node.negated)}`);
      return { ok: false };
    }
    this.failure = savedFailure;
    return this.execNode(node.child, offset);
  }
  // @match-exec-isnt-end

  // @match-exec-extract
  private execExtract(node: { child: ASTNode }, offset: number): ExecResult {
    const result = this.execNode(node.child, offset);
    if (result.ok) {
      const text = bytesToString(this.input, offset, result.pos);
      const extracted: RuleMatch = result.tree || {
        rule: '<extract>',
        start: offset,
        end: result.pos,
        text,
        children: result.children,
      };
      this.extractedNodes.push(extracted);
    }
    return result;
  }
  // @match-exec-extract-end

  private describeNode(node: ASTNode): string {
    switch (node.type) {
      case 'named_char': return node.name;
      case 'quoted_literal': return `"${node.char}"`;
      case 'char_class': return node.className;
      case 'text_block': return `"${node.text}"`;
      case 'rule_ref': return node.name;
      default: return 'pattern';
    }
  }
}
// @match-engine-end
