// @type-ast
export type ASTNode =
  | NamedCharNode
  | QuotedLiteralNode
  | ByteLiteralNode
  | CharClassNode
  | RangeNode
  | AnyOfNode
  | NoneOfNode
  | ExceptNode
  | SequenceNode
  | AlternativeNode
  | RepeatNode
  | JoinedByNode
  | UntilNode
  | IsntNode
  | ExtractNode
  | TextBlockNode
  | RuleRefNode
  | GroupNode;

export interface NamedCharNode {
  type: 'named_char';
  name: string;
  byte: number;
  line: number;
  column: number;
}

export interface QuotedLiteralNode {
  type: 'quoted_literal';
  char: string;
  byte: number;
  line: number;
  column: number;
}

export interface ByteLiteralNode {
  type: 'byte_literal';
  byte: number;
  line: number;
  column: number;
}

export interface CharClassNode {
  type: 'char_class';
  className: string;
  line: number;
  column: number;
}

export interface RangeNode {
  type: 'range';
  low: number;
  high: number;
  line: number;
  column: number;
}

export interface AnyOfNode {
  type: 'any_of';
  items: ASTNode[];
  line: number;
  column: number;
}

export interface NoneOfNode {
  type: 'none_of';
  items: ASTNode[];
  line: number;
  column: number;
}

export interface ExceptNode {
  type: 'except';
  base: ASTNode;
  exclusions: ASTNode[];
  line: number;
  column: number;
}

export interface SequenceNode {
  type: 'sequence';
  elements: ASTNode[];
  line: number;
  column: number;
}

export interface AlternativeNode {
  type: 'alternative';
  options: ASTNode[];
  line: number;
  column: number;
}

export interface RepeatNode {
  type: 'repeat';
  child: ASTNode;
  mode: 'one_or_more' | 'zero_or_more' | 'optional' | 'exactly' | 'between';
  min?: number;
  max?: number;
  line: number;
  column: number;
}

export interface JoinedByNode {
  type: 'joined_by';
  element: ASTNode;
  separator: ASTNode;
  lenient: boolean;
  line: number;
  column: number;
}

export interface UntilNode {
  type: 'until';
  child: ASTNode;
  terminator: ASTNode;
  mode: 'including' | 'excluding';
  line: number;
  column: number;
}

export interface IsntNode {
  type: 'isnt';
  child: ASTNode;
  negated: ASTNode;
  line: number;
  column: number;
}

export interface ExtractNode {
  type: 'extract';
  child: ASTNode;
  line: number;
  column: number;
}

export interface TextBlockNode {
  type: 'text_block';
  text: string;
  line: number;
  column: number;
}

export interface RuleRefNode {
  type: 'rule_ref';
  name: string;
  line: number;
  column: number;
}

export interface GroupNode {
  type: 'group';
  child: ASTNode;
  line: number;
  column: number;
}

export interface RuleNode {
  name: string;
  body: ASTNode;
  line: number;
  column: number;
}

export interface MatchProgram {
  rules: RuleNode[];
  entryPoint: string;
}
// @type-ast-end
