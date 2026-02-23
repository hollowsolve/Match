import { Token, TokenType } from '../types/token.js';
import { ParseError } from '../types/error.js';

// @lex-multi-word-map
const MULTI_WORD_KEYWORDS: [string[], TokenType][] = [
  [['one', 'or', 'more'], TokenType.OneOrMore],
  [['zero', 'or', 'more'], TokenType.ZeroOrMore],
  [['joined', 'by'], TokenType.JoinedBy],
  [['any', 'of'], TokenType.AnyOf],
  [['none', 'of'], TokenType.NoneOfSyntax],
  [['any', 'character'], TokenType.AnyCharacter],
  [['any', 'characters'], TokenType.AnyCharacter],
  [['hex', 'digit'], TokenType.HexDigit],
  [['hex', 'digits'], TokenType.HexDigit],
  [['word', 'character'], TokenType.WordCharacter],
  [['word', 'characters'], TokenType.WordCharacter],
  [['double', 'quote'], TokenType.DoubleQuote],
  [['single', 'quote'], TokenType.SingleQuote],
  [['open', 'paren'], TokenType.OpenParen],
  [['close', 'paren'], TokenType.CloseParen],
  [['open', 'bracket'], TokenType.OpenBracket],
  [['close', 'bracket'], TokenType.CloseBracket],
  [['open', 'brace'], TokenType.OpenBrace],
  [['close', 'brace'], TokenType.CloseBrace],
  [['less', 'than'], TokenType.LessThan],
  [['greater', 'than'], TokenType.GreaterThan],
  [['carriage', 'return'], TokenType.CarriageReturn],
];
// @lex-multi-word-map-end

// @lex-single-word-map
const SINGLE_WORD_KEYWORDS: Record<string, TokenType> = {
  'then': TokenType.Then,
  'or': TokenType.Or,
  'except': TokenType.Except,
  'optional': TokenType.Optional,
  'to': TokenType.To,
  'until': TokenType.Until,
  "isn't": TokenType.Isnt,
  'isnt': TokenType.Isnt,
  'extract': TokenType.Extract,
  'including': TokenType.Including,
  'excluding': TokenType.Excluding,
  'lenient': TokenType.Lenient,
  'exactly': TokenType.Exactly,
  'between': TokenType.Between,
  'and': TokenType.And,
  'letter': TokenType.Letter,
  'letters': TokenType.Letter,
  'digit': TokenType.Digit,
  'digits': TokenType.Digit,
  'whitespace': TokenType.Whitespace,
  'visible': TokenType.Visible,
  'printable': TokenType.Printable,
  'alphanumeric': TokenType.Alphanumeric,
  'alphanumerics': TokenType.Alphanumeric,
  'uppercase': TokenType.Uppercase,
  'lowercase': TokenType.Lowercase,
  'one': TokenType.Number,
  'more': TokenType.More,
  'of': TokenType.Of,
  'dot': TokenType.Period,
  'dash': TokenType.Hyphen,
  'bang': TokenType.Exclamation,
  'exclamation': TokenType.Exclamation,
  'hash': TokenType.Hash,
  'dollar': TokenType.Dollar,
  'percent': TokenType.Percent,
  'ampersand': TokenType.Ampersand,
  'asterisk': TokenType.Asterisk,
  'plus': TokenType.Plus,
  'comma': TokenType.Comma,
  'hyphen': TokenType.Hyphen,
  'period': TokenType.Period,
  'slash': TokenType.Slash,
  'colon': TokenType.Colon,
  'semicolon': TokenType.Semicolon,
  'equals': TokenType.Equals,
  'question': TokenType.Question,
  'at': TokenType.At,
  'backslash': TokenType.Backslash,
  'caret': TokenType.Caret,
  'underscore': TokenType.Underscore,
  'backtick': TokenType.Backtick,
  'pipe': TokenType.Pipe,
  'tilde': TokenType.Tilde,
  'space': TokenType.Space,
  'tab': TokenType.Tab,
  'newline': TokenType.Newline,
  'null': TokenType.Null,
};
const PLURAL_TO_SINGULAR: Record<string, string> = {
  'letters': 'letter',
  'digits': 'digit',
  'alphanumerics': 'alphanumeric',
  'any characters': 'any character',
  'hex digits': 'hex digit',
  'word characters': 'word character',
};
// @lex-single-word-map-end

