import { MatchProgram, ASTNode, RuleNode } from '../types/ast.js';
import { ParseError } from '../types/error.js';

// @validate-main
export function validate(program: MatchProgram): void {
  checkDuplicateRules(program);
  checkUndefinedRules(program);
  checkRanges(program);
  checkRepeatBounds(program);
  checkLeftRecursion(program);
  checkByteCodepointMixing(program);
}
// @validate-main-end

// @validate-duplicate-rules
function checkDuplicateRules(program: MatchProgram) {
  const seen = new Map<string, RuleNode>();
  for (const rule of program.rules) {
    const existing = seen.get(rule.name);
    if (existing) {
      throw new ParseError(
        `Duplicate rule "${rule.name}" (first defined at line ${existing.line})`,
        rule.line,
        rule.column,
      );
    }
    seen.set(rule.name, rule);
  }
}
// @validate-duplicate-rules-end

// @validate-undefined-rules
function checkUndefinedRules(program: MatchProgram) {
  const defined = new Set(program.rules.map(r => r.name));
  for (const rule of program.rules) {
    visitNode(rule.body, (node) => {
      if (node.type === 'rule_ref' && !defined.has(node.name)) {
        throw new ParseError(`Undefined rule "${node.name}"`, node.line, node.column);
      }
    });
  }
}
// @validate-undefined-rules-end

// @validate-ranges
function checkRanges(program: MatchProgram) {
  for (const rule of program.rules) {
    visitNode(rule.body, (node) => {
      if (node.type === 'range' && node.low > node.high) {
        throw new ParseError(
          `Invalid range: 0x${node.low.toString(16).toUpperCase()} > 0x${node.high.toString(16).toUpperCase()}`,
          node.line,
          node.column,
        );
      }
    });
  }
}
// @validate-ranges-end

// @validate-repeat-bounds
function checkRepeatBounds(program: MatchProgram) {
  for (const rule of program.rules) {
    visitNode(rule.body, (node) => {
      if (node.type === 'repeat' && node.mode === 'between' &&
          node.min !== undefined && node.max !== undefined && node.min > node.max) {
        throw new ParseError(
          `Invalid repeat bounds: minimum ${node.min} > maximum ${node.max}`,
          node.line,
          node.column,
        );
      }
    });
  }
}
// @validate-repeat-bounds-end

// @validate-left-recursion
function checkLeftRecursion(program: MatchProgram) {
  const ruleMap = new Map<string, RuleNode>();
  for (const rule of program.rules) {
    ruleMap.set(rule.name, rule);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function checkRule(name: string, chain: string[]) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const cycle = [...chain, name];
      const start = cycle.indexOf(name);
      const cycleStr = cycle.slice(start).join(' -> ');
      const rule = ruleMap.get(name)!;
      throw new ParseError(`Left recursion detected: ${cycleStr}`, rule.line, rule.column);
    }

    visiting.add(name);
    const rule = ruleMap.get(name);
    if (rule) {
      const firstRefs = getLeftmostRuleRefs(rule.body);
      for (const ref of firstRefs) {
        checkRule(ref, [...chain, name]);
      }
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const rule of program.rules) {
    checkRule(rule.name, []);
  }
}

function getLeftmostRuleRefs(node: ASTNode): string[] {
  switch (node.type) {
    case 'rule_ref':
      return [node.name];
    case 'sequence':
      return node.elements.length > 0 ? getLeftmostRuleRefs(node.elements[0]) : [];
    case 'alternative':
      return node.options.flatMap(getLeftmostRuleRefs);
    case 'group':
      return getLeftmostRuleRefs(node.child);
    case 'repeat':
      return getLeftmostRuleRefs(node.child);
    case 'joined_by':
      return getLeftmostRuleRefs(node.element);
    case 'until':
      return getLeftmostRuleRefs(node.child);
    case 'isnt':
      return getLeftmostRuleRefs(node.child);
    case 'extract':
      return getLeftmostRuleRefs(node.child);
    case 'except':
      return getLeftmostRuleRefs(node.base);
    default:
      return [];
  }
}
// @validate-left-recursion-end

// @validate-byte-codepoint-mixing
function checkByteCodepointMixing(program: MatchProgram) {
  for (const rule of program.rules) {
    let hasCodepoint = false;
    let hasHighByte = false;
    let codepointNode: ASTNode | null = null;
    let byteNode: ASTNode | null = null;

    visitNode(rule.body, (node) => {
      if (node.type === 'char_class' && node.className === 'any character') {
        if (!hasCodepoint) { hasCodepoint = true; codepointNode = node; }
      } else if (node.type === 'none_of') {
        if (!hasCodepoint) { hasCodepoint = true; codepointNode = node; }
      } else if (node.type === 'byte_literal' && node.byte >= 0x80) {
        if (!hasHighByte) { hasHighByte = true; byteNode = node; }
      } else if (node.type === 'range' && node.high >= 0x80) {
        if (!hasHighByte) { hasHighByte = true; byteNode = node; }
      }
    });

    if (hasCodepoint && hasHighByte) {
      const node = byteNode || codepointNode!;
      throw new ParseError(
        `Rule "${rule.name}" mixes codepoint-aware constructs (any character, none of) with high byte ranges (>= 0x80) — split into separate rules to avoid misaligned positions`,
        node.line,
        node.column,
      );
    }
  }
}
// @validate-byte-codepoint-mixing-end

// @validate-visit
function visitNode(node: ASTNode, fn: (node: ASTNode) => void) {
  fn(node);
  switch (node.type) {
    case 'sequence':
      node.elements.forEach(e => visitNode(e, fn));
      break;
    case 'alternative':
      node.options.forEach(o => visitNode(o, fn));
      break;
    case 'repeat':
      visitNode(node.child, fn);
      break;
    case 'group':
      visitNode(node.child, fn);
      break;
    case 'joined_by':
      visitNode(node.element, fn);
      visitNode(node.separator, fn);
      break;
    case 'until':
      visitNode(node.child, fn);
      visitNode(node.terminator, fn);
      break;
    case 'isnt':
      visitNode(node.child, fn);
      visitNode(node.negated, fn);
      break;
    case 'extract':
      visitNode(node.child, fn);
      break;
    case 'any_of':
    case 'none_of':
      node.items.forEach(i => visitNode(i, fn));
      break;
    case 'except':
      visitNode(node.base, fn);
      node.exclusions.forEach(e => visitNode(e, fn));
      break;
  }
}
// @validate-visit-end
