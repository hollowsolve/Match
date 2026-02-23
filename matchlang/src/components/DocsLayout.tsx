import { useEffect, useState } from 'react'
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

interface DocSection {
  title: string
  slug: string
  children?: { title: string; slug: string }[]
}

const SECTIONS: DocSection[] = [
  {
    title: 'Getting Started',
    slug: 'getting-started',
    children: [
      { title: 'Installation', slug: 'installation' },
      { title: 'Your First Grammar', slug: 'first-grammar' },
    ],
  },
  {
    title: 'Language',
    slug: 'language',
    children: [
      { title: 'Rules', slug: 'rules' },
      { title: 'Characters', slug: 'characters' },
      { title: 'Character Classes', slug: 'classes' },
      { title: 'Text Blocks', slug: 'text-blocks' },
      { title: 'Sequences & Alternation', slug: 'sequences' },
      { title: 'Repetition', slug: 'repetition' },
      { title: 'Sets', slug: 'sets' },
      { title: 'Negation', slug: 'negation' },
      { title: 'Until', slug: 'until' },
      { title: 'Extract', slug: 'extract' },
      { title: 'Joined By', slug: 'joined-by' },
      { title: 'Precedence', slug: 'precedence' },
      { title: 'Comments', slug: 'comments' },
      { title: 'Unicode & Bytes', slug: 'unicode' },
    ],
  },
  {
    title: 'API',
    slug: 'api',
    children: [
      { title: 'run', slug: 'run' },
      { title: 'parse & match', slug: 'parse-match' },
      { title: 'find', slug: 'find' },
      { title: 'tryParse', slug: 'try-parse' },
      { title: 'Search', slug: 'search' },
      { title: 'Diagnostics', slug: 'diagnostics' },
      { title: 'Types', slug: 'types' },
      { title: 'Dynamic Grammars', slug: 'dynamic-grammars' },
    ],
  },
  {
    title: 'Examples',
    slug: 'examples',
    children: [
      { title: 'Key-Value Parser', slug: 'key-value' },
      { title: 'CSV Parser', slug: 'csv' },
      { title: 'Email Extractor', slug: 'email' },
      { title: 'JSON Subset', slug: 'json' },
      { title: 'RFC 7239 Forwarded', slug: 'rfc7239' },
      { title: 'Log Search', slug: 'log-search' },
    ],
  },
  {
    title: 'CLI',
    slug: 'cli',
  },
]