// @lex-main
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const logical = joinLogicalLines(source);
  const lines = logical.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const lineNum = lineIdx + 1;
    const colonIdx = findRuleColon(trimmed);

    if (colonIdx !== -1) {
      const name = trimmed.slice(0, colonIdx).trim();
      tokens.push({ type: TokenType.Identifier, value: name, line: lineNum, column: 1 });
      tokens.push({ type: TokenType.RuleColon, value: ':', line: lineNum, column: colonIdx + 1 });
      const body = trimmed.slice(colonIdx + 1).trim();
      if (body.length > 0) {
        const bodyTokens = lexExpression(body, lineNum, colonIdx + 2);
        tokens.push(...bodyTokens);
      }
    } else {
      const bodyTokens = lexExpression(trimmed, lineNum, 1);
      tokens.push(...bodyTokens);
    }
  }

  const lastLine = lines.length;
  tokens.push({ type: TokenType.EOF, value: '', line: lastLine, column: 1 });
  return tokens;
}
// @lex-main-end

// @lex-join-logical-lines
function joinLogicalLines(source: string): string {
  const rawLines = source.split('\n');
  const result: string[] = [];
  let current: string | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const stripped = stripComment(raw);
    const trimmed = stripped.trim();

    if (trimmed === '') {
      if (current !== null) {
        result.push(current);
        current = null;
      }
      continue;
    }

    const isIndented = stripped.length > 0 && (stripped[0] === ' ' || stripped[0] === '\t');

    if (!isIndented) {
      if (current !== null) result.push(current);
      current = trimmed;
    } else {
      if (current !== null) {
        current += ' ' + trimmed;
      } else {
        current = trimmed;
      }
    }
  }
  if (current !== null) result.push(current);
  return result.join('\n');
}

function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
    }
    if (!inQuote && line[i] === '-' && i + 1 < line.length && line[i + 1] === '-') {
      return line.slice(0, i);
    }
  }
  return line;
}
// @lex-join-logical-lines-end

// @lex-find-rule-colon
function findRuleColon(line: string): number {
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;

    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }

    if (ch === ':' && depth === 0) {
      const before = line.slice(0, i).trim();
      if (before.length > 0 && isValidRuleName(before)) {
        return i;
      }
    }
  }
  return -1;
}

function isValidRuleName(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
          (ch >= '0' && ch <= '9') || ch === ' ' || ch === '-')) {
      return false;
    }
  }
  return name.length > 0;
}
// @lex-find-rule-colon-end

// @lex-expression
function lexExpression(text: string, lineNum: number, _colOffset: number): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function skipWS() {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++;
  }

  function col(): number {
    return pos + 1;
  }

  while (pos < text.length) {
    skipWS();
    if (pos >= text.length) break;

    const startCol = col();

    if (text[pos] === '(') {
      pos++;
      tokens.push({ type: TokenType.OpenParenSyntax, value: '(', line: lineNum, column: startCol });
      continue;
    }

    if (text[pos] === ')') {
      pos++;
      tokens.push({ type: TokenType.CloseParenSyntax, value: ')', line: lineNum, column: startCol });
      continue;
    }

    if (text[pos] === ',') {
      pos++;
      tokens.push({ type: TokenType.CommaSyntax, value: ',', line: lineNum, column: startCol });
      continue;
    }

    if (text[pos] === '"') {
      const lit = lexQuotedLiteral(text, pos, lineNum);
      tokens.push(lit.token);
      pos = lit.endPos;
      continue;
    }

    if (isDigit(text[pos])) {
      const num = lexNumber(text, pos, lineNum);
      tokens.push(num.token);
      pos = num.endPos;
      continue;
    }

    if (isWordChar(text[pos])) {
      const result = lexWords(text, pos, lineNum);
      tokens.push(...result.tokens);
      pos = result.endPos;
      continue;
    }

    throw new ParseError(`Unexpected character '${text[pos]}'`, lineNum, startCol);
  }

  return tokens;
}
// @lex-expression-end

