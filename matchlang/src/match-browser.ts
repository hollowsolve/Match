import { lex } from '../../src/lexer/lexer.js'
import { parse as parseTokens } from '../../src/parser/parser.js'
import { validate } from '../../src/validator/validator.js'
import { execute, executePartial } from '../../src/executor/executor.js'
import { formatFailure, formatTree } from '../../src/diagnostics/formatter.js'
import type { MatchProgram } from '../../src/types/ast.js'
import type { MatchResult, MatchSuccess, PartialResult } from '../../src/types/result.js'

export { formatFailure, formatTree }
export { find } from '../../src/executor/executor.js'
export type { MatchProgram } from '../../src/types/ast.js'
export type { MatchResult, MatchSuccess, MatchFailure, PartialResult, RuleMatch } from '../../src/types/result.js'
export type { FindMatch } from '../../src/executor/executor.js'
export { ParseError } from '../../src/types/error.js'

export function parse(source: string): MatchProgram {
  const tokens = lex(source)
  const program = parseTokens(tokens)
  validate(program)
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