function Sidebar() {
  const location = useLocation()

  return (
    <nav style={{
      width: 240,
      minWidth: 240,
      padding: '72px 0 48px 0',
      borderRight: '1px solid var(--t-border)',
      height: '100vh',
      position: 'sticky',
      top: 0,
      overflowY: 'auto',
      fontSize: 13,
    }}>
      {SECTIONS.map((section) => (
        <div key={section.slug} style={{ marginBottom: 24 }}>
          {section.children ? (
            <div style={{
              padding: '6px 24px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--t-text-muted)',
              fontFamily: 'var(--t-mono)',
            }}>
              {section.title}
            </div>
          ) : (
            <Link
              to={`/docs/${section.slug}`}
              style={{
                display: 'block',
                padding: '6px 24px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: location.pathname === `/docs/${section.slug}` ? 'var(--t-text)' : 'var(--t-text-muted)',
                fontFamily: 'var(--t-mono)',
                textDecoration: 'none',
                transition: 'color 0.2s',
              }}
            >
              {section.title}
            </Link>
          )}
          {section.children?.map((child) => {
            const path = `/docs/${section.slug}/${child.slug}`
            const active = location.pathname === path
            return (
              <Link
                key={child.slug}
                to={path}
                style={{
                  display: 'block',
                  padding: '5px 24px 5px 32px',
                  color: active ? 'var(--t-text)' : 'var(--t-text-muted)',
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                  borderLeft: active ? '2px solid var(--t-accent)' : '2px solid transparent',
                }}
              >
                {child.title}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function DocPage({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="doc-content"
      style={{
        flex: 1,
        padding: '96px 48px 96px 48px',
        maxWidth: 780,
        lineHeight: 1.8,
        fontSize: 15,
        color: 'var(--t-text)',
      }}
    >
      {children}
    </motion.div>
  )
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 8, color: 'var(--t-text)' }}>{children}</h1>
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 48, marginBottom: 12, color: 'var(--t-text)' }}>{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ marginBottom: 16, color: 'var(--t-text)', opacity: 0.85 }}>{children}</p>
}

function Code({ children }: { children: string }) {
  return (
    <code style={{
      fontFamily: 'var(--t-mono)',
      fontSize: '0.88em',
      padding: '2px 6px',
      borderRadius: 4,
      background: 'var(--t-code-bg)',
      color: 'var(--t-code-text)',
    }}>{children}</code>
  )
}

function Pre({ children, label, icon }: { children: string; label?: string; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div
      onClick={handleCopy}
      style={{
        marginBottom: 20,
        borderRadius: 10,
        border: '1px solid var(--t-border)',
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
    >
      {label && (
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--t-border)',
          fontSize: 10,
          color: 'var(--t-text-muted)',
          fontWeight: 500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontFamily: 'var(--t-mono)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>{icon}{label}</div>
      )}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--t-code-bg)' }}>
        <pre style={{
          padding: 16,
          margin: 0,
          fontSize: 13,
          lineHeight: 1.7,
          fontFamily: 'var(--t-mono)',
          color: 'var(--t-code-text)',
          background: 'var(--t-code-bg)',
          overflowX: 'auto',
          opacity: copied ? 0 : 1,
          transition: 'opacity 0.1s',
        }}>{children}</pre>
        <AnimatePresence>
          {copied && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--t-code-bg)',
              }}
            >
              <motion.span
                style={{ display: 'flex', alignItems: 'center', gap: 0, color: 'var(--t-success)', fontFamily: 'var(--t-mono)', fontSize: 13 }}
              >
                <motion.svg
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <circle className="copied-circle" cx="8" cy="8" r="7" stroke="var(--t-success)" strokeWidth="1.5" fill="none" />
                  <path className="copied-check" d="M5 8l2 2 4-4" stroke="var(--t-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </motion.svg>
                <motion.span
                  initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                  animate={{ width: 'auto', opacity: 1, marginLeft: 8 }}
                  transition={{ duration: 0.3, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                  style={{ overflow: 'hidden', whiteSpace: 'nowrap', display: 'inline-block' }}
                >
                  Copied
                </motion.span>
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 8,
      border: '1px solid var(--t-border)',
      background: 'var(--t-code-bg)',
      fontSize: 13,
      color: 'var(--t-text-muted)',
      marginBottom: 20,
      lineHeight: 1.7,
    }}>
      {children}
    </div>
  )
}

function DocLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} style={{ color: 'var(--t-text)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>{children}</Link>
}

const TERMINAL_ICON = <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
const AGENT_ICON = <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="10" cy="6" r="1" fill="currentColor" /><path d="M5 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M8 10v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>

const AGENT_PROMPT = `Install @hollowsolve/match, then set up the Match skill:

1. npm install @hollowsolve/match
2. mkdir -p .match
3. curl -o .match/match_skill.md https://matchlang.com/match_skill.md
4. Create .match/grammars.md with this content:

# Project Grammars

> Match syntax reference is at .match/match_skill.md

Add reusable grammars for this project below.

---`

function Installation() {
  const [tab, setTab] = useState<'manual' | 'agent'>('manual')

  return (
    <DocPage>
      <H1>Installation</H1>
      <P>Match is available on npm. Node 18+ required. Both ESM and CommonJS are supported.</P>

      <div style={{
        display: 'inline-flex', borderRadius: 8,
        border: '1px solid var(--t-border)', overflow: 'hidden',
        marginBottom: 20,
      }}>
        {([
          { key: 'manual' as const, label: 'Manual Install', icon: TERMINAL_ICON },
          { key: 'agent' as const, label: 'AI Agent', icon: AGENT_ICON },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              textTransform: 'uppercase', fontFamily: 'var(--t-mono)',
              border: 'none', cursor: 'pointer',
              background: tab === t.key ? 'var(--t-accent)' : 'transparent',
              color: tab === t.key ? 'var(--t-bg)' : 'var(--t-text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
              borderRight: t.key === 'manual' ? '1px solid var(--t-border)' : 'none',
            }}
          >{t.icon}{t.label}</button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'manual' ? (
          <motion.div
            key="manual"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <Pre label="terminal" icon={TERMINAL_ICON}>npm install @hollowsolve/match</Pre>

            <H2>Import</H2>
            <P>Once installed, import the <Code>run</Code> function. It takes a grammar string and an input string, and returns a result object with the parse tree or a diagnostic failure.</P>
            <Pre label="esm">{`import { run } from '@hollowsolve/match'`}</Pre>
            <Pre label="commonjs">{`const { run } = require('@hollowsolve/match')`}</Pre>
            <P>Zero dependencies. The entire library is a single TypeScript compilation with no runtime deps.</P>
          </motion.div>
        ) : (
          <motion.div
            key="agent"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <P>Paste this into your AI coding agent (Claude Code, Cursor, Windsurf, etc.).</P>
            <Pre label="paste into agent" icon={AGENT_ICON}>{AGENT_PROMPT}</Pre>
            <P>This creates a <Code>.match/</Code> folder in your project with:</P>
            <ul style={{ paddingLeft: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li style={{ fontSize: 14, color: 'var(--t-text-muted)', lineHeight: 1.7 }}>
                <Code>match_skill.md</Code> — full syntax reference so the agent can write grammars
              </li>
              <li style={{ fontSize: 14, color: 'var(--t-text-muted)', lineHeight: 1.7 }}>
                <Code>grammars.md</Code> — your project's reusable grammars, built up over time
              </li>
            </ul>
            <P style={{ fontSize: 12, opacity: 0.6 }}>Each file cross-references the other. The agent learns the syntax from the skill file and saves grammars it writes to the grammars file for reuse.</P>
          </motion.div>
        )}
      </AnimatePresence>
    </DocPage>
  )
}


function FirstGrammar() {
  return (
    <DocPage>
      <H1>Your First Grammar</H1>
      <P>Let's build a date parser step by step — the kind of thing you'd normally reach for a regex for.</P>

      <H2>Start with a single rule</H2>
      <P>A rule gives a name to a pattern. The simplest grammar has one rule:</P>
      <Pre label="grammar">{`year: 4 digits`}</Pre>
      <P>This matches exactly 4 digits. <Code>digit</Code> is a built-in character class. <Code>4</Code> is a repetition count.</P>
      <Pre label="app.ts">{`import { run } from '@hollowsolve/match'

run('year: 4 digits', '2025')  // matched
run('year: 4 digits', '25')    // failed — expected: digit`}</Pre>

      <H2>Compose rules</H2>
      <P>Rules reference other rules. This is how you build complex parsers from simple pieces:</P>
      <Pre label="grammar">{`year: 4 digits
month: 2 digits
day: 2 digits
date: year then hyphen then month then hyphen then day`}</Pre>
      <P><Code>then</Code> sequences two patterns. <Code>hyphen</Code> is a named character (the <Code>-</Code> character).</P>
      <P>The last rule (<Code>date</Code>) is automatically the entry point.</P>

      <H2>Read the parse tree</H2>
      <Pre label="app.ts">{`import { run, formatTree } from '@hollowsolve/match'

const grammar = \`
year: 4 digits
month: 2 digits
day: 2 digits
date: year then hyphen then month then hyphen then day
\`

const result = run(grammar, '2025-01-15')
console.log(formatTree(result.tree))
// date [0..10]
// ├── year [0..4] "2025"
// ├── month [5..7] "01"
// └── day [8..10] "15"`}</Pre>
      <P>Every rule that matches produces a node in the tree with its name, byte offsets, matched text, and children.</P>

      <H2>Handle failures</H2>
      <Pre label="app.ts">{`import { run, formatFailure } from '@hollowsolve/match'

const result = run(grammar, '2025-1-15')
console.log(formatFailure(result))
// match failed at byte 6 (line 1, column 7):
//   expected: digit
//   found: "-" (0x2D)
//   in: date > month`}</Pre>
      <P>Byte offset, line/column, expected set, found character, and the full rule stack. No guessing.</P>

      <H2>Next steps</H2>
      <P>Now that you know the basics, explore the <DocLink to="/docs/language/rules">language reference</DocLink> to see all the patterns you can write, or jump to <DocLink to="/docs/examples/key-value">examples</DocLink> to see complete parsers.</P>
    </DocPage>
  )
}

function RulesDoc() {
  return (
    <DocPage>
      <H1>Rules</H1>
      <P>Rules name patterns. A grammar is a set of rules.</P>
      <Pre label="grammar">{`field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline`}</Pre>

      <H2>Entry point</H2>
      <P>The last rule in the grammar is the entry point. When you call <Code>run(grammar, input)</Code>, it starts matching from the last rule.</P>

      <H2>Rule names</H2>
      <P>Rule names can be single words or multi-word: <Code>token</Code>, <Code>token char</Code>, <Code>quoted value</Code>, <Code>hex pair</Code>. Names can contain letters, digits, spaces, and hyphens.</P>

      <H2>Rule references</H2>
      <P>Rules reference other rules by name. This is how you compose parsers:</P>
      <Pre label="grammar">{`digit pair: digit then digit
main: digit pair then hyphen then digit pair`}</Pre>

      <H2>Left recursion</H2>
      <P>Left recursion is detected at compile time and rejected with a diagnostic.</P>

      <H2>Continuation lines</H2>
      <P>Indent continuation lines to keep long rules readable:</P>
      <Pre label="grammar">{`token char:
  any of (
    exclamation, hash, dollar, percent,
    ampersand, asterisk, plus, period,
    "0" to "9", "a" to "z", "A" to "Z"
  )`}</Pre>
      <P>Indented lines are joined to the previous line as a single rule body.</P>
    </DocPage>
  )
}

function CharactersDoc() {
  return (
    <DocPage>
      <H1>Characters</H1>
      <P>Every character has a name. No escape sequences exist in the language.</P>

      <H2>Named characters</H2>
      <P>Symbols have readable names:</P>
      <Pre label="grammar">{`exclamation   -- !
double quote  -- "
hash          -- #
dollar        -- $
percent       -- %
ampersand     -- &
single quote  -- '
open paren    -- (
close paren   -- )
asterisk      -- *
plus          -- +
comma         -- ,
hyphen        -- -    (alias: dash)
period        -- .    (alias: dot)
slash         -- /
colon         -- :
semicolon     -- ;
less than     -- <
equals        -- =
greater than  -- >
question      -- ?
at            -- @
open bracket  -- [
backslash     -- \\
close bracket -- ]
caret         -- ^
underscore    -- _
backtick      -- \`
open brace    -- {
pipe          -- |
close brace   -- }
tilde         -- ~`}</Pre>

      <H2>Whitespace</H2>
      <Pre label="grammar">{`space            -- 0x20
tab              -- 0x09
newline          -- 0x0A (line feed)
carriage return  -- 0x0D`}</Pre>

      <H2>Other</H2>
      <Pre label="grammar">{`null             -- 0x00
byte 0xHH        -- any specific byte value`}</Pre>

      <H2>Quoted characters</H2>
      <P>Single printable characters can be quoted with double quotes:</P>
      <Pre label="grammar">{`"a"  "Z"  "7"  "+"  "/"`}</Pre>
      <P>Quoted characters are used for ranges: <Code>{'"a" to "z"'}</Code>, <Code>{'"0" to "9"'}</Code>.</P>
      <Note>Quoted literals can be single or multi-character. Single-character quotes enable ranges (<Code>{`"a" to "z"`}</Code>). Multi-character quotes match literal strings.</Note>
    </DocPage>
  )
}

function ClassesDoc() {
  return (
    <DocPage>
      <H1>Character Classes</H1>
      <P>Built-in character classes match common byte categories.</P>

      <Pre label="reference">{`letter         -- a-z, A-Z
uppercase      -- A-Z
lowercase      -- a-z
digit          -- 0-9
hex digit      -- 0-9, a-f, A-F
whitespace     -- space, tab, newline, carriage return
visible        -- 0x21-0x7E (printable, no space)
printable      -- 0x20-0x7E (visible + space)
alphanumeric   -- letter or digit
word character  -- letter, digit, or underscore
any character  -- any single UTF-8 codepoint`}</Pre>

      <P>All classes except <Code>any character</Code> match ASCII bytes only.</P>

      <H2>Usage</H2>
      <Pre label="grammar">{`identifier: letter then zero or more (letter or digit or underscore)
hex color: hash then 6 hex digits
trimmed: zero or more whitespace then one or more visible`}</Pre>
    </DocPage>
  )
}

function TextBlocksDoc() {
  return (
    <DocPage>
      <H1>Text Blocks</H1>
      <P>Quoted strings match literal multi-character sequences:</P>
      <Pre label="grammar">{`"hello world"
"http://"
"SELECT * FROM"
"--"`}</Pre>
      <P>Everything inside the quotes is matched literally, byte for byte.</P>

      <H2>Single vs multi-character</H2>
      <P>Quotes work for both single and multi-character strings. For single characters, named characters are also available and enable ranges.</P>
      <Pre label="grammar">{`-- single char: named or quoted
main: hash then digit
main: "#" then digit

-- multi-char: use quotes
main: "##" then digit`}</Pre>

      <H2>Strings containing quotes</H2>
      <P>Match has no escape sequences by design. To match a string that contains a literal double quote, use the <Code>double quote</Code> named character and sequence it with <Code>then</Code>:</P>
      <Pre label="grammar">{`-- matches: "hello"
main: double quote then "hello" then double quote

-- matches: she said "hi"
main: "she said " then double quote then "hi" then double quote

-- matches: "price: "10.99""
main: double quote then "price: " then double quote then "10.99" then double quote then double quote`}</Pre>
      <P>This is intentional. Rather than introducing escape sequences and the complexity they bring, Match treats <Code>double quote</Code> as a composable building block like any other character.</P>
    </DocPage>
  )
}

function SequencesDoc() {
  return (
    <DocPage>
      <H1>Sequences & Alternation</H1>

      <H2>Sequences with <Code>then</Code></H2>
      <P><Code>then</Code> sequences two patterns. The input must match both, in order:</P>
      <Pre label="grammar">{`pair: key then equals then value`}</Pre>
      <P>A comma can also be used as shorthand for <Code>then</Code>:</P>
      <Pre label="grammar">{`pair: key, equals, value`}</Pre>
      <P><Code>then</Code> is preferred for clarity, but commas work well for brevity in longer sequences. Note: commas inside parentheses (like <Code>any of (a, b, c)</Code>) are set separators, not sequence operators.</P>

      <H2>Alternation with <Code>or</Code></H2>
      <P><Code>or</Code> tries each option in order. The first match wins (PEG ordered choice):</P>
      <Pre label="grammar">{`value: token or quoted value`}</Pre>
      <P>This is not ambiguous backtracking. Once an option matches, the others are never tried. If the first option fails, the second is tried at the same position.</P>

      <H2>Order matters</H2>
      <P>If you're coming from regex, this is the biggest gotcha. Regex alternation (<Code>|</Code>) finds the longest match. Match's <Code>or</Code> takes the first option that succeeds, even if a later option would match more:</P>
      <Pre label="grammar">{`-- BAD: "if" matches first, so "ifstream" is parsed as "if" + leftover "stream"
keyword: "if" or "ifstream"

-- GOOD: put the longer option first
keyword: "ifstream" or "if"`}</Pre>
      <P>Rule of thumb: when alternatives share a prefix, put the longer one first.</P>

      <H2>Combined</H2>
      <Pre label="grammar">{`-- "then" binds tighter than "or"
-- so this means: (a then b) or (c then d)
main: a then b or c then d`}</Pre>
      <P>See <DocLink to="/docs/language/precedence">precedence</DocLink> for the full binding order.</P>
    </DocPage>
  )
}

function RepetitionDoc() {
  return (
    <DocPage>
      <H1>Repetition</H1>
      <P>Repetition modifiers are prefix — they come before the pattern they repeat.</P>

      <Pre label="grammar">{`one or more digits       -- 1+  (greedy)
zero or more letters     -- 0+  (greedy)
optional space           -- 0 or 1
4 digits                 -- exactly 4 times
between 2 and 10 letters -- 2 to 10 times (greedy)`}</Pre>

      <P>Repetition binds tighter than everything else. <Code>letter then one or more digits</Code> means <Code>{'letter then (one or more digits)'}</Code>, not <Code>{'(letter then one or more) digits'}</Code>.</P>

      <H2>Greedy matching</H2>
      <P>All repetition is greedy — it matches as much as possible. Since Match uses PEG semantics with ordered choice, there's no backtracking ambiguity.</P>

      <H2>Parenthesized repetition</H2>
      <P>To repeat a compound pattern, wrap it in parentheses:</P>
      <Pre label="grammar">{`one or more (letter then digit)   -- "a1b2c3"
zero or more (space or tab)       -- optional whitespace`}</Pre>
    </DocPage>
  )
}

function SetsDoc() {
  return (
    <DocPage>
      <H1>Sets</H1>

      <H2><Code>any of</Code></H2>
      <P>Matches one character from a set of alternatives:</P>
      <Pre label="grammar">{`any of (letter, digit, underscore)
any of ("a", "b", "c")
any of (printable except (double quote, backslash), tab)`}</Pre>

      <H2><Code>one or more of</Code> / <Code>zero or more of</Code></H2>
      <P>Shorthand for a quantified set:</P>
      <Pre label="grammar">{`one or more of (letter, digit)
one or more of (letter, digit, period, hyphen, underscore)
zero or more of (space, tab)`}</Pre>

      <H2><Code>none of</Code></H2>
      <P>Matches one character <em>not</em> in the set:</P>
      <Pre label="grammar">{`none of (double quote, newline)`}</Pre>
      <P><Code>none of</Code> always consumes exactly one character (one UTF-8 codepoint).</P>

      <H2><Code>characters except</Code></H2>
      <P>Quantified negated set — matches characters not in the set:</P>
      <Pre label="grammar">{`one or more characters except (comma, newline)
zero or more characters except ("x")`}</Pre>

      <H2><Code>except</Code></H2>
      <P>Narrows a class by excluding specific characters:</P>
      <Pre label="grammar">{`visible except (double quote, backslash)
printable except (less than, greater than)
letter except ("q")`}</Pre>
      <P><Code>except</Code> checks the exclusions first, then matches the base class.</P>

      <H2>Ranges</H2>
      <P>Quoted characters and byte literals support ranges with <Code>to</Code>:</P>
      <Pre label="grammar">{`"a" to "z"
"0" to "9"
byte 0x80 to byte 0xFF`}</Pre>
    </DocPage>
  )
}

function NegationDoc() {
  return (
    <DocPage>
      <H1>Negation</H1>
      <P><Code>isn't</Code> (or <Code>isnt</Code>) matches a pattern only if a different pattern does <em>not</em> match at the same position:</P>
      <Pre label="grammar">{`any character isn't newline
digit isn't "0"
one or more (printable isn't "--")`}</Pre>

      <H2>How it works</H2>
      <P><Code>A isn't B</Code> first tries <Code>B</Code>. If <Code>B</Code> matches, the whole expression fails. If <Code>B</Code> fails, <Code>A</Code> is tried.</P>

      <H2>vs <Code>none of</Code></H2>
      <P><Code>none of</Code> is a character-set negation — it matches one character not in a set. <Code>isn't</Code> is a pattern negation — it can negate multi-character patterns like text blocks or rule references.</P>
    </DocPage>
  )
}

function UntilDoc() {
  return (
    <DocPage>
      <H1>Until</H1>
      <P><Code>until</Code> consumes input until a terminator pattern is found.</P>

      <Pre label="grammar">{`any character until including newline
any character until excluding "END"
any character until including (digit then digit)
any character until excluding closing tag`}</Pre>

      <H2><Code>including</Code> vs <Code>excluding</Code></H2>
      <P><Code>including</Code> consumes the terminator. <Code>excluding</Code> stops just before it.</P>

      <H2>vs <Code>none of</Code></H2>
      <P>They look similar for single-character terminators: <Code>any character until excluding newline</Code> vs <Code>none of (newline) one or more</Code>. Use <Code>until</Code> when the terminator is multi-character or a pattern. Use <Code>none of</Code> for character-set negation.</P>
    </DocPage>
  )
}

function ExtractDoc() {
  return (
    <DocPage>
      <H1>Extract</H1>
      <P>Tag patterns with <Code>extract</Code> to pull matched text into <Code>result.extracted</Code>:</P>
      <Pre label="grammar">{`num: one or more digits
main: "value=" then extract num`}</Pre>
      <Pre label="app.ts">{`const result = run(grammar, 'value=42')
result.extracted[0].text  // "42"`}</Pre>

      <H2>Binding</H2>
      <P><Code>extract</Code> binds to a single atom (rule reference or parenthesized group):</P>
      <Pre label="grammar">{`extract digit                       -- ok
extract num                         -- ok
extract (one or more digits)        -- ok
extract one or more digits          -- ok`}</Pre>

      <H2>Collection order</H2>
      <P>Extracts are collected left-to-right in sequences, in iteration order in loops. Failed <Code>or</Code> branches contribute nothing — only the winning branch's extracts appear. Sub-rule extracts bubble up. <Code>extracted[0]</Code>, <Code>extracted[1]</Code> indexing is reliable.</P>
    </DocPage>
  )
}

function JoinedByDoc() {
  return (
    <DocPage>
      <H1>Joined By</H1>
      <P><Code>joined by</Code> matches a separated list:</P>
      <Pre label="grammar">{`field: one or more characters except (comma, newline)
row: field joined by comma`}</Pre>
      <P>This matches <Code>a,b,c</Code> — one or more <Code>field</Code> separated by <Code>comma</Code>.</P>

      <H2>Lenient mode</H2>
      <P>Add <Code>lenient</Code> to allow a trailing separator:</P>
      <Pre label="grammar">{`item: one or more letters
list: item joined by comma lenient`}</Pre>
      <P>This matches both <Code>a,b,c</Code> and <Code>a,b,c,</Code>.</P>

      <H2>Binding</H2>
      <P><Code>joined by</Code> binds between <Code>then</Code> and <Code>or</Code>. The element is a full sequence and the separator is also a full sequence:</P>
      <Pre label="grammar">{`-- element = "token then equals then value"
-- separator = "semicolon"
element: token then equals then value
params: element joined by semicolon`}</Pre>
    </DocPage>
  )
}

function PrecedenceDoc() {
  return (
    <DocPage>
      <H1>Precedence</H1>
      <P>From tightest to loosest binding:</P>
      <Pre label="reference">{`1. Repetition   — one or more, zero or more, optional, N times, between N and M
2. isn't        — pattern negation
3. then / ,     — sequence
4. joined by    — separated list
5. or           — alternation (ordered choice)`}</Pre>

      <H2>Examples</H2>
      <Pre label="grammar">{`-- letter then one or more digits
-- means: letter then (one or more digits)

-- a then b or c then d
-- means: (a then b) or (c then d)

-- item joined by comma or item joined by semicolon
-- means: (item joined by comma) or (item joined by semicolon)`}</Pre>

      <H2>Parentheses</H2>
      <P>Use parentheses to override precedence:</P>
      <Pre label="grammar">{`one or more (letter then digit)
zero or more (space or tab)`}</Pre>
    </DocPage>
  )
}

function CommentsDoc() {
  return (
    <DocPage>
      <H1>Comments</H1>
      <P>Line comments start with <Code>--</Code>:</P>
      <Pre label="grammar">{`-- this is a comment
key: one or more letters  -- inline comment
value: one or more digits`}</Pre>
      <P>Comments are stripped during parsing. They have no effect on the grammar.</P>
    </DocPage>
  )
}

function UnicodeDoc() {
  return (
    <DocPage>
      <H1>Unicode & Bytes</H1>

      <H2>UTF-8 codepoints</H2>
      <P><Code>any character</Code> and <Code>none of</Code> consume one UTF-8 codepoint (1-4 bytes). <Code>café</Code> is 4 <Code>any character</Code> matches, not 5.</P>

      <H2>ASCII classes</H2>
      <P>All other classes (<Code>letter</Code>, <Code>digit</Code>, <Code>visible</Code>, etc.) match single ASCII bytes only.</P>

      <H2>Byte ranges</H2>
      <P><Code>byte 0x80 to byte 0xFF</Code> operates byte-by-byte.</P>
      <Note>Mixing codepoint-aware constructs (<Code>any character</Code>, <Code>none of</Code>) with high byte ranges ({'>'}&equals; 0x80) in the same rule is a compile error. Split them into separate rules instead. This prevents misaligned positions where <Code>any character</Code> advances 2-4 bytes but a byte range advances 1.</Note>
    </DocPage>
  )
}

function RunDoc() {
  return (
    <DocPage>
      <H1>run</H1>
      <Pre label="typescript">{`run(source: string, input: string): MatchResult`}</Pre>
      <P>Parse a grammar and match it against input in one call. Returns <Code>MatchSuccess</Code> or <Code>MatchFailure</Code>.</P>
      <Pre label="app.ts">{`import { run } from '@hollowsolve/match'

const result = run('main: 4 digits', '2025')

if (result.matched) {
  console.log(result.tree)        // full parse tree
  console.log(result.extracted)   // extracted nodes
} else {
  console.log(result.offset)      // byte offset of failure
  console.log(result.expected)    // what the parser expected
  console.log(result.found)       // what it found
  console.log(result.rule_stack)  // rule call stack
}`}</Pre>
      <P>Use <Code>run</Code> for one-off matching. If you're matching the same grammar against many inputs, use <DocLink to="/docs/api/parse-match">parse &amp; match</DocLink> instead.</P>
    </DocPage>
  )
}

function ParseMatchDoc() {
  return (
    <DocPage>
      <H1>parse & match</H1>
      <Pre label="typescript">{`parse(source: string): MatchProgram
match(program: MatchProgram, input: string): MatchResult`}</Pre>
      <P>Separate compilation from matching. <Code>parse</Code> compiles and validates a grammar. <Code>match</Code> runs a compiled grammar against input.</P>
      <Pre label="app.ts">{`import { parse, match } from '@hollowsolve/match'

const program = parse(\`
  year: 4 digits
  month: 2 digits
  day: 2 digits
  date: year then hyphen then month then hyphen then day
\`)

// compile once, match many
match(program, '2025-01-15')  // matched
match(program, '25-1-5')      // failed
match(program, '2025-12-31')  // matched`}</Pre>
      <P><Code>parse</Code> throws <Code>ParseError</Code> if the grammar is invalid (syntax errors, left recursion, byte/codepoint mixing).</P>
    </DocPage>
  )
}

function FindDoc() {
  return (
    <DocPage>
      <H1>find</H1>
      <Pre label="typescript">{`find(program: MatchProgram, input: string): FindMatch[]`}</Pre>
      <P>Find all non-overlapping matches of a pattern within a string.</P>
      <Pre label="app.ts">{`import { parse, find } from '@hollowsolve/match'

const program = parse('main: one or more digits')
const matches = find(program, 'port 8080 and port 443')

// [
//   { start: 5, end: 9, text: "8080", tree: { ... } },
//   { start: 20, end: 23, text: "443", tree: { ... } }
// ]`}</Pre>
      <P>Returns character-level offsets (not byte offsets) so results work directly with <Code>String.prototype.slice()</Code>.</P>
      <H2>FindMatch</H2>
      <Pre label="typescript">{`interface FindMatch {
  start: number   // character offset (inclusive)
  end: number     // character offset (exclusive)
  text: string    // matched text
  tree: RuleMatch // full parse tree of the match
}`}</Pre>
    </DocPage>
  )
}

function TryParseDoc() {
  return (
    <DocPage>
      <H1>tryParse</H1>
      <Pre label="typescript">{`tryParse(source: string, input: string): MatchSuccess | PartialResult`}</Pre>
      <P>Like <Code>run</Code>, but on failure returns a <Code>PartialResult</Code> with the partial parse tree and how far the furthest branch got.</P>
      <Pre label="app.ts">{`import { tryParse } from '@hollowsolve/match'

const result = tryParse(\`
  year: 4 digits
  month: 2 digits
  day: 2 digits
  date: year then hyphen then month then hyphen then day
\`, '2025-1')

if (!result.matched) {
  console.log(result.bytes_consumed)  // 6
  console.log(result.partial_tree)    // tree built before failure
  console.log(result.expected)        // ["digit"]
}`}</Pre>
      <P>The partial tree reflects the furthest-progressed branch (most bytes consumed), not the last-attempted one. The tree contains only fully matched nodes.</P>
      <P>Intended for editor/IDE integration: incremental validation, error highlighting, autocomplete context.</P>
    </DocPage>
  )
}

function SearchDoc() {
  return (
    <DocPage>
      <H1>Search</H1>
      <P>Line-oriented search functions for strings, files, and folders.</P>

      <H2>searchString</H2>
      <Pre label="typescript">{`searchString(
  program: MatchProgram,
  text: string,
  label?: string,
  options?: SearchOptions
): LineMatch[]`}</Pre>

      <H2>searchFile</H2>
      <Pre label="typescript">{`searchFile(
  program: MatchProgram,
  path: string,
  options?: SearchOptions
): SearchResult`}</Pre>

      <H2>searchFolder</H2>
      <Pre label="typescript">{`searchFolder(
  program: MatchProgram,
  path: string,
  options?: SearchOptions
): SearchResult`}</Pre>
      <P>Recursive. Skips binary files, hidden directories, <Code>.git</Code>, <Code>node_modules</Code>, <Code>dist</Code>, and other common build directories.</P>

      <H2>Streaming</H2>
      <Pre label="typescript">{`searchStream(program, stream, options?): AsyncGenerator<LineMatch>
searchFileStream(program, path, options?): AsyncGenerator<LineMatch>`}</Pre>
      <P>Constant-memory streaming search. Results are yielded line by line.</P>

      <H2>Options</H2>
      <Pre label="typescript">{`interface SearchOptions {
  startLine?: number
  endLine?: number
  glob?: string
  color?: boolean
}

interface LineMatch {
  file: string
  line: number
  content: string
  matches: FindMatch[]
}`}</Pre>

      <H2>Formatting</H2>
      <Pre label="typescript">{`formatSearchResults(results: LineMatch[], options?: { color?: boolean }): string`}</Pre>
      <P>Renders results in grep-style <Code>file:line: content</Code> format with optional ANSI color highlighting.</P>
    </DocPage>
  )
}

function DiagnosticsDoc() {
  return (
    <DocPage>
      <H1>Diagnostics</H1>

      <H2>formatFailure</H2>
      <Pre label="typescript">{`formatFailure(failure: MatchFailure, input?: string): string`}</Pre>
      <P>Renders a failure as a human-readable string:</P>
      <Pre label="output">{`match failed at byte 47 (line 3, column 12):
  expected: digit, hyphen, or end of input
  found: "x" (0x78)
  in: forwarded > element > param > value > token

  ...invalid=x;more
              ^`}</Pre>
      <P>Pass the original <Code>input</Code> string to get the source pointer. The output format is stable public API.</P>

      <H2>formatTree</H2>
      <Pre label="typescript">{`formatTree(tree: RuleMatch): string`}</Pre>
      <P>Renders a parse tree as an indented tree visualization:</P>
      <Pre label="output">{`param [0..9]
├── token [0..3] "key"
└── token [4..9] "value"`}</Pre>
    </DocPage>
  )
}

function TypesDoc() {
  return (
    <DocPage>
      <H1>Types</H1>
      <P>All types are named exports from <Code>@hollowsolve/match</Code>.</P>

      <H2>MatchResult</H2>
      <Pre label="typescript">{`type MatchResult = MatchSuccess | MatchFailure`}</Pre>

      <H2>MatchSuccess</H2>
      <Pre label="typescript">{`interface MatchSuccess {
  matched: true
  bytes_consumed: number
  tree: RuleMatch
  extracted: RuleMatch[]
}`}</Pre>

      <H2>MatchFailure</H2>
      <Pre label="typescript">{`interface MatchFailure {
  matched: false
  offset: number       // byte offset
  line: number         // 1-based
  column: number       // 1-based
  expected: string[]   // what the parser expected
  found: string        // what was actually there
  rule_stack: string[] // rule call stack (outermost first)
}`}</Pre>

      <H2>RuleMatch</H2>
      <Pre label="typescript">{`interface RuleMatch {
  rule: string
  start: number        // byte offset (inclusive)
  end: number          // byte offset (exclusive)
  text: string         // matched text
  children: RuleMatch[]
}`}</Pre>

      <H2>PartialResult</H2>
      <Pre label="typescript">{`interface PartialResult {
  matched: false
  bytes_consumed: number
  partial_tree: RuleMatch | null
  extracted: RuleMatch[]
  offset: number
  line: number
  column: number
  expected: string[]
  found: string
  rule_stack: string[]
}`}</Pre>

      <H2>MatchProgram</H2>
      <Pre label="typescript">{`interface MatchProgram {
  rules: RuleNode[]
  entryPoint: string
}`}</Pre>

      <H2>FindMatch</H2>
      <Pre label="typescript">{`interface FindMatch {
  start: number
  end: number
  text: string
  tree: RuleMatch
}`}</Pre>

      <H2>Stability</H2>
      <P>All exported types, function signatures, and the <Code>formatFailure</Code> output format are stable public API. Tooling may depend on these interfaces.</P>
    </DocPage>
  )
}

function DynamicGrammarsDoc() {
  return (
    <DocPage>
      <H1>Dynamic Grammars</H1>
      <P>Match grammars are plain strings. To parameterize a grammar at runtime, use string interpolation:</P>
      <Pre label="app.ts">{`const delim = userConfig.delimiter  // e.g. ","
const grammar = \`
field: one or more characters except ("\${delim}", newline)
row: field joined by "\${delim}"
\`

const result = run(grammar, input)`}</Pre>
      <P>This is the intended approach. There is no macro system or rule parameterization built into the language — grammars are data, and your host language is the templating layer.</P>

      <H2>Caching parsed grammars</H2>
      <P>If the same grammar is used repeatedly, parse it once and reuse the program:</P>
      <Pre label="app.ts">{`import { parse, match } from '@hollowsolve/match'

const program = parse(grammar)  // parse once
match(program, input1)          // reuse many times
match(program, input2)`}</Pre>
      <P>The <Code>parse</Code> step is the expensive part. <Code>match</Code> against a pre-parsed program is fast.</P>
    </DocPage>
  )
}

function KeyValueExample() {
  return (
    <DocPage>
      <H1>Key-Value Parser</H1>
      <Pre label="grammar">{`key: one or more letters
value: one or more digits
pair: key then equals then value`}</Pre>
      <Pre label="app.ts">{`import { run, formatTree } from '@hollowsolve/match'

const grammar = \`
key: one or more letters
value: one or more digits
pair: key then equals then value
\`

const result = run(grammar, 'name=42')
console.log(formatTree(result.tree))
// pair [0..7]
// ├── key [0..4] "name"
// └── value [5..7] "42"

console.log(result.tree.children[0].text)  // "name"
console.log(result.tree.children[1].text)  // "42"`}</Pre>
    </DocPage>
  )
}

function CSVExample() {
  return (
    <DocPage>
      <H1>CSV Parser</H1>
      <Pre label="grammar">{`field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline`}</Pre>
      <Pre label="app.ts">{`import { run, formatTree } from '@hollowsolve/match'

const grammar = \`
field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline
\`

const result = run(grammar, 'name,age,city\\nAlice,30,NYC')
console.log(formatTree(result.tree))
// csv [0..24]
// ├── row [0..13]
// │   ├── field [0..4] "name"
// │   ├── field [5..8] "age"
// │   └── field [9..13] "city"
// └── row [14..24]
//     ├── field [14..19] "Alice"
//     ├── field [20..22] "30"
//     └── field [23..26] "NYC"`}</Pre>
    </DocPage>
  )
}

function EmailExample() {
  return (
    <DocPage>
      <H1>Email Extractor</H1>
      <P>Use <Code>find</Code> to extract all email addresses from text:</P>
      <Pre label="grammar">{`local: one or more of (letter, digit, period, hyphen)
domain: one or more letters then period then one or more letters
email: local then at then domain`}</Pre>
      <Pre label="app.ts">{`import { parse, find } from '@hollowsolve/match'

const program = parse(\`
local: one or more of (letter, digit, period, hyphen)
domain: one or more letters then period then one or more letters
email: local then at then domain
\`)

const matches = find(program, 'contact dev@match.io or support@match.io today')
// [
//   { start: 8, end: 20, text: "dev@match.io", ... },
//   { start: 24, end: 40, text: "support@match.io", ... }
// ]`}</Pre>
    </DocPage>
  )
}

function JSONExample() {
  return (
    <DocPage>
      <H1>JSON Subset</H1>
      <P>A grammar for JSON strings, numbers, arrays, and objects:</P>
      <Pre label="grammar">{`ws: zero or more whitespace

escaped: backslash then any of (double quote, backslash, slash,
  "b", "f", "n", "r", "t")
str char: visible except (double quote, backslash) or escaped
string: double quote then zero or more str char then double quote

sign: optional (any of (plus, hyphen))
digits: one or more digits
number: sign then digits then optional (period then digits)

value: string or number or array or object

element: ws then value then ws
elements: element joined by comma

array: open bracket then optional elements then ws then close bracket

pair: ws then string then ws then colon then element
members: pair joined by comma

object: open brace then optional members then ws then close brace

json: element`}</Pre>
      <Pre label="app.ts">{`import { run } from '@hollowsolve/match'

const result = run(grammar, '{"name": "match", "version": 3}')
// matched: true`}</Pre>
    </DocPage>
  )
}

function RFC7239Example() {
  return (
    <DocPage>
      <H1>RFC 7239 Forwarded</H1>
      <P>A complete parser for the HTTP Forwarded header per <a href="https://www.rfc-editor.org/rfc/rfc7239" target="_blank" rel="noopener" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>RFC 7239</a>:</P>
      <Pre label="grammar">{`token char:
  any of (
    exclamation, hash, dollar, percent, ampersand,
    single quote, asterisk, plus, period, caret,
    underscore, backtick, pipe, tilde,
    "0" to "9", "a" to "z", "A" to "Z", hyphen
  )

token: one or more token char

escaped:
  backslash then any of (
    tab, byte 0x20 to byte 0x7E, byte 0x80 to byte 0xFF
  )

qdtext:
  any of (
    printable except (double quote, backslash),
    tab,
    byte 0x80 to byte 0xFF
  )

quoted value:
  double quote
  then zero or more (qdtext or escaped)
  then double quote

value: token or quoted value

param: token then equals then value

element: param joined by semicolon

ows: zero or more (space or tab)

forwarded: element joined by comma then ows`}</Pre>
      <Pre label="app.ts">{`import { run } from '@hollowsolve/match'

run(grammar, 'for=192.0.2.60;proto=http;by=203.0.113.43')
// matched: true`}</Pre>
    </DocPage>
  )
}

function LogSearchExample() {
  return (
    <DocPage>
      <H1>Log Search</H1>
      <P>Use the search API to find patterns across files:</P>
      <Pre label="app.ts">{`import { parse, searchFile, searchFolder, formatSearchResults } from '@hollowsolve/match'

// find all IP addresses in a log file
const program = parse(\`
octet: between 1 and 3 digits
ip: octet then period then octet then period then octet then period then octet
\`)

// search a single file
const result = searchFile(program, './server.log')
console.log(formatSearchResults(result.matches))
// ./server.log:14: connection from 192.168.1.42
// ./server.log:89: forwarded for 10.0.0.1

// search a folder recursively
const all = searchFolder(program, './logs', { glob: '*.log' })
console.log(\`Found \${all.matches.length} matches\`)`}</Pre>

      <H2>Streaming search</H2>
      <Pre label="app.ts">{`import { parse, searchFileStream } from '@hollowsolve/match'

const program = parse('main: "ERROR" then one or more (any character)')

// constant-memory streaming — results yielded line by line
for await (const match of searchFileStream(program, './huge.log')) {
  console.log(\`Line \${match.line}: \${match.content}\`)
}`}</Pre>
    </DocPage>
  )
}

function CLIDoc() {
  return (
    <DocPage>
      <H1>CLI</H1>
      <P>Match includes a command-line search tool:</P>
      <Pre label="terminal">{`npx match-search "pattern" in file path.log
npx match-search "pattern" in folder ./logs
npx match-search "pattern" in folder ./logs --glob "*.log"
npx match-search "pattern" in file app.log lines 100 to 200
cat server.log | npx match-search "pattern"`}</Pre>

      <H2>Options</H2>
      <Pre label="reference">{`in file <path>          search a single file
in folder <path>        search a directory recursively
--glob <pattern>        filter files by glob pattern
lines <start> to <end>  restrict to line range
--no-color              disable color output`}</Pre>

      <P>Respects <Code>NO_COLOR</Code>. Disables color automatically when piped.</P>
    </DocPage>
  )
}

export function DocsLayout() {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      fontFamily: 'var(--t-sans)',
    }}>
      <style>{`
        .doc-content h1, .doc-content h2, .doc-content h3 {
          font-family: var(--t-sans);
        }
        .doc-content a {
          color: var(--t-text);
        }
        .doc-content a:hover {
          opacity: 0.7;
        }
        .doc-content em {
          font-style: italic;
        }
        @media (max-width: 768px) {
          .docs-sidebar { display: none !important; }
          .doc-content { padding: 96px 20px 48px !important; }
        }
      `}</style>
      <div className="docs-sidebar">
        <Sidebar />
      </div>
      <Routes>
        <Route index element={<Navigate to="/docs/getting-started/installation" replace />} />
        <Route path="getting-started/installation" element={<Installation />} />
        <Route path="getting-started/first-grammar" element={<FirstGrammar />} />
        <Route path="language/rules" element={<RulesDoc />} />
        <Route path="language/characters" element={<CharactersDoc />} />
        <Route path="language/classes" element={<ClassesDoc />} />
        <Route path="language/text-blocks" element={<TextBlocksDoc />} />
        <Route path="language/sequences" element={<SequencesDoc />} />
        <Route path="language/repetition" element={<RepetitionDoc />} />
        <Route path="language/sets" element={<SetsDoc />} />
        <Route path="language/negation" element={<NegationDoc />} />
        <Route path="language/until" element={<UntilDoc />} />
        <Route path="language/extract" element={<ExtractDoc />} />
        <Route path="language/joined-by" element={<JoinedByDoc />} />
        <Route path="language/precedence" element={<PrecedenceDoc />} />
        <Route path="language/comments" element={<CommentsDoc />} />
        <Route path="language/unicode" element={<UnicodeDoc />} />
        <Route path="api/run" element={<RunDoc />} />
        <Route path="api/parse-match" element={<ParseMatchDoc />} />
        <Route path="api/find" element={<FindDoc />} />
        <Route path="api/try-parse" element={<TryParseDoc />} />
        <Route path="api/search" element={<SearchDoc />} />
        <Route path="api/diagnostics" element={<DiagnosticsDoc />} />
        <Route path="api/types" element={<TypesDoc />} />
        <Route path="api/dynamic-grammars" element={<DynamicGrammarsDoc />} />
        <Route path="examples/key-value" element={<KeyValueExample />} />
        <Route path="examples/csv" element={<CSVExample />} />
        <Route path="examples/email" element={<EmailExample />} />
        <Route path="examples/json" element={<JSONExample />} />
        <Route path="examples/rfc7239" element={<RFC7239Example />} />
        <Route path="examples/log-search" element={<LogSearchExample />} />
        <Route path="cli" element={<CLIDoc />} />
      </Routes>
    </div>
  )
}
