import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface TerminalLine {
  text: string
  type?: 'command' | 'output' | 'success' | 'comment'
  delay?: number
}

interface TerminalProps {
  lines: TerminalLine[]
  title?: string
  loop?: boolean
  typingSpeed?: number
}

const mono = "'JetBrains Mono', monospace"

export function Terminal({ lines, title = 'terminal', loop = true, typingSpeed = 30 }: TerminalProps) {
  const [displayedLines, setDisplayedLines] = useState<{ text: string; type: string; id: number }[]>([])
  const [currentLine, setCurrentLine] = useState(0)
  const [currentChar, setCurrentChar] = useState(0)
  const [isTyping, setIsTyping] = useState(true)
  const [done, setDone] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const prevLinesRef = useRef(lines)

  useEffect(() => {
    if (prevLinesRef.current !== lines) {
      prevLinesRef.current = lines
      setDisplayedLines([])
      setCurrentLine(0)
      setCurrentChar(1)
      setIsTyping(true)
      setDone(false)
    }
  }, [lines])

  useEffect(() => {
    if (currentLine >= lines.length) {
      setDone(true)
      if (loop) {
        const timeout = setTimeout(() => {
          setDisplayedLines([])
          setCurrentLine(0)
          setCurrentChar(1)
          setIsTyping(true)
          setDone(false)
        }, 3000)
        return () => clearTimeout(timeout)
      }
      return
    }

    const line = lines[currentLine]
    const delay = line.delay ?? 0

    if (currentChar === 0 && delay > 0) {
      const timeout = setTimeout(() => {
        setCurrentChar(1)
      }, delay)
      return () => clearTimeout(timeout)
    }

    if (line.type === 'output' || line.type === 'success' || line.type === 'comment') {
      const id = ++idRef.current
      setDisplayedLines(prev => [...prev, { text: line.text, type: line.type!, id }])
      setCurrentLine(prev => prev + 1)
      setCurrentChar(0)
      return
    }

    if (currentChar <= line.text.length) {
      const ch = line.text[currentChar - 1] || ''
      const prev = line.text[currentChar - 2] || ''
      let d = typingSpeed + Math.random() * typingSpeed * 0.8
      if (ch === ' ') d += typingSpeed * (0.3 + Math.random() * 1.2)
      if (ch === '/' || ch === '-' || ch === '.' || ch === '|') d += typingSpeed * 0.5
      if (prev === ' ') d -= typingSpeed * 0.15
      if (Math.random() < 0.08) d += typingSpeed * 2
      d = Math.max(typingSpeed * 0.4, d)
      const timeout = setTimeout(() => {
        setCurrentChar(p => p + 1)
      }, d)
      return () => clearTimeout(timeout)
    }

    const id = ++idRef.current
    setDisplayedLines(prev => [...prev, { text: line.text, type: line.type || 'command', id }])
    setCurrentLine(prev => prev + 1)
    setCurrentChar(0)
  }, [currentLine, currentChar, lines, loop, typingSpeed])

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [displayedLines, currentChar])

  const currentLineObj = lines[currentLine]
  const isTypingCommand = currentLineObj && (currentLineObj.type === 'command' || !currentLineObj.type) && currentChar > 0

  const cursor = (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 16,
      background: 'var(--t-accent)',
      verticalAlign: 'text-bottom',
      animation: 'blink 1s step-end infinite',
    }} />
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      style={{
        background: 'var(--t-code-bg)',
        border: '1px solid var(--t-border)',
        borderRadius: 12,
        overflow: 'hidden',
        width: '100%',
        maxWidth: 640,
        backdropFilter: 'blur(12px)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        transition: 'background 0.3s, border-color 0.3s, box-shadow 0.3s',
      }}
    >
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--t-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--t-border)' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--t-border)' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--t-border)' }} />
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              fontSize: 11, color: 'var(--t-text-muted)', fontFamily: mono,
              marginLeft: 8, letterSpacing: '0.04em',
            }}
          >{title}</motion.span>
        </AnimatePresence>
      </div>

      <div ref={containerRef} style={{
        padding: 20,
        fontFamily: mono,
        fontSize: 13,
        lineHeight: 1.8,
        height: 274,
        overflowY: 'hidden',
      }}>
        {displayedLines.map((line) => (
          <motion.div
            key={line.id}
            initial={line.type === 'success' ? { opacity: 0, x: -8 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={line.type === 'success' ? { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } : { duration: 0 }}
            style={{
              color: line.type === 'success' ? 'var(--t-success)'
                : line.type === 'comment' ? 'var(--t-text-muted)'
                : line.type === 'command' ? 'var(--t-text)'
                : 'var(--t-text-muted)',
            }}
          >
            {line.type === 'command' && (
              <span style={{ color: 'var(--t-accent)', marginRight: 8 }}>$</span>
            )}
            {line.text}
          </motion.div>
        ))}

        {isTypingCommand && (
          <div style={{ color: 'var(--t-text)' }}>
            <span style={{ color: 'var(--t-accent)', marginRight: 8 }}>$</span>
            {currentLineObj.text.slice(0, currentChar - 1)}
            <span style={{ marginLeft: 1 }}>{cursor}</span>
          </div>
        )}

        {done && !isTypingCommand && currentLine >= lines.length && (
          <motion.div
            key={`done-${idRef.current}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <span style={{ color: 'var(--t-accent)', marginRight: 8 }}>$</span>
            {cursor}
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
