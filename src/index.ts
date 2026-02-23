import { lex } from './lexer/lexer.js';
import { parse as parseTokens } from './parser/parser.js';
import { validate } from './validator/validator.js';
import { execute, executePartial } from './executor/executor.js';
import { compile, fastMatch, CompiledProgram } from './executor/fast.js';
import { wasmFastMatch } from './executor/wasm.js';
import { formatFailure, formatTree } from './diagnostics/formatter.js';
import { MatchProgram } from './types/ast.js';
import { MatchResult, MatchSuccess, PartialResult } from './types/result.js';
import { ParseError } from './types/error.js';

export { MatchProgram } from './types/ast.js';
export { MatchResult, MatchSuccess, MatchFailure, PartialResult, RuleMatch } from './types/result.js';
export { ParseError } from './types/error.js';
export { formatFailure, formatTree } from './diagnostics/formatter.js';
export { FindMatch, find } from './executor/executor.js';
export { compile, fastMatch, CompiledProgram } from './executor/fast.js';
export { LineMatch, SearchError, SearchResult, SearchOptions, StreamSearchOptions, searchString, searchFile, searchFolder, searchStream, searchFileStream, formatSearchResults } from './search/search.js';

// @api-parse
export function parse(source: string): MatchProgram {
  const tokens = lex(source);
  const program = parseTokens(tokens);
  validate(program);
  (program as any).__compiled = compile(program);
  return program;
}
// @api-parse-end

const encoder = new TextEncoder();

// @api-match
export function match(program: MatchProgram, input: string): MatchResult {
  const cp: CompiledProgram | undefined = (program as any).__compiled;
  if (cp) {
    const inputBytes = encoder.encode(input);
    const consumed = wasmFastMatch(cp, inputBytes);
    if (consumed === inputBytes.length) {
      return execute(program, input, true);
    }
  }
  return execute(program, input);
}
// @api-match-end

// @api-run
export function run(source: string, input: string): MatchResult {
  const program = parse(source);
  return match(program, input);
}
// @api-run-end

// @api-try-parse
export function tryParse(source: string, input: string): MatchSuccess | PartialResult {
  const program = parse(source);
  return executePartial(program, input);
}
// @api-try-parse-end
