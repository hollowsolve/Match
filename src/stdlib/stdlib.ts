// @stdlib-named-chars
export const NAMED_CHARS: Record<string, number> = {
  'exclamation': 0x21,
  'double quote': 0x22,
  'hash': 0x23,
  'dollar': 0x24,
  'percent': 0x25,
  'ampersand': 0x26,
  'single quote': 0x27,
  'open paren': 0x28,
  'close paren': 0x29,
  'asterisk': 0x2A,
  'plus': 0x2B,
  'comma': 0x2C,
  'hyphen': 0x2D,
  'period': 0x2E,
  'slash': 0x2F,
  'colon': 0x3A,
  'semicolon': 0x3B,
  'less than': 0x3C,
  'equals': 0x3D,
  'greater than': 0x3E,
  'question': 0x3F,
  'at': 0x40,
  'open bracket': 0x5B,
  'backslash': 0x5C,
  'close bracket': 0x5D,
  'caret': 0x5E,
  'underscore': 0x5F,
  'backtick': 0x60,
  'open brace': 0x7B,
  'pipe': 0x7C,
  'close brace': 0x7D,
  'tilde': 0x7E,
  'space': 0x20,
  'tab': 0x09,
  'newline': 0x0A,
  'carriage return': 0x0D,
  'null': 0x00,
  'dot': 0x2E,
  'dash': 0x2D,
  'bang': 0x21,
};
// @stdlib-named-chars-end

// @stdlib-char-classes
export const CHAR_CLASSES: Record<string, (byte: number) => boolean> = {
  'letter': (b) => (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A),
  'digit': (b) => b >= 0x30 && b <= 0x39,
  'hex digit': (b) =>
    (b >= 0x30 && b <= 0x39) ||
    (b >= 0x41 && b <= 0x46) ||
    (b >= 0x61 && b <= 0x66),
  'whitespace': (b) => b === 0x20 || b === 0x09 || b === 0x0A || b === 0x0D,
  'visible': (b) => b >= 0x21 && b <= 0x7E,
  'printable': (b) => b >= 0x20 && b <= 0x7E,
  'alphanumeric': (b) =>
    (b >= 0x41 && b <= 0x5A) ||
    (b >= 0x61 && b <= 0x7A) ||
    (b >= 0x30 && b <= 0x39),
  'word character': (b) =>
    (b >= 0x41 && b <= 0x5A) ||
    (b >= 0x61 && b <= 0x7A) ||
    (b >= 0x30 && b <= 0x39) ||
    b === 0x5F,
  'any character': (_b) => true,
  'uppercase': (b) => b >= 0x41 && b <= 0x5A,
  'lowercase': (b) => b >= 0x61 && b <= 0x7A,
};

export const CLASS_NAMES = new Set(Object.keys(CHAR_CLASSES));
export const NAMED_CHAR_NAMES = new Set(Object.keys(NAMED_CHARS));
// @stdlib-char-classes-end

// @stdlib-keywords
export const KEYWORDS = new Set([
  'then', 'or', 'any of', 'none of', 'except',
  'one or more', 'zero or more', 'optional',
  'joined by', 'to', 'begin', 'end', 'until',
  "isn't", 'isnt', 'extract',
  'exactly', 'between', 'and',
  'any character', 'letter', 'digit', 'hex digit',
  'whitespace', 'visible', 'printable',
  'alphanumeric', 'word character',
  'null', 'byte', 'space', 'tab', 'newline', 'carriage return',
  ...Object.keys(NAMED_CHARS),
]);
// @stdlib-keywords-end

// @stdlib-describe-byte
export function describeByte(byte: number): string {
  if (byte >= 0x20 && byte <= 0x7E) {
    return `"${String.fromCharCode(byte)}" (0x${byte.toString(16).toUpperCase().padStart(2, '0')})`;
  }
  for (const [name, val] of Object.entries(NAMED_CHARS)) {
    if (val === byte) return name;
  }
  return `byte 0x${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}
// @stdlib-describe-byte-end
