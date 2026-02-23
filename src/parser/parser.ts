import {
  ASTNode, RuleNode, MatchProgram,
  NamedCharNode, QuotedLiteralNode, ByteLiteralNode,
  CharClassNode, RangeNode, AnyOfNode, NoneOfNode,
  ExceptNode, TextBlockNode, RuleRefNode,
  SequenceNode, AlternativeNode, RepeatNode, JoinedByNode,
  UntilNode, IsntNode, ExtractNode, GroupNode,
} from '../types/ast.js';
import { Token, TokenType } from '../types/token.js';
import { ParseError } from '../types/error.js';
import { NAMED_CHARS } from '../stdlib/stdlib.js';

// @parse-named-char-tokens
const NAMED_CHAR_TOKENS = new Set<TokenType>([
  TokenType.Exclamation, TokenType.DoubleQuote, TokenType.Hash,
  TokenType.Dollar, TokenType.Percent, TokenType.Ampersand,
  TokenType.SingleQuote, TokenType.OpenParen, TokenType.CloseParen,
  TokenType.Asterisk, TokenType.Plus, TokenType.Comma,
  TokenType.Hyphen, TokenType.Period, TokenType.Slash,
  TokenType.Colon, TokenType.Semicolon, TokenType.LessThan,
  TokenType.Equals, TokenType.GreaterThan, TokenType.Question,
  TokenType.At, TokenType.OpenBracket, TokenType.Backslash,
  TokenType.CloseBracket, TokenType.Caret, TokenType.Underscore,
  TokenType.Backtick, TokenType.OpenBrace, TokenType.Pipe,
  TokenType.CloseBrace, TokenType.Tilde,
  TokenType.Space, TokenType.Tab, TokenType.Newline,
  TokenType.CarriageReturn, TokenType.Null,
]);
// @parse-named-char-tokens-end

// @parse-class-tokens
const CLASS_TOKENS = new Set<TokenType>([
  TokenType.Letter, TokenType.Digit, TokenType.HexDigit,
  TokenType.Whitespace, TokenType.Visible, TokenType.Printable,
  TokenType.Alphanumeric, TokenType.WordCharacter, TokenType.AnyCharacter,
  TokenType.Uppercase, TokenType.Lowercase,
]);
// @parse-class-tokens-end

