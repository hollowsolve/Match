import { MatchFailure, RuleMatch } from '../types/result.js';

// @diag-format-failure
/**
 * @stable — public API since v1.0.
 * Output format:
 *   match failed at byte {offset} (line {line}, column {column}):
 *     expected: {expected items, comma-separated, last joined with "or"}
 *     found: {found}
 *     in: {rule_stack, joined with " > "}
 *
 *     {context line}
 *     {^ pointer}
 */
export function formatFailure(failure: MatchFailure, input?: string): string {
  const lines: string[] = [];

  lines.push(`match failed at byte ${failure.offset} (line ${failure.line}, column ${failure.column}):`);

  if (failure.expected.length > 0) {
    const expectedStr = failure.expected.length <= 3
      ? failure.expected.join(', ')
      : failure.expected.slice(0, -1).join(', ') + ', or ' + failure.expected[failure.expected.length - 1];
    lines.push(`  expected: ${expectedStr}`);
  }

  lines.push(`  found: ${failure.found}`);

  if (failure.rule_stack.length > 0) {
    lines.push(`  in: ${failure.rule_stack.join(' > ')}`);
  }

  if (input) {
    const context = getContext(input, failure.offset);
    if (context) lines.push('', context);
  }

  return lines.join('\n');
}
// @diag-format-failure-end

// @diag-format-tree
export function formatTree(tree: RuleMatch, prefix: string = '', childPrefix: string = ''): string {
  const textPreview = tree.text.length > 40
    ? JSON.stringify(tree.text.slice(0, 37) + '...')
    : JSON.stringify(tree.text);

  let line = `${prefix}${tree.rule} [${tree.start}..${tree.end}]`;
  if (tree.text.length > 0) {
    line += ` ${textPreview}`;
  }

  const lines = [line];
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    const isLast = i === tree.children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const extension = isLast ? '    ' : '│   ';
    lines.push(formatTree(child, childPrefix + connector, childPrefix + extension));
  }

  return lines.join('\n');
}
// @diag-format-tree-end

// @diag-context
function getContext(input: string, offset: number): string | null {
  const lines = input.split('\n');
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = pos + lines[i].length;
    if (offset >= pos && offset <= lineEnd) {
      const col = offset - pos;
      const lineStr = lines[i];
      const pointer = ' '.repeat(col) + '^';
      return `  ${lineStr}\n  ${pointer}`;
    }
    pos = lineEnd + 1;
  }
  return null;
}
// @diag-context-end
