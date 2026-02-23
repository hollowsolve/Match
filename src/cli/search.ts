#!/usr/bin/env node

import { parse } from '../index.js';
import {
  searchFolder,
  searchStream,
  searchFileStream,
  formatSearchResults,
  LineMatch,
} from '../search/search.js';
import { Readable } from 'stream';

function usage(): string {
  return [
    'usage: match-search <pattern> in file <path> [lines <start> to <end>]',
    '       match-search <pattern> in folder <path> [--glob <pattern>]',
    '       <command> | match-search <pattern>',
    '',
    'options:',
    '  --glob <pattern>    filter files by glob (e.g. "*.log", "*.ts")',
    '  --no-color          disable colored output',
    '  -h, --help          show this help',
    '',
    'examples:',
    '  match-search "error: digit one or more" in file server.log',
    '  match-search "error: digit one or more" in folder ./logs',
    '  match-search "error: digit one or more" in folder ./logs --glob "*.log"',
    '  match-search "error: digit one or more" in file file.md lines 10 to 50',
    '  cat server.log | match-search "\"error\" then colon then space then digit one or more"',
  ].join('\n');
}

interface ParsedArgs {
  pattern: string;
  mode: 'file' | 'folder' | 'stdin';
  path?: string;
  startLine?: number;
  endLine?: number;
  glob?: string;
  color: boolean;
}

function parseArgs(args: string[]): ParsedArgs | null {
  let color = true;
  let glob: string | undefined;

  if (process.env['NO_COLOR'] !== undefined) color = false;
  if (!process.stdout.isTTY) color = false;

  const filtered: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-color') {
      color = false;
    } else if (args[i] === '--glob' && i + 1 < args.length) {
      glob = args[++i];
    } else {
      filtered.push(args[i]);
    }
  }

  if (filtered.length === 1) {
    return { pattern: filtered[0], mode: 'stdin', color, glob };
  }

  if (filtered.length < 4) return null;

  const pattern = filtered[0];
  if (filtered[1] !== 'in') return null;

  const mode = filtered[2];
  if (mode !== 'file' && mode !== 'folder') return null;

  const targetPath = filtered[3];

  let startLine: number | undefined;
  let endLine: number | undefined;

  if (filtered.length > 4) {
    if (mode === 'file' && filtered[4] === 'lines' && filtered.length >= 7 && filtered[6] === 'to') {
      startLine = parseInt(filtered[5], 10);
      endLine = parseInt(filtered[7], 10);
      if (isNaN(startLine) || isNaN(endLine)) return null;
    } else {
      return null;
    }
  }

  return { pattern, mode, path: targetPath, startLine, endLine, color, glob };
}

function formatLine(match: LineMatch, color: boolean): string {
  const content = color
    ? highlightLine(match.content, match.matches)
    : match.content;
  return `${match.file}:${match.line}: ${content}`;
}

function highlightLine(content: string, matches: { start: number; end: number }[]): string {
  if (matches.length === 0) return content;
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.start > cursor) result += content.slice(cursor, m.start);
    result += `\x1b[1;31m${content.slice(m.start, m.end)}\x1b[0m`;
    cursor = m.end;
  }
  if (cursor < content.length) result += content.slice(cursor);
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(usage());
    process.exit(0);
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    console.error(usage());
    process.exit(1);
  }

  let program;
  try {
    program = parse(parsed.pattern);
  } catch (e: any) {
    console.error(`pattern error: ${e.message}`);
    process.exit(1);
  }

  let found = false;

  if (parsed.mode === 'stdin') {
    for await (const match of searchStream(program, process.stdin as Readable, {
      startLine: parsed.startLine,
      endLine: parsed.endLine,
    })) {
      found = true;
      console.log(formatLine(match, parsed.color));
    }
  } else if (parsed.mode === 'file') {
    for await (const match of searchFileStream(program, parsed.path!, {
      startLine: parsed.startLine,
      endLine: parsed.endLine,
    })) {
      found = true;
      console.log(formatLine(match, parsed.color));
    }
  } else {
    const result = searchFolder(program, parsed.path!, { glob: parsed.glob });
    for (const err of result.errors) {
      console.error(`warning: ${err.file}: ${err.error}`);
    }
    const output = formatSearchResults(result.matches, { color: parsed.color });
    if (result.matches.length > 0) {
      found = true;
      console.log(output);
    }
  }

  if (!found) {
    console.log('no matches found');
  }

  process.exit(found ? 0 : 1);
}

main();