// @parse-main
export function parse(tokens: Token[]): MatchProgram {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

class Parser {
  private tokens: Token[];
  private pos: number;
  private ruleNames: Set<string> = new Set();

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.collectRuleNames();
  }

  private collectRuleNames() {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].type === TokenType.RuleColon && i > 0) {
        this.ruleNames.add(this.tokens[i - 1].value);
      }
    }
  }

  private peek(): Token {
    if (this.pos >= this.tokens.length) {
      const last = this.tokens[this.tokens.length - 1];
      return { type: TokenType.EOF, value: '', line: last?.line ?? 1, column: last?.column ?? 1 };
    }
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length) this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParseError(`Expected ${type}, got ${t.type} (${t.value})`, t.line, t.column);
    }
    return this.advance();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): Token | null {
    if (this.check(type)) return this.advance();
    return null;
  }

  // @parse-program
  parseProgram(): MatchProgram {
    const rules: RuleNode[] = [];

    while (!this.check(TokenType.EOF)) {
      rules.push(this.parseRule());
    }

    if (rules.length === 0) {
      throw new ParseError('Empty file: no rules defined', 1, 1);
    }

    return {
      rules,
      entryPoint: rules[rules.length - 1].name,
    };
  }
  // @parse-program-end

  // @parse-rule
  private parseRule(): RuleNode {
    const nameToken = this.expect(TokenType.Identifier);
    this.expect(TokenType.RuleColon);
    const body = this.parseExpr();
    return {
      name: nameToken.value,
      body,
      line: nameToken.line,
      column: nameToken.column,
    };
  }
  // @parse-rule-end

  // @parse-expr
  private parseExpr(): ASTNode {
    return this.parseAlternative();
  }

  private parseAlternative(): ASTNode {
    let left = this.parseJoined();

    while (this.check(TokenType.Or)) {
      this.advance();
      const right = this.parseJoined();
      if (left.type === 'alternative') {
        (left as AlternativeNode).options.push(right);
      } else {
        left = { type: 'alternative', options: [left, right], line: left.line, column: left.column };
      }
    }

    return left;
  }
  // @parse-expr-end

  // @parse-joined
  private parseJoined(): ASTNode {
    const left = this.parseSequence();

    if (this.match(TokenType.JoinedBy)) {
      const sep = this.parseSequence();
      const lenient = !!this.match(TokenType.Lenient);
      return { type: 'joined_by', element: left, separator: sep, lenient, line: left.line, column: left.column };
    }

    return left;
  }
  // @parse-joined-end

  // @parse-sequence
  private parseSequence(): ASTNode {
    const elements: ASTNode[] = [this.parseRepeated()];

    while (this.match(TokenType.Then) || this.match(TokenType.CommaSyntax)) {
      elements.push(this.parseRepeated());
    }

    const node = elements.length === 1
      ? elements[0]
      : { type: 'sequence', elements, line: elements[0].line, column: elements[0].column } as SequenceNode;

    if (this.check(TokenType.Until)) {
      const untilToken = this.advance();
      let mode: 'including' | 'excluding';
      if (this.match(TokenType.Including)) {
        mode = 'including';
      } else if (this.match(TokenType.Excluding)) {
        mode = 'excluding';
      } else {
        throw new ParseError('Expected "including" or "excluding" after "until"', untilToken.line, untilToken.column);
      }
      const terminator = this.parseRepeated();
      return { type: 'until', child: node, terminator, mode, line: node.line, column: node.column } as UntilNode;
    }

    return node;
  }
  // @parse-sequence-end

  // @parse-repeated
  private parseNumber(t: Token): number {
    if (t.value === 'one') return 1;
    return parseInt(t.value);
  }

  private parseRepeated(): ASTNode {
    const t = this.peek();

    if (t.type === TokenType.OneOrMore || t.type === TokenType.ZeroOrMore) {
      const mode = t.type === TokenType.OneOrMore ? 'one_or_more' : 'zero_or_more';
      this.advance();

      if (this.check(TokenType.Of)) {
        this.advance();
        this.expect(TokenType.OpenParenSyntax);
        const items = this.parseSetItems();
        this.expect(TokenType.CloseParenSyntax);
        const child: ASTNode = { type: 'any_of', items, line: t.line, column: t.column } as AnyOfNode;
        let node: ASTNode = { type: 'repeat', child, mode, line: t.line, column: t.column };
        if (this.match(TokenType.Isnt)) {
          const negated = this.parseAtom();
          node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
        }
        return node;
      }

      if (this.check(TokenType.Identifier) && this.peek().value === 'characters') {
        this.advance();
        if (this.check(TokenType.Except)) {
          this.advance();
          this.expect(TokenType.OpenParenSyntax);
          const items = this.parseSetItems();
          this.expect(TokenType.CloseParenSyntax);
          const child: ASTNode = { type: 'none_of', items, line: t.line, column: t.column } as NoneOfNode;
          let node: ASTNode = { type: 'repeat', child, mode, line: t.line, column: t.column };
          if (this.match(TokenType.Isnt)) {
            const negated = this.parseAtom();
            node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
          }
          return node;
        }
        throw new ParseError('Expected "except" after "characters"', this.peek().line, this.peek().column);
      }

      const child = this.parseAtom();
      let node: ASTNode = { type: 'repeat', child, mode, line: t.line, column: t.column };
      if (this.match(TokenType.Isnt)) {
        const negated = this.parseAtom();
        node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
      }
      return node;
    }

    if (t.type === TokenType.Optional) {
      this.advance();
      const child = this.parseAtom();
      let node: ASTNode = { type: 'repeat', child, mode: 'optional', line: t.line, column: t.column };
      if (this.match(TokenType.Isnt)) {
        const negated = this.parseAtom();
        node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
      }
      return node;
    }

    if (t.type === TokenType.Between) {
      this.advance();
      const lo = this.expect(TokenType.Number);
      this.expect(TokenType.And);
      const hi = this.expect(TokenType.Number);
      const child = this.parseAtom();
      let node: ASTNode = { type: 'repeat', child, mode: 'between', min: this.parseNumber(lo), max: this.parseNumber(hi), line: t.line, column: t.column };
      if (this.match(TokenType.Isnt)) {
        const negated = this.parseAtom();
        node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
      }
      return node;
    }

    if (t.type === TokenType.Number) {
      const saved = this.pos;
      this.advance();
      const n = this.parseNumber(t);
      const next = this.peek();
      if (this.isAtomStart(next)) {
        const child = this.parseAtom();
        if (this.check(TokenType.Or) && this.peekAt(1)?.type === TokenType.More) {
          this.advance();
          this.advance();
          if (n !== 1) {
            throw new ParseError(`"${t.value} ... or more" only valid with "one"`, t.line, t.column);
          }
          let node: ASTNode = { type: 'repeat', child, mode: 'one_or_more', line: t.line, column: t.column };
          if (this.match(TokenType.Isnt)) {
            const negated = this.parseAtom();
            node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
          }
          return node;
        }
        let node: ASTNode = { type: 'repeat', child, mode: 'exactly', min: n, line: t.line, column: t.column };
        if (this.match(TokenType.Isnt)) {
          const negated = this.parseAtom();
          node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
        }
        return node;
      }
      this.pos = saved;
    }

    let node = this.parseAtom();

    if (this.match(TokenType.Isnt)) {
      const negated = this.parseAtom();
      node = { type: 'isnt', child: node, negated, line: node.line, column: node.column } as IsntNode;
    }

    return node;
  }

  private peekAt(offset: number): Token | null {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return null;
    return this.tokens[idx];
  }

  private isAtomStart(t: Token): boolean {
    return t.type === TokenType.Extract ||
      t.type === TokenType.Begin ||
      t.type === TokenType.OpenParenSyntax ||
      t.type === TokenType.AnyOf ||
      t.type === TokenType.NoneOfSyntax ||
      CLASS_TOKENS.has(t.type) ||
      NAMED_CHAR_TOKENS.has(t.type) ||
      t.type === TokenType.QuotedLiteral ||
      t.type === TokenType.ByteLiteral ||
      t.type === TokenType.Identifier;
  }
  // @parse-repeated-end

  // @parse-atom
  private parseAtom(): ASTNode {
    const t = this.peek();

    if (t.type === TokenType.Extract) {
      this.advance();
      const child = this.parseRepeated();
      return { type: 'extract', child, line: t.line, column: t.column } as ExtractNode;
    }

    if (t.type === TokenType.Begin) {
      return this.parseTextBlock();
    }

    if (t.type === TokenType.OpenParenSyntax) {
      return this.parseGroup();
    }

    if (t.type === TokenType.AnyOf) {
      return this.parseAnyOf();
    }

    if (t.type === TokenType.NoneOfSyntax) {
      return this.parseNoneOf();
    }

    if (CLASS_TOKENS.has(t.type)) {
      return this.parseCharClassWithModifiers();
    }

    if (NAMED_CHAR_TOKENS.has(t.type)) {
      return this.parseNamedChar();
    }

    if (t.type === TokenType.QuotedLiteral) {
      return this.parseQuotedOrRange();
    }

    if (t.type === TokenType.ByteLiteral) {
      return this.parseByteOrRange();
    }

    if (t.type === TokenType.Identifier) {
      return this.parseRuleRef();
    }

    throw new ParseError(`Unexpected token: ${t.type} (${t.value})`, t.line, t.column);
  }
  // @parse-atom-end

  // @parse-char-class-with-modifiers
  private parseCharClassWithModifiers(): ASTNode {
    const t = this.advance();
    let node: ASTNode = {
      type: 'char_class',
      className: t.value,
      line: t.line,
      column: t.column,
    } as CharClassNode;

    if (this.check(TokenType.Except)) {
      node = this.parseExceptClause(node);
    }

    return node;
  }
  // @parse-char-class-with-modifiers-end

  // @parse-except-clause
  private parseExceptClause(base: ASTNode): ExceptNode {
    this.advance();
    this.expect(TokenType.OpenParenSyntax);
    const exclusions = this.parseSetItems();
    this.expect(TokenType.CloseParenSyntax);
    return { type: 'except', base, exclusions, line: base.line, column: base.column };
  }
  // @parse-except-clause-end

  // @parse-named-char
  private parseNamedChar(): NamedCharNode {
    const t = this.advance();
    return {
      type: 'named_char',
      name: t.value,
      byte: NAMED_CHARS[t.value],
      line: t.line,
      column: t.column,
    };
  }
  // @parse-named-char-end

  // @parse-quoted-or-range
  private parseQuotedOrRange(): ASTNode {
    const t = this.advance();
    const byte = t.value.charCodeAt(0);

    if (this.check(TokenType.To)) {
      this.advance();
      const high = this.peek();
      if (high.type === TokenType.QuotedLiteral) {
        this.advance();
        return {
          type: 'range',
          low: byte,
          high: high.value.charCodeAt(0),
          line: t.line,
          column: t.column,
        } as RangeNode;
      }
      if (high.type === TokenType.ByteLiteral) {
        this.advance();
        return {
          type: 'range',
          low: byte,
          high: parseInt(high.value, 16),
          line: t.line,
          column: t.column,
        } as RangeNode;
      }
      throw new ParseError('Expected quoted literal or byte literal after "to"', high.line, high.column);
    }

    return { type: 'quoted_literal', char: t.value, byte, line: t.line, column: t.column } as QuotedLiteralNode;
  }
  // @parse-quoted-or-range-end

  // @parse-byte-or-range
  private parseByteOrRange(): ASTNode {
    const t = this.advance();
    const byte = parseInt(t.value, 16);

    if (this.check(TokenType.To)) {
      this.advance();
      const high = this.peek();
      if (high.type === TokenType.ByteLiteral) {
        this.advance();
        return {
          type: 'range',
          low: byte,
          high: parseInt(high.value, 16),
          line: t.line,
          column: t.column,
        } as RangeNode;
      }
      if (high.type === TokenType.QuotedLiteral) {
        this.advance();
        return {
          type: 'range',
          low: byte,
          high: high.value.charCodeAt(0),
          line: t.line,
          column: t.column,
        } as RangeNode;
      }
      throw new ParseError('Expected byte literal or quoted literal after "to"', high.line, high.column);
    }

    return { type: 'byte_literal', byte, line: t.line, column: t.column } as ByteLiteralNode;
  }
  // @parse-byte-or-range-end

  // @parse-any-of
  private parseAnyOf(): AnyOfNode {
    const t = this.advance();
    this.expect(TokenType.OpenParenSyntax);
    const items = this.parseSetItems();
    this.expect(TokenType.CloseParenSyntax);
    return { type: 'any_of', items, line: t.line, column: t.column };
  }
  // @parse-any-of-end

  // @parse-none-of
  private parseNoneOf(): NoneOfNode {
    const t = this.advance();
    this.expect(TokenType.OpenParenSyntax);
    const items = this.parseSetItems();
    this.expect(TokenType.CloseParenSyntax);
    return { type: 'none_of', items, line: t.line, column: t.column };
  }
  // @parse-none-of-end

  // @parse-set-items
  private parseSetItems(): ASTNode[] {
    const items: ASTNode[] = [this.parseSetItem()];
    while (this.match(TokenType.CommaSyntax)) {
      items.push(this.parseSetItem());
    }
    return items;
  }

  private parseSetItem(): ASTNode {
    const t = this.peek();

    if (t.type === TokenType.QuotedLiteral) return this.parseQuotedOrRange();
    if (t.type === TokenType.ByteLiteral) return this.parseByteOrRange();
    if (CLASS_TOKENS.has(t.type)) {
      this.advance();
      let node: ASTNode = { type: 'char_class', className: t.value, line: t.line, column: t.column } as CharClassNode;
      if (this.check(TokenType.Except)) {
        node = this.parseExceptClause(node);
      }
      return node;
    }
    if (NAMED_CHAR_TOKENS.has(t.type)) {
      this.advance();
      return { type: 'named_char', name: t.value, byte: NAMED_CHARS[t.value], line: t.line, column: t.column } as NamedCharNode;
    }

    throw new ParseError(`Expected set item, got ${t.type} (${t.value})`, t.line, t.column);
  }
  // @parse-set-items-end

  // @parse-text-block
  private parseTextBlock(): TextBlockNode {
    const t = this.advance();
    return { type: 'text_block', text: t.value, line: t.line, column: t.column };
  }
  // @parse-text-block-end

  // @parse-group
  private parseGroup(): ASTNode {
    const t = this.advance();
    const expr = this.parseExpr();
    this.expect(TokenType.CloseParenSyntax);
    return { type: 'group', child: expr, line: t.line, column: t.column } as GroupNode;
  }
  // @parse-group-end

  // @parse-rule-ref
  private parseRuleRef(): RuleRefNode {
    const parts: Token[] = [this.advance()];

    while (this.check(TokenType.Identifier)) {
      const combined = parts.map(p => p.value).join(' ') + ' ' + this.peek().value;
      if (this.ruleNames.has(combined)) {
        parts.push(this.advance());
      } else {
        break;
      }
    }

    const name = parts.map(p => p.value).join(' ');
    return {
      type: 'rule_ref',
      name,
      line: parts[0].line,
      column: parts[0].column,
    };
  }
  // @parse-rule-ref-end
}
// @parse-main-end

