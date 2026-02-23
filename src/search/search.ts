import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Readable } from 'stream';
import { find, FindMatch } from '../executor/executor.js';
import { MatchProgram } from '../types/ast.js';

export interface LineMatch {
  file: string;
  line: number;
  content: string;
  matches: FindMatch[];
}

export interface SearchError {
  file: string;
  error: string;
}

export interface SearchResult {
  matches: LineMatch[];
  errors: SearchError[];
}

export interface SearchOptions {
  startLine?: number;
  endLine?: number;
  glob?: string;
  color?: boolean;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '__pycache__',
  'coverage', '.output', '.turbo',
]);

const NULL_BYTE = 0x00;
const BINARY_CHECK_BYTES = 8192;

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_CHECK_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === NULL_BYTE) return true;
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '.') {
      re += '\\.';
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const name = path.basename(filePath);
  const regex = globToRegex(pattern);
  return regex.test(name);
}

export function searchString(
  program: MatchProgram,
  text: string,
  label: string = '<stdin>',
  options: SearchOptions = {}
): LineMatch[] {
  const lines = text.split('\n');
  const results: LineMatch[] = [];

  const start = options.startLine ? options.startLine - 1 : 0;
  const end = options.endLine ? Math.min(options.endLine, lines.length) : lines.length;

  for (let i = start; i < end; i++) {
    const lineText = lines[i];
    const matches = find(program, lineText);
    if (matches.length > 0) {
      results.push({
        file: label,
        line: i + 1,
        content: lineText,
        matches,
      });
    }
  }

  return results;
}

export function searchFile(
  program: MatchProgram,
  filePath: string,
  options: SearchOptions = {}
): SearchResult {
  const resolved = path.resolve(filePath);

  try {
    const buf = fs.readFileSync(resolved);
    if (isBinaryBuffer(buf)) {
      return { matches: [], errors: [] };
    }
    const text = buf.toString('utf-8');
    const matches = searchString(program, text, resolved, options);
    return { matches, errors: [] };
  } catch (e: any) {
    return {
      matches: [],
      errors: [{ file: resolved, error: e.message || String(e) }],
    };
  }
}

export function searchFolder(
  program: MatchProgram,
  folderPath: string,
  options: SearchOptions = {}
): SearchResult {
  const resolved = path.resolve(folderPath);
  const allMatches: LineMatch[] = [];
  const allErrors: SearchError[] = [];

  walkDir(resolved, new Set(), (filePath) => {
    if (options.glob && !matchesGlob(filePath, options.glob)) return;
    const result = searchFile(program, filePath);
    allMatches.push(...result.matches);
    allErrors.push(...result.errors);
  });

  return { matches: allMatches, errors: allErrors };
}

export interface StreamSearchOptions {
  startLine?: number;
  endLine?: number;
}

// @search-stream
export async function* searchStream(
  program: MatchProgram,
  stream: Readable,
  options: StreamSearchOptions & { label?: string } = {}
): AsyncGenerator<LineMatch> {
  const label = options.label ?? '<stream>';
  const start = options.startLine ? options.startLine : 1;
  const end = options.endLine ?? Infinity;

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNum = 0;

  for await (const lineText of rl) {
    lineNum++;
    if (lineNum < start) continue;
    if (lineNum > end) break;

    const matches = find(program, lineText);
    if (matches.length > 0) {
      yield { file: label, line: lineNum, content: lineText, matches };
    }
  }
}
// @search-stream-end

// @search-file-stream
export async function* searchFileStream(
  program: MatchProgram,
  filePath: string,
  options: StreamSearchOptions = {}
): AsyncGenerator<LineMatch> {
  const resolved = path.resolve(filePath);

  const fd = await fs.promises.open(resolved, 'r');
  try {
    const header = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fd.read(header, 0, BINARY_CHECK_BYTES, 0);
    if (isBinaryBuffer(header.subarray(0, bytesRead))) return;
  } finally {
    await fd.close();
  }

  const stream = fs.createReadStream(resolved, { encoding: 'utf-8' });
  yield* searchStream(program, stream, { ...options, label: resolved });
}
// @search-file-stream-end

function walkDir(
  dir: string,
  seen: Set<string>,
  callback: (filePath: string) => void
): void {
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return;
  }

  if (seen.has(realDir)) return;
  seen.add(realDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
      }

      walkDir(fullPath, seen, callback);
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

export function formatSearchResults(
  results: LineMatch[],
  options: { color?: boolean } = {}
): string {
  if (results.length === 0) return 'no matches found';

  const useColor = options.color ?? true;
  const lines: string[] = [];
  for (const result of results) {
    const highlighted = useColor
      ? highlightLine(result.content, result.matches)
      : result.content;
    lines.push(`${result.file}:${result.line}: ${highlighted}`);
  }
  return lines.join('\n');
}

function highlightLine(content: string, matches: FindMatch[]): string {
  if (matches.length === 0) return content;

  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const m of sorted) {
    if (m.start > cursor) {
      result += content.slice(cursor, m.start);
    }
    result += `\x1b[1;31m${content.slice(m.start, m.end)}\x1b[0m`;
    cursor = m.end;
  }

  if (cursor < content.length) {
    result += content.slice(cursor);
  }

  return result;
}
