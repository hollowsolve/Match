import { useState, useCallback, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { tryParse, find, formatFailure, parse } from '@hollowsolve/match'
import type { RuleMatch } from '@hollowsolve/match'

const EXAMPLES: { name: string; grammar: string; input: string }[] = [
  {
    name: 'Key-Value',
    grammar: `key: one or more letters
value: one or more digits
pair: key then equals then value`,
    input: 'name=42',
  },
  {
    name: 'Date',
    grammar: `year: 4 digits
month: 2 digits
day: 2 digits
date: year then hyphen then month then hyphen then day`,
    input: '2025-01-15',
  },
  {
    name: 'CSV',
    grammar: `field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline`,
    input: 'name,age,city\nAlice,30,NYC',
  },
  {
    name: 'Email',
    grammar: `local: one or more of (letter, digit, period, hyphen)
domain: one or more letters then period then one or more letters
email: local then at then domain`,
    input: 'dev@match.io',
  },
  {
    name: 'Hex Color',
    grammar: `hex: any of ("0" to "9", "a" to "f", "A" to "F")
color: hash then 6 hex digits`,
    input: '#6366f1',
  },
  {
    name: 'JSON String',
    grammar: `escaped: backslash then any of (double quote, backslash, slash, "b", "f", "n", "r", "t")
str char: printable except (double quote, backslash) or escaped
json string: double quote then zero or more str char then double quote`,
    input: '"hello world"',
  },
  {
    name: 'IP Address',
    grammar: `octet: between 1 and 3 digits
ip: octet then period then octet then period then octet then period then octet`,
    input: '192.168.1.42',
  },
  {
    name: 'Semantic Version',
    grammar: `num: one or more digits
semver: num then period then num then period then num`,
    input: '1.24.3',
  },
  {
    name: 'URL Path',
    grammar: `segment: one or more of (letter, digit, hyphen, underscore)
path: one or more (slash then segment)`,
    input: '/api/v2/users',
  },
  {
    name: 'Log Line',
    grammar: `level: "ERROR" or "WARN" or "INFO" or "DEBUG"
timestamp: 4 digits then hyphen then 2 digits then hyphen then 2 digits
message: one or more characters except (newline)
log line: open bracket then level then close bracket then space then timestamp then colon then space then message`,
    input: '[ERROR] 2025-01-15: connection refused',
  },
]

type Tab = 'tree' | 'extracted' | 'find'

interface PlaygroundState {
  grammar: string
  input: string
  tab: Tab
  findInput: string
}

function TreeView({ node, depth }: { node: RuleMatch; depth: number }) {
  const isLeaf = node.children.length === 0

  return (
    <div style={{ fontFamily: 'var(--t-mono)', fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ paddingLeft: depth * 20 }}>
        <span style={{ color: 'var(--t-text)', fontWeight: 600 }}>{node.rule}</span>
        <span style={{ color: 'var(--t-text-muted)', marginLeft: 8 }}>[{node.start}..{node.end}]</span>
        {isLeaf && <span style={{ color: 'var(--t-success)', marginLeft: 8 }}>"{node.text}"</span>}
      </div>
      {node.children.map((child: RuleMatch, i: number) => (
        <TreeView key={`${child.rule}-${child.start}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

const MATCH_SYSTEM_PROMPT = `You are an expert in the Match pattern matching language. You write Match grammars for users.

Match replaces regex with readable, composable grammars. Key syntax:

RULES: "name: pattern" — last rule is entry point. Rules reference other rules by name.
CHARACTERS: letter, digit, space, tab, newline, hyphen, period, comma, colon, semicolon, slash, backslash, at, hash, dollar, percent, ampersand, asterisk, plus, equals, pipe, tilde, caret, underscore, backtick, exclamation, question, single quote, double quote, open paren, close paren, open bracket, close bracket, open brace, close brace, less than, greater than
CLASSES: letter, digit, uppercase, lowercase, hex digit, whitespace, visible, printable, alphanumeric, word character, any character
QUOTED: "a", "Z", "0" — single chars. Ranges: "a" to "z", "0" to "9"
TEXT BLOCKS: "hello world" — quoted multi-char strings
SEQUENCE: A then B (comma is shorthand: A, B)
ALTERNATION: A or B (ordered choice, PEG)
REPETITION: one or more X, zero or more X, optional X, N X (e.g. 4 digits), between N and M X
SETS: any of (a, b, c), one or more of (a, b), none of (a, b), one or more characters except (a, b), X except (a, b)
NEGATION: A isn't B
UNTIL: any character until including X, any character until excluding X
EXTRACT: extract ruleName, extract (group)
JOINED BY: item joined by separator, item joined by separator lenient
COMMENTS: -- comment
PRECEDENCE (tight to loose): repetition > isn't > then > joined by > or
PARENS: one or more (A then B) — group compound patterns for repetition

Respond ONLY with the grammar. No explanation, no code fences, no markdown. Just the raw grammar rules, one per line.`

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function AIChat({ onApplyGrammar }: { onApplyGrammar: (grammar: string) => void }) {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('match-ai-key') || '')
  const [provider, setProvider] = useState<'anthropic' | 'openai'>(() => (sessionStorage.getItem('match-ai-provider') as any) || 'anthropic')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const saveKey = (key: string, prov: 'anthropic' | 'openai') => {
    setApiKey(key)
    setProvider(prov)
    sessionStorage.setItem('match-ai-key', key)
    sessionStorage.setItem('match-ai-provider', prov)
    setShowKeyInput(false)
  }

  const sendMessage = async () => {
    if (!input.trim() || !apiKey || loading) return
    const userMsg: ChatMessage = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      let assistantText = ''

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: MATCH_SYSTEM_PROMPT,
            messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        assistantText = data.content?.[0]?.text || 'No response'
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: MATCH_SYSTEM_PROMPT },
              ...newMessages.map(m => ({ role: m.role, content: m.content })),
            ],
          }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error.message)
        assistantText = data.choices?.[0]?.message?.content || 'No response'
      }

      setMessages([...newMessages, { role: 'assistant', content: assistantText }])
    } catch (e: any) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  if (!apiKey || showKeyInput) {
    return (
      <div style={{
        padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
        height: '100%', justifyContent: 'center', alignItems: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ fontSize: 12, color: 'var(--t-text-muted)', textAlign: 'center', fontFamily: 'var(--t-mono)', maxWidth: 240 }}>
          Paste your API key to use AI grammar generation.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['anthropic', 'openai'] as const).map(p => (
            <button key={p} onClick={() => setProvider(p)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 10,
              fontFamily: 'var(--t-mono)', fontWeight: 600,
              border: '1px solid var(--t-border)', cursor: 'pointer',
              background: provider === p ? 'var(--t-accent)' : 'transparent',
              color: provider === p ? 'var(--t-bg)' : 'var(--t-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>{p}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, width: '100%', maxWidth: 280 }}>
          <input
            id="ai-key-input"
            type="password"
            placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            style={{
              flex: 1, padding: '8px 12px',
              borderRadius: 6, border: '1px solid var(--t-border)',
              background: 'var(--t-bg)', color: 'var(--t-text)',
              fontFamily: 'var(--t-mono)', fontSize: 12, outline: 'none',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                saveKey((e.target as HTMLInputElement).value.trim(), provider)
              }
            }}
          />
          <button
            onClick={() => {
              const el = document.getElementById('ai-key-input') as HTMLInputElement
              if (el?.value.trim()) saveKey(el.value.trim(), provider)
            }}
            style={{
              width: 36, borderRadius: 6, border: 'none',
              background: 'var(--t-accent)', color: 'var(--t-bg)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 11V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M3.5 6.5L7 3L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--t-text-muted)', textAlign: 'center', fontFamily: 'var(--t-mono)', maxWidth: 240, opacity: 0.5 }}>
          Your key stays in this tab only and goes straight to the provider. We never store, log, or see it. Cleared when you close the tab.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            color: 'var(--t-text-muted)', fontSize: 12, fontFamily: 'var(--t-mono)',
            textAlign: 'center', padding: 16,
          }}>
            <div style={{ opacity: 0.5 }}>Ask AI to write a grammar</div>
            <div style={{ opacity: 0.3, fontSize: 11 }}>"parse a URL" or "match a phone number"</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
          }}>
            <pre style={{
              padding: '8px 12px', borderRadius: 8, margin: 0,
              fontSize: 11.5, lineHeight: 1.6, fontFamily: 'var(--t-mono)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: msg.role === 'user' ? 'var(--t-accent)' : 'var(--t-code-bg)',
              color: msg.role === 'user' ? 'var(--t-bg)' : 'var(--t-code-text)',
              border: msg.role === 'assistant' ? '1px solid var(--t-border)' : 'none',
            }}>{msg.content}</pre>
            {msg.role === 'assistant' && !msg.content.startsWith('Error:') && (
              <button
                onClick={() => onApplyGrammar(msg.content)}
                style={{
                  marginTop: 4, padding: '3px 8px', borderRadius: 5,
                  border: '1px solid var(--t-border)', background: 'transparent',
                  color: 'var(--t-text-muted)', fontSize: 10, fontFamily: 'var(--t-mono)',
                  cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >Apply to grammar</button>
            )}
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 8,
            background: 'var(--t-code-bg)', border: '1px solid var(--t-border)',
            fontSize: 12, color: 'var(--t-text-muted)', fontFamily: 'var(--t-mono)',
          }}>
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >thinking...</motion.span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div style={{
        padding: '8px 12px', borderTop: '1px solid var(--t-border)',
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value.slice(0, 2000))}
          maxLength={2000}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
          }}
          placeholder="Describe what to parse..."
          rows={1}
          style={{
            flex: 1, resize: 'none', border: '1px solid var(--t-border)',
            borderRadius: 6, outline: 'none', padding: '6px 10px',
            fontFamily: 'var(--t-mono)', fontSize: 12, lineHeight: 1.5,
            background: 'var(--t-bg)', color: 'var(--t-text)',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            padding: '6px 10px', borderRadius: 6, border: 'none',
            background: loading || !input.trim() ? 'var(--t-border)' : 'var(--t-accent)',
            color: 'var(--t-bg)', cursor: loading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8l5-5v3h5a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H7v3L2 8z" fill="currentColor" style={{ transform: 'rotate(180deg)', transformOrigin: 'center' }} />
          </svg>
        </button>
      </div>
      <div style={{
        padding: '4px 12px 6px', display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          onClick={() => setShowKeyInput(true)}
          style={{
            background: 'none', border: 'none', padding: 0,
            color: 'var(--t-text-muted)', fontSize: 10, fontFamily: 'var(--t-mono)',
            cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
        >{provider} key ****{apiKey.slice(-4)}</button>
      </div>
    </div>
  )
}

function ExamplesDropdown({ examples, current, onSelect }: {
  examples: typeof EXAMPLES
  current: string
  onSelect: (ex: typeof EXAMPLES[number]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeEx = examples.find(e => e.grammar === current)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'transparent',
          border: '1px solid var(--t-border)',
          borderRadius: 6,
          padding: '3px 8px 3px 10px',
          fontSize: 10,
          fontFamily: 'var(--t-mono)',
          fontWeight: 600,
          color: 'var(--t-text-muted)',
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          transition: 'border-color 0.2s',
        }}
      >
        Examples
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" style={{
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', top: '100%', right: 0,
              background: 'var(--t-bg)',
              border: '1px solid var(--t-border)',
              borderRadius: 8,
              padding: 4,
              minWidth: 150,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              zIndex: 50,
            }}
          >
            {examples.map(ex => (
              <button
                key={ex.name}
                onClick={() => { onSelect(ex); setOpen(false) }}
                style={{
                  display: 'block', width: '100%',
                  padding: '5px 10px',
                  border: 'none', borderRadius: 5,
                  background: current === ex.grammar ? 'var(--t-accent)' : 'transparent',
                  color: current === ex.grammar ? 'var(--t-bg)' : 'var(--t-text-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--t-mono)',
                  fontWeight: current === ex.grammar ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
              >
                {ex.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function useDrag(direction: 'horizontal' | 'vertical', initial: number, min: number, max: number) {
  const [value, setValue] = useState(initial)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startPos = direction === 'horizontal' ? e.clientX : e.clientY
    const startVal = value

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = (direction === 'horizontal' ? ev.clientX : ev.clientY) - startPos
      const container = direction === 'horizontal' ? window.innerWidth : window.innerHeight
      const pct = startVal + (delta / container) * 100
      setValue(Math.min(max, Math.max(min, pct)))
    }

    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [value, direction, min, max])

  return { value, onMouseDown }
}

function DragHandle({ direction, onMouseDown }: { direction: 'horizontal' | 'vertical'; onMouseDown: (e: React.MouseEvent) => void }) {
  const isH = direction === 'horizontal'
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'relative',
        flexShrink: 0,
        [isH ? 'width' : 'height']: 5,
        cursor: isH ? 'col-resize' : 'row-resize',
        background: 'var(--t-border)',
        zIndex: 5,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--t-text-muted)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--t-border)')}
    />
  )
}

const BAR: React.CSSProperties = {
  padding: '8px 16px',
  minHeight: 38,
  borderBottom: '1px solid var(--t-border)',
  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--t-text-muted)',
  fontFamily: 'var(--t-mono)',
  flexShrink: 0,
  display: 'flex', alignItems: 'center',
}

export function Playground() {
  const [state, setState] = useState<PlaygroundState & { aiOpen?: boolean }>({
    grammar: '',
    input: '',
    tab: 'tree',
    findInput: '',
    aiOpen: true,
  })
  const [autoRun, setAutoRun] = useState(true)

  const [result, setResult] = useState<{
    type: 'success' | 'failure' | 'error' | 'partial'
    data: Record<string, unknown> | null
    error?: string
    time?: number
  } | null>(null)

  const [findResults, setFindResults] = useState<{ start: number; end: number; text: string }[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const vSplit = useDrag('horizontal', 50, 20, 80)
  const hSplit = useDrag('vertical', 35, 15, 75)

  const runMatch = useCallback((grammar: string, input: string) => {
    if (!grammar.trim()) {
      setResult(null)
      return
    }

    try {
      const start = performance.now()
      const r = tryParse(grammar, input)
      const elapsed = performance.now() - start

      if (r.matched) {
        setResult({ type: 'success', data: r as unknown as Record<string, unknown>, time: elapsed })
      } else {
        setResult({ type: 'partial', data: r as unknown as Record<string, unknown>, error: formatFailure(r as never, input), time: elapsed })
      }
    } catch (e: any) {
      setResult({ type: 'error', data: null, error: e.message || String(e) })
    }
  }, [])

  const runFind = useCallback((grammar: string, input: string) => {
    if (!grammar.trim() || !input.trim()) {
      setFindResults([])
      return
    }

    try {
      const program = parse(grammar)
      const matches = find(program, input)
      setFindResults(matches.map((m: { start: number; end: number; text: string }) => ({ start: m.start, end: m.end, text: m.text })))
    } catch {
      setFindResults([])
    }
  }, [])

  const executeRun = useCallback(() => {
    runMatch(state.grammar, state.input)
    if (state.tab === 'find') {
      runFind(state.grammar, state.findInput || state.input)
    }
  }, [state.grammar, state.input, state.tab, state.findInput, runMatch, runFind])

  useEffect(() => {
    if (!autoRun) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(executeRun, 80)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [autoRun, executeRun])

  const loadExample = (ex: typeof EXAMPLES[number]) => {
    setState(s => ({ ...s, grammar: ex.grammar, input: ex.input }))
  }

  const matchResult = result?.type === 'success' ? result.data as any : null
  const partialData = result?.type === 'partial' ? result.data as any : null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 60px)',
      marginTop: 60,
      fontFamily: 'var(--t-sans)',
    }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{
          width: `${vSplit.value}%`, display: 'flex', flexDirection: 'column',
          minWidth: 0,
        }}>
          <div style={{ ...BAR, justifyContent: 'space-between' }}>
            <span>Grammar</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ExamplesDropdown
                examples={EXAMPLES}
                current={state.grammar}
                onSelect={loadExample}
              />
              <button
                onClick={() => setState(s => ({ ...s, aiOpen: !s.aiOpen } as any))}
                title="AI grammar assistant"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, borderRadius: 6,
                  border: `1px solid var(--t-border)`,
                  background: (state as any).aiOpen ? 'var(--t-accent)' : 'transparent',
                  color: (state as any).aiOpen ? 'var(--t-bg)' : 'var(--t-text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s', padding: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="2" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="6" cy="6" r="1" fill="currentColor" />
                  <circle cx="10" cy="6" r="1" fill="currentColor" />
                  <path d="M5 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M8 10v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          {(state as any).aiOpen ? (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <textarea
                value={state.grammar}
                onChange={e => setState(s => ({ ...s, grammar: e.target.value }))}
                spellCheck={false}
                style={{
                  flex: 1, resize: 'none', border: 'none', outline: 'none',
                  padding: 16, fontFamily: 'var(--t-mono)', fontSize: 13,
                  lineHeight: 1.7, background: 'var(--t-code-bg)',
                  color: 'var(--t-code-text)', minHeight: 0,
                  borderRight: '1px solid var(--t-border)',
                }}
              />
              <div style={{ width: '50%', minWidth: 200, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <AIChat onApplyGrammar={(g) => setState(s => ({ ...s, grammar: g }))} />
              </div>
            </div>
          ) : (
            <textarea
              value={state.grammar}
              onChange={e => setState(s => ({ ...s, grammar: e.target.value }))}
              spellCheck={false}
              style={{
                flex: 1, resize: 'none', border: 'none', outline: 'none',
                padding: 16, fontFamily: 'var(--t-mono)', fontSize: 13,
                lineHeight: 1.7, background: 'var(--t-code-bg)',
                color: 'var(--t-code-text)', minHeight: 0,
              }}
            />
          )}
        </div>

        <DragHandle direction="horizontal" onMouseDown={vSplit.onMouseDown} />

        <div style={{ width: `${100 - vSplit.value}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ ...BAR, gap: 12 }}>
            <span>Test Input</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <button
                onClick={() => setAutoRun(a => !a)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'transparent', border: '1px solid var(--t-border)',
                  borderRadius: 6, padding: '2px 8px',
                  fontSize: 10, fontFamily: 'var(--t-mono)', fontWeight: 600,
                  color: autoRun ? 'var(--t-success)' : 'var(--t-text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: autoRun ? 'var(--t-success)' : 'var(--t-text-muted)',
                  transition: 'background 0.15s',
                }} />
                Auto
              </button>
              {!autoRun && (
                <button
                  onClick={executeRun}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'var(--t-accent)', border: 'none',
                    borderRadius: 6, padding: '3px 10px',
                    fontSize: 10, fontFamily: 'var(--t-mono)', fontWeight: 600,
                    color: 'var(--t-bg)', cursor: 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M2 1l7 4-7 4z" fill="currentColor" />
                  </svg>
                  Run
                </button>
              )}
            </div>
            {result && result.type !== 'error' && (
              <span style={{
                fontSize: 11, fontFamily: 'var(--t-mono)',
                color: result.type === 'success' ? 'var(--t-success)' : '#ef4444',
              }}>
                {result.type === 'success' ? 'matched' : 'failed'}
                {result.time !== undefined && ` in ${result.time.toFixed(2)}ms`}
              </span>
            )}
            {result?.type === 'error' && (
              <span style={{
                fontSize: 11, fontFamily: 'var(--t-mono)',
                color: '#ef4444',
              }}>grammar error</span>
            )}
          </div>
          <textarea
            value={state.input}
            onChange={e => setState(s => ({ ...s, input: e.target.value }))}
            spellCheck={false}
            placeholder="Type test input here..."
            style={{
              height: `${hSplit.value}%`, resize: 'none', border: 'none', outline: 'none',
              padding: 16, fontFamily: 'var(--t-mono)', fontSize: 13,
              lineHeight: 1.7, background: 'var(--t-bg)',
              color: 'var(--t-text)',
              flexShrink: 0,
            }}
          />

          <DragHandle direction="vertical" onMouseDown={hSplit.onMouseDown} />

          <div style={{
            display: 'flex', borderBottom: '1px solid var(--t-border)',
            flexShrink: 0,
          }}>
            {(['tree', 'extracted', 'find'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setState(s => ({ ...s, tab }))}
                style={{
                  padding: '8px 16px',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                  textTransform: 'uppercase', fontFamily: 'var(--t-mono)',
                  background: 'transparent', border: 'none',
                  borderBottom: state.tab === tab ? '2px solid var(--t-accent)' : '2px solid transparent',
                  color: state.tab === tab ? 'var(--t-text)' : 'var(--t-text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {tab === 'tree' ? 'Parse Tree' : tab === 'extracted' ? 'Extracted' : 'Find All'}
              </button>
            ))}
          </div>

          <div style={{
            flex: 1, overflow: 'auto', padding: 16,
            background: 'var(--t-code-bg)', minHeight: 0,
          }}>
            {result?.type === 'error' && (
              <pre style={{
                fontFamily: 'var(--t-mono)', fontSize: 12,
                color: '#ef4444', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.7,
              }}>{result.error}</pre>
            )}

            {state.tab === 'tree' && matchResult && (
              <TreeView node={matchResult.tree} depth={0} />
            )}

            {state.tab === 'tree' && partialData && (
              <div>
                <pre style={{
                  fontFamily: 'var(--t-mono)', fontSize: 12,
                  color: '#ef4444', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.7,
                  marginBottom: 16,
                }}>{result?.error}</pre>
                {partialData.partial_tree && (
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: 'var(--t-text-muted)',
                      fontFamily: 'var(--t-mono)', marginBottom: 8,
                    }}>Partial Tree (before failure)</div>
                    <TreeView node={partialData.partial_tree} depth={0} />
                  </div>
                )}
              </div>
            )}

            {state.tab === 'tree' && !result && (
              <div style={{ color: 'var(--t-text-muted)', fontSize: 13, fontFamily: 'var(--t-mono)' }}>
                Write a grammar and provide test input to see results.
              </div>
            )}

            {state.tab === 'extracted' && matchResult && (
              <div style={{ fontFamily: 'var(--t-mono)', fontSize: 12, lineHeight: 1.8 }}>
                {matchResult.extracted.length === 0 ? (
                  <div style={{ color: 'var(--t-text-muted)' }}>
                    No extracts. Use <span style={{ color: 'var(--t-text)' }}>extract</span> in your grammar to pull out values.
                  </div>
                ) : (
                  matchResult.extracted.map((ex: RuleMatch, i: number) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <span style={{ color: 'var(--t-text-muted)' }}>extracted[{i}]</span>
                      <span style={{ color: 'var(--t-text)', marginLeft: 8 }}>{ex.rule}</span>
                      <span style={{ color: 'var(--t-text-muted)', marginLeft: 8 }}>[{ex.start}..{ex.end}]</span>
                      <span style={{ color: 'var(--t-success)', marginLeft: 8 }}>"{ex.text}"</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {state.tab === 'extracted' && !matchResult && result?.type !== 'error' && (
              <div style={{ color: 'var(--t-text-muted)', fontSize: 13, fontFamily: 'var(--t-mono)' }}>
                {result?.type === 'partial' ? 'Match failed. Fix the grammar or input to see extracted values.' : 'Write a grammar and provide test input.'}
              </div>
            )}

            {state.tab === 'find' && (
              <div>
                <textarea
                  value={state.findInput}
                  onChange={e => setState(s => ({ ...s, findInput: e.target.value }))}
                  placeholder="Enter text to search in (uses test input if empty)..."
                  spellCheck={false}
                  style={{
                    width: '100%', height: 80, resize: 'vertical',
                    border: '1px solid var(--t-border)', borderRadius: 6,
                    outline: 'none', padding: 12,
                    fontFamily: 'var(--t-mono)', fontSize: 12,
                    lineHeight: 1.7, background: 'var(--t-bg)',
                    color: 'var(--t-text)', marginBottom: 12,
                  }}
                />
                <div style={{ fontFamily: 'var(--t-mono)', fontSize: 12, lineHeight: 1.8 }}>
                  {findResults.length === 0 ? (
                    <div style={{ color: 'var(--t-text-muted)' }}>No matches found.</div>
                  ) : (
                    findResults.map((m, i) => (
                      <div key={i} style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--t-text-muted)' }}>[{m.start}..{m.end}]</span>
                        <span style={{ color: 'var(--t-success)', marginLeft: 8 }}>"{m.text}"</span>
                      </div>
                    ))
                  )}
                  {findResults.length > 0 && (
                    <div style={{ color: 'var(--t-text-muted)', marginTop: 8 }}>
                      {findResults.length} match{findResults.length !== 1 ? 'es' : ''} found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