// @lex-quoted-literal
function lexQuotedLiteral(text: string, startPos: number, lineNum: number): { token: Token; endPos: number } {
  let pos = startPos + 1;
  if (pos >= text.length || text[pos] === '"') {
    throw new ParseError('Empty quoted string', lineNum, startPos + 1);
  }
  const contentStart = pos;
  while (pos < text.length && text[pos] !== '"') pos++;
  if (pos >= text.length) {
    throw new ParseError('Unterminated quoted string, missing closing "', lineNum, startPos + 1);
  }
  const content = text.slice(contentStart, pos);
  pos++;
  if (content.length === 1) {
    return {
      token: { type: TokenType.QuotedLiteral, value: content, line: lineNum, column: startPos + 1 },
      endPos: pos,
    };
  }
  return {
    token: { type: TokenType.Begin, value: content, line: lineNum, column: startPos + 1 },
    endPos: pos,
  };
}
// @lex-quoted-literal-end

// @lex-number
function lexNumber(text: string, startPos: number, lineNum: number): { token: Token; endPos: number } {
  let pos = startPos;
  while (pos < text.length && isDigit(text[pos])) pos++;
  return {
    token: { type: TokenType.Number, value: text.slice(startPos, pos), line: lineNum, column: startPos + 1 },
    endPos: pos,
  };
}
// @lex-number-end

// @lex-words
function lexWords(text: string, startPos: number, lineNum: number): { tokens: Token[]; endPos: number } {
  const words: { word: string; start: number }[] = [];
  let pos = startPos;

  while (pos < text.length) {
    if (!isWordChar(text[pos])) break;
    const ws = pos;
    while (pos < text.length && isWordChar(text[pos])) pos++;
    let word = text.slice(ws, pos);
    if (word === 'isn' && pos < text.length - 1 && text[pos] === "'" && text[pos + 1] === 't') {
      pos += 2;
      word = "isn't";
    }
    words.push({ word, start: ws });

    if (pos < text.length && text[pos] === ' ') {
      const savedPos = pos;
      pos++;
      while (pos < text.length && text[pos] === ' ') pos++;
      if (pos < text.length && isWordChar(text[pos])) {
        continue;
      } else {
        pos = savedPos;
        break;
      }
    } else {
      break;
    }
  }

  const result: Token[] = [];
  let wi = 0;

  while (wi < words.length) {
    let matched = false;

    if (words[wi].word === 'byte' && wi + 1 < words.length && /^0x[0-9a-fA-F]{2}$/.test(words[wi + 1].word)) {
      result.push({
        type: TokenType.ByteLiteral,
        value: words[wi + 1].word,
        line: lineNum,
        column: words[wi].start + 1,
      });
      wi += 2;
      matched = true;
    }

    if (!matched) {
      for (const [pattern, tokenType] of MULTI_WORD_KEYWORDS) {
        if (wi + pattern.length <= words.length) {
          let m = true;
          for (let k = 0; k < pattern.length; k++) {
            if (words[wi + k].word !== pattern[k]) { m = false; break; }
          }
          if (m) {
            const raw = pattern.join(' ');
            result.push({
              type: tokenType,
              value: PLURAL_TO_SINGULAR[raw] || raw,
              line: lineNum,
              column: words[wi].start + 1,
            });
            wi += pattern.length;
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      const w = words[wi].word;
      if (/^\d+$/.test(w)) {
        result.push({ type: TokenType.Number, value: w, line: lineNum, column: words[wi].start + 1 });
      } else {
        const singleType = SINGLE_WORD_KEYWORDS[w];
        if (singleType !== undefined) {
          result.push({ type: singleType, value: PLURAL_TO_SINGULAR[w] || w, line: lineNum, column: words[wi].start + 1 });
        } else {
          result.push({ type: TokenType.Identifier, value: w, line: lineNum, column: words[wi].start + 1 });
        }
      }
      wi++;
    }
  }

  return { tokens: result, endPos: pos };
}
// @lex-words-end

// @lex-helpers
function isWordChar(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
         (ch >= '0' && ch <= '9') || ch === '-' || ch === '_';
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
// @lex-helpers-end
