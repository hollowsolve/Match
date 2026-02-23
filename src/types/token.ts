// @type-token
export enum TokenType {
  // keywords
  Then = 'then',
  Or = 'or',
  AnyOf = 'any of',
  NoneOfSyntax = 'none of',
  Except = 'except',
  OneOrMore = 'one or more',
  ZeroOrMore = 'zero or more',
  Optional = 'optional',
  JoinedBy = 'joined by',
  To = 'to',
  Begin = 'begin',
  End = 'end',
  Until = 'until',
  Isnt = "isn't",
  Extract = 'extract',
  Including = 'including',
  Excluding = 'excluding',
  Lenient = 'lenient',
  Exactly = 'exactly',
  Between = 'between',
  And = 'and',
  More = 'more',
  Of = 'of',

  // classes
  AnyCharacter = 'any character',
  Letter = 'letter',
  Digit = 'digit',
  HexDigit = 'hex digit',
  Whitespace = 'whitespace',
  Visible = 'visible',
  Printable = 'printable',
  Alphanumeric = 'alphanumeric',
  WordCharacter = 'word character',
  Uppercase = 'uppercase',
  Lowercase = 'lowercase',

  // whitespace chars
  Space = 'space',
  Tab = 'tab',
  Newline = 'newline',
  CarriageReturn = 'carriage return',
  Null = 'null',

  // symbols (named chars)
  Exclamation = 'exclamation',
  DoubleQuote = 'double quote',
  Hash = 'hash',
  Dollar = 'dollar',
  Percent = 'percent',
  Ampersand = 'ampersand',
  SingleQuote = 'single quote',
  OpenParen = 'open paren',
  CloseParen = 'close paren',
  Asterisk = 'asterisk',
  Plus = 'plus',
  Comma = 'comma',
  Hyphen = 'hyphen',
  Period = 'period',
  Slash = 'slash',
  Colon = 'colon',
  Semicolon = 'semicolon',
  LessThan = 'less than',
  Equals = 'equals',
  GreaterThan = 'greater than',
  Question = 'question',
  At = 'at',
  OpenBracket = 'open bracket',
  Backslash = 'backslash',
  CloseBracket = 'close bracket',
  Caret = 'caret',
  Underscore = 'underscore',
  Backtick = 'backtick',
  OpenBrace = 'open brace',
  Pipe = 'pipe',
  CloseBrace = 'close brace',
  Tilde = 'tilde',

  // structural
  QuotedLiteral = 'quoted_literal',
  ByteLiteral = 'byte_literal',
  Number = 'number',
  Identifier = 'identifier',
  RuleColon = 'rule_colon',
  OpenParenSyntax = 'open_paren_syntax',
  CloseParenSyntax = 'close_paren_syntax',
  CommaSyntax = 'comma_syntax',

  EOF = 'eof',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}
// @type-token-end
