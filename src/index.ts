import { lex } from './lexer/lexer.js';
import { parse as parseTokens } from './parser/parser.js';
import { validate } from './validator/validator.js';
import { execute, executePartial, find as findFn } from './executor/executor.js';
import { compile, fastMatch, CompiledProgram, compileToWasmBuffer } from './executor/fast.js';
import { wasmFastMatchString, vmMatchTree, fastScan, fastScanBytes, fastMatchMany } from './executor/wasm.js';
import type { ScanMatch, ByteScanMatch } from './executor/wasm.js';
import { formatFailure, formatTree } from './diagnostics/formatter.js';
import { MatchProgram, ParseOptions, RuleNode, UseNode } from './types/ast.js';
import { MatchResult, MatchSuccess, PartialResult } from './types/result.js';
import { ParseError } from './types/error.js';
import { TokenType } from './types/token.js';

export { MatchProgram, ParseOptions } from './types/ast.js';
export { MatchResult, MatchSuccess, MatchFailure, PartialResult, RuleMatch } from './types/result.js';
export { ParseError } from './types/error.js';
export { formatFailure, formatTree } from './diagnostics/formatter.js';
export { FindMatch, find } from './executor/executor.js';
export { compile, fastMatch, CompiledProgram, compileToWasmBuffer } from './executor/fast.js';
export { LineMatch, SearchError, SearchResult, SearchOptions, StreamSearchOptions, searchString, searchFile, searchFolder, searchFolderStream, searchStream, searchFileStream, formatSearchResults } from './search/search.js';
export { vmMatch, vmMatchString } from './executor/vm-exec.js';
export { vmCompile } from './executor/vm-compile.js';
export type { ScanMatch, ByteScanMatch } from './executor/wasm.js';

// @api-parse
// Compiles the grammar into an AST and attaches a bytecode CompiledProgram
// (used by the fast paths as an optimistic pre-check before the tree executor).
// When the grammar contains `use` statements, pass a resolve map to provide
// the source strings for imported modules.
export function parse(source: string, options?: ParseOptions): MatchProgram {
  const tokens = lex(source);
  const uses = extractUses(tokens);

  if (uses.length > 0) {
    const resolve = options?.resolve ?? {};
    const importedRules: RuleNode[] = [];
    const seen = new Set<string>();
    const importedNames = new Set<string>();

    for (const use of uses) {
      const moduleSource = resolve[use.module];
      if (moduleSource === undefined) {
        throw new ParseError(
          `Cannot resolve module "${use.module}" — provide it in the resolve map`,
          use.line, use.column,
        );
      }

      const moduleTokens = lex(moduleSource);
      const moduleProgram = parseTokens(moduleTokens);

      const moduleRuleMap = new Map<string, RuleNode>();
      for (const rule of moduleProgram.rules) {
        moduleRuleMap.set(rule.name, rule);
      }

      for (const name of use.imports) {
        if (!moduleRuleMap.has(name)) {
          throw new ParseError(
            `Module "${use.module}" has no rule "${name}"`,
            use.line, use.column,
          );
        }
        if (!seen.has(name)) {
          const rule = moduleRuleMap.get(name)!;
          importedRules.push(rule);
          importedNames.add(name);
          collectDependencies(rule, moduleRuleMap, importedRules, seen, importedNames);
          seen.add(name);
        }
      }
    }

    const reTokens = lex(source);
    const program = parseTokens(reTokens, importedNames);
    program.rules = [...importedRules, ...program.rules];

    validate(program);
    (program as any).__compiled = compile(program);
    return program;
  }

  const program = parseTokens(tokens);
  validate(program);
  (program as any).__compiled = compile(program);
  return program;
}

function extractUses(tokens: import('./types/token.js').Token[]): UseNode[] {
  const uses: UseNode[] = [];
  let i = 0;
  while (i < tokens.length && tokens[i].type === TokenType.Use) {
    const useTok = tokens[i];
    i++;
    if (i >= tokens.length) break;
    const modTok = tokens[i];
    if (modTok.type !== TokenType.Begin && modTok.type !== TokenType.QuotedLiteral) break;
    i++;
    if (i >= tokens.length || tokens[i].type !== TokenType.OpenParenSyntax) break;
    i++;
    const imports: string[] = [];
    while (i < tokens.length && tokens[i].type !== TokenType.CloseParenSyntax) {
      if (tokens[i].type === TokenType.CommaSyntax) { i++; continue; }
      const parts: string[] = [];
      while (i < tokens.length && tokens[i].type === TokenType.Identifier) {
        parts.push(tokens[i].value);
        i++;
      }
      if (parts.length > 0) imports.push(parts.join(' '));
    }
    if (i < tokens.length) i++;
    uses.push({ module: modTok.value, imports, line: useTok.line, column: useTok.column });
  }
  return uses;
}

