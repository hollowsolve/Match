import { lex } from '../../src/lexer/lexer.js'
import { parse as parseTokens } from '../../src/parser/parser.js'
import { validate } from '../../src/validator/validator.js'
import { execute, executePartial, find as findFn } from '../../src/executor/executor.js'
import { formatFailure, formatTree } from '../../src/diagnostics/formatter.js'
import { compile } from '../../src/executor/fast.js'
import type { CompiledProgram } from '../../src/executor/fast.js'
import { jitScanString } from '../../src/executor/wasm-jit.js'
import type { ScanMatch as JitScanMatch } from '../../src/executor/wasm-jit.js'
import type { MatchProgram } from '../../src/types/ast.js'
import type { MatchResult, MatchSuccess, PartialResult, RuleMatch } from '../../src/types/result.js'

export { formatFailure, formatTree }
export { find } from '../../src/executor/executor.js'
export type { MatchProgram } from '../../src/types/ast.js'
export type { MatchResult, MatchSuccess, MatchFailure, PartialResult, RuleMatch } from '../../src/types/result.js'
export type { FindMatch } from '../../src/executor/executor.js'
export { ParseError } from '../../src/types/error.js'

export interface ScanMatch {
  start: number
  end: number
  text: string
  tree?: RuleMatch
}

export interface ScanOptions {
  tree?: boolean
}

function offsetTree(tree: RuleMatch, base: number): RuleMatch {
  return {
    rule: tree.rule,
    start: tree.start + base,
    end: tree.end + base,
    text: tree.text,
    children: tree.children.map(c => offsetTree(c, base)),
  }
}

export function parse(source: string): MatchProgram {
  const tokens = lex(source)
  const program = parseTokens(tokens)
  validate(program)
  ;(program as any).__compiled = compile(program)
  return program
}

export function match(program: MatchProgram, input: string): MatchResult {
  return execute(program, input)
}

export function run(source: string, input: string): MatchResult {
  const program = parse(source)
  return match(program, input)
}

export function tryParse(source: string, input: string): MatchSuccess | PartialResult {
  const program = parse(source)
  return executePartial(program, input)
}

export function scan(program: MatchProgram, input: string, options?: ScanOptions): ScanMatch[] {
  const cp: CompiledProgram | undefined = (program as any).__compiled
  let results: ScanMatch[]
  if (cp) {
    const jitResults = jitScanString(cp, input)
    if (jitResults) {
      results = jitResults
    } else {
      results = findFn(program, input).map(m => ({ start: m.start, end: m.end, text: m.text }))
    }
  } else {
    results = findFn(program, input).map(m => ({ start: m.start, end: m.end, text: m.text }))
  }
  if (options?.tree) {
    for (const r of results) {
      const slice = input.slice(r.start, r.end)
      const res = execute(program, slice, true)
      if (res.matched) r.tree = offsetTree(res.tree, r.start)
    }
  }
  return results
}
