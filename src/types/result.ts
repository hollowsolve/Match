// @type-result

/**
 * @stable — public API since v1.0.
 * Structure of a matched rule in the parse tree.
 */
export interface RuleMatch {
  rule: string;
  start: number;
  end: number;
  text: string;
  children: RuleMatch[];
}

/**
 * @stable — public API since v1.0.
 */
export interface MatchSuccess {
  matched: true;
  bytes_consumed: number;
  tree: RuleMatch;
  extracted: RuleMatch[];
}

/**
 * @stable — public API since v1.0.
 * All fields are guaranteed stable. Tooling may depend on this shape.
 *
 * - offset:     byte offset where the failure occurred
 * - line:       1-based line number
 * - column:     1-based column number
 * - expected:   list of patterns the parser expected at the failure point
 * - found:      description of what was actually found
 * - rule_stack: call stack of rule names at the failure point (outermost first)
 */
export interface MatchFailure {
  matched: false;
  offset: number;
  line: number;
  column: number;
  expected: string[];
  found: string;
  rule_stack: string[];
}

/**
 * @stable — public API since v1.0.
 * Returned by tryParse() on failure. Includes partial parse tree and
 * all MatchFailure fields.
 */
export interface PartialResult {
  matched: false;
  bytes_consumed: number;
  partial_tree: RuleMatch | null;
  extracted: RuleMatch[];
  offset: number;
  line: number;
  column: number;
  expected: string[];
  found: string;
  rule_stack: string[];
}

export type MatchResult = MatchSuccess | MatchFailure;
// @type-result-end