function collectDependencies(
  rule: RuleNode,
  ruleMap: Map<string, RuleNode>,
  out: RuleNode[],
  seen: Set<string>,
  names: Set<string>,
) {
  const refs = getRuleRefs(rule.body);
  for (const ref of refs) {
    if (!seen.has(ref) && ruleMap.has(ref)) {
      seen.add(ref);
      names.add(ref);
      const dep = ruleMap.get(ref)!;
      out.push(dep);
      collectDependencies(dep, ruleMap, out, seen, names);
    }
  }
}

function getRuleRefs(node: import('./types/ast.js').ASTNode): string[] {
  const refs: string[] = [];
  (function visit(n: import('./types/ast.js').ASTNode) {
    if (n.type === 'rule_ref') { refs.push(n.name); return; }
    if ('elements' in n && Array.isArray((n as any).elements)) (n as any).elements.forEach(visit);
    if ('options' in n && Array.isArray((n as any).options)) (n as any).options.forEach(visit);
    if ('items' in n && Array.isArray((n as any).items)) (n as any).items.forEach(visit);
    if ('child' in n) visit((n as any).child);
    if ('element' in n) visit((n as any).element);
    if ('separator' in n) visit((n as any).separator);
    if ('terminator' in n) visit((n as any).terminator);
    if ('negated' in n) visit((n as any).negated);
    if ('base' in n) visit((n as any).base);
    if ('exclusions' in n && Array.isArray((n as any).exclusions)) (n as any).exclusions.forEach(visit);
  })(node);
  return refs;
}
// @api-parse-end

// @api-match
// Execution tier selection:
//   1. If a CompiledProgram exists, run the fast path (wasmFastMatchString) as a pre-check.
//      wasmFastMatchString encodes directly into WASM memory (zero-copy for large inputs).
//   2. If the fast path confirms full-input success, run the tree executor with
//      skipFailureTracking=true (faster — no expected-set or rule-stack recording).
//   3. If the fast path reports failure (or no compiled program), run the tree
//      executor with full failure tracking for detailed diagnostics.
// The tree executor always runs — it's the only path that produces parse trees.
const matchEnc = new TextEncoder();
export function match(program: MatchProgram, input: string): MatchResult {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  if (cp) {
    const consumed = wasmFastMatchString(cp, input);
    if (consumed === input.length) {
      const inputBytes = matchEnc.encode(input);
      const treeResult = vmMatchTree(cp, inputBytes, input);
      if (treeResult && treeResult.consumed === inputBytes.length) {
        return {
          matched: true,
          bytes_consumed: treeResult.consumed,
          tree: treeResult.tree,
          extracted: treeResult.extracted,
        } as MatchSuccess;
      }
      return execute(program, input, true);
    }
  }
  return execute(program, input);
}
// @api-match-end

// @api-run
export function run(source: string, input: string, options?: ParseOptions): MatchResult {
  const program = parse(source, options);
  return match(program, input);
}
// @api-run-end

// @api-try-parse
export function tryParse(source: string, input: string, options?: ParseOptions): MatchSuccess | PartialResult {
  const program = parse(source, options);
  return executePartial(program, input);
}
// @api-try-parse-end

export function matchMany(program: MatchProgram, inputs: string[]): boolean[] {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  if (cp) return fastMatchMany(cp, inputs);
  const n = inputs.length;
  const results = new Array<boolean>(n);
  for (let i = 0; i < n; i++) results[i] = execute(program, inputs[i]).matched;
  return results;
}

export interface ScanOptions {
  tree?: boolean;
}

function offsetTree(tree: import('./types/result.js').RuleMatch, base: number): import('./types/result.js').RuleMatch {
  return {
    rule: tree.rule,
    start: tree.start + base,
    end: tree.end + base,
    text: tree.text,
    children: tree.children.map(c => offsetTree(c, base)),
  };
}

export function scan(program: MatchProgram, input: string, options?: ScanOptions): ScanMatch[] {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  let results: ScanMatch[];
  if (cp) {
    results = fastScan(cp, input);
  } else {
    results = findFn(program, input).map((m: { start: number; end: number; text: string }) => ({ start: m.start, end: m.end, text: m.text }));
  }
  if (options?.tree) {
    for (const r of results) {
      const slice = input.slice(r.start, r.end);
      const res = execute(program, slice, true);
      if (res.matched) r.tree = offsetTree(res.tree, r.start);
    }
  }
  return results;
}

const scanDec = new TextDecoder();

export function scanBytes(program: MatchProgram, input: Uint8Array, options?: ScanOptions): ByteScanMatch[] {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  let results: ByteScanMatch[];
  if (cp) {
    results = fastScanBytes(cp, input);
  } else {
    results = [];
  }
  if (options?.tree) {
    for (const r of results) {
      const slice = scanDec.decode(input.subarray(r.start, r.end));
      const res = execute(program, slice, true);
      if (res.matched) r.tree = offsetTree(res.tree, r.start);
    }
  }
  return results;
}

export function exportBytecode(program: MatchProgram): ArrayBuffer {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  if (!cp) throw new Error('Program has no compiled bytecode — call parse() first');
  return compileToWasmBuffer(cp);
}
