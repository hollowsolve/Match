import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import { CONFIG } from './config'
import { Terminal } from './components/Terminal'
import { ShimmerButton } from './components/ShimmerButton'
import { BorderBeam } from './components/BorderBeam'
import { NumberTicker } from './components/NumberTicker'
import { TextReveal } from './components/TextReveal'
import { GridRipple } from './components/GridRipple'
import { AuroraText } from './components/AuroraText'
import { ThemeToggler } from './components/ThemeToggler'
import { StripedPattern } from './components/StripedPattern'
const DocsLayout = lazy(() => import('./components/DocsLayout').then(m => ({ default: m.DocsLayout })))
const Playground = lazy(() => import('./components/Playground').then(m => ({ default: m.Playground })))

const LIGHT = {
  bg: '#ffffff',
  surface: 'rgba(0,0,0,0.02)',
  surfaceHover: 'rgba(0,0,0,0.04)',
  border: 'rgba(0,0,0,0.08)',
  borderHover: 'rgba(0,0,0,0.2)',
  text: '#09090b',
  textSecondary: '#52525b',
  textMuted: '#71717a',
  textFaint: '#a1a1aa',
  accent: '#09090b',
  accentHover: '#18181b',
  accentMuted: '#3f3f46',
  accentSurface: 'rgba(0, 0, 0, 0.04)',
  accentBorder: 'rgba(0, 0, 0, 0.12)',
  accentBorderHover: 'rgba(0, 0, 0, 0.3)',
  success: '#16a34a',
  mono: "'JetBrains Mono Variable', monospace",
  sans: "'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif",
  radius: 12,
  navBg: 'rgba(255, 255, 255, 0.85)',
  navBgFaded: 'rgba(255, 255, 255, 0.5)',
  navBorderFaded: 'rgba(0,0,0,0.03)',
  codeBg: 'rgba(0,0,0,0.03)',
  codeText: '#27272a',
  installBg: 'rgba(0,0,0,0.03)',
  installBgHover: 'rgba(0,0,0,0.06)',
  heroGlow1: 'rgba(0,0,0,0.03)',
  heroGlow2: 'rgba(0,0,0,0.02)',
  heroGlow3: 'rgba(0,0,0,0.015)',
  rippleColor: 'rgba(0,0,0,0.04)',
  gridRippleColor: 'rgba(0,0,0,0.08)',
  logoFilter: 'invert(1)',
  footerHoverGrad: 'linear-gradient(135deg, #09090b 0%, #3f3f46 50%, #71717a 100%)',
} as const

const DARK = {
  bg: '#06060a',
  surface: 'rgba(255,255,255,0.022)',
  surfaceHover: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.06)',
  borderHover: 'rgba(255,255,255,0.12)',
  text: '#fafafa',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  textFaint: '#52525b',
  accent: '#fafafa',
  accentHover: '#e4e4e7',
  accentMuted: '#a1a1aa',
  accentSurface: 'rgba(255, 255, 255, 0.04)',
  accentBorder: 'rgba(255, 255, 255, 0.1)',
  accentBorderHover: 'rgba(255, 255, 255, 0.25)',
  success: '#4ade80',
  mono: "'JetBrains Mono Variable', monospace",
  sans: "'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif",
  radius: 12,
  navBg: 'rgba(6, 6, 10, 0.85)',
  navBgFaded: 'rgba(6, 6, 10, 0.5)',
  navBorderFaded: 'rgba(255,255,255,0.03)',
  codeBg: 'rgba(0,0,0,0.4)',
  codeText: '#e4e4e7',
  installBg: 'rgba(255,255,255,0.04)',
  installBgHover: 'rgba(255,255,255,0.08)',
  codeBgHover: 'rgba(0,0,0,0.6)',
  heroGlow1: 'rgba(255,255,255,0.025)',
  heroGlow2: 'rgba(255,255,255,0.015)',
  heroGlow3: 'rgba(255,255,255,0.01)',
  rippleColor: 'rgba(255,255,255,0.03)',
  gridRippleColor: 'rgba(255,255,255,0.06)',
  logoFilter: 'none',
  footerHoverGrad: 'linear-gradient(135deg, #fafafa 0%, #a1a1aa 50%, #71717a 100%)',
} as const

type Theme = typeof LIGHT & { codeBgHover?: string }
let T: Theme = LIGHT as any

function FadeIn({ children, delay = 0, className, style }: { children: React.ReactNode; delay?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  )
}

function Nav({ isDark, onToggle, onSearch }: { isDark: boolean; onToggle: () => void; onSearch: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()
  const isDocsPage = location.pathname.startsWith('/docs')

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <>
    <motion.nav
      initial={{ x: '-50%', y: -20, opacity: 0 }}
      animate={{ x: '-50%', y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      style={{
        position: 'fixed', top: 12, left: '50%', zIndex: 100,
        padding: '10px 24px',
        display: 'flex', alignItems: 'center', gap: 32,
        background: scrolled ? T.navBg : T.navBgFaded,
        backdropFilter: 'blur(20px) saturate(180%)',
        border: `1px solid ${scrolled ? T.border : T.navBorderFaded}`,
        borderRadius: 16,
        transition: 'all 0.3s ease',
        maxWidth: 880,
        width: 'calc(100% - 32px)',
      }}
    >
      <Link to="/" style={{
        fontWeight: 700, fontSize: 15, color: T.text,
        letterSpacing: '-0.03em', fontFamily: T.mono,
        textDecoration: 'none',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <img src="/matchlogo.png" alt="" style={{ height: 32, filter: T.logoFilter, transform: 'rotate(90deg)' }} />
        match
      </Link>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <a href="/#features" className="nav-link">Features</a>
        <a href="/#compare" className="nav-link">Compare</a>
        <a href="/#pricing" className="nav-link">Pricing</a>
        <Link to="/docs" className="nav-link" style={{ color: isDocsPage ? T.text : undefined, fontWeight: isDocsPage ? 600 : undefined }}>Docs</Link>
        <Link to="/playground" className="nav-link" style={{ color: location.pathname === '/playground' ? T.text : undefined, fontWeight: location.pathname === '/playground' ? 600 : undefined }}>Playground</Link>
      </div>
      <div style={{ flex: 1 }} />
      <ShimmerButton href="/#pricing" style={{ padding: '7px 18px', fontSize: 12, borderRadius: 8 }}>
        Get a license
      </ShimmerButton>
    </motion.nav>

    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      style={{ position: 'fixed', top: 16, left: 20, zIndex: 100 }}
    >
      <ThemeToggler isDark={isDark} onToggle={onToggle} size={18} />
    </motion.div>

    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      style={{ position: 'fixed', top: 16, right: 20, zIndex: 100 }}
    >
      <button
        onClick={onSearch}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 6, display: 'flex', alignItems: 'center',
          justifyContent: 'center', borderRadius: 8,
          transition: 'background 0.2s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.5" cy="10.5" r="7" stroke={isDark ? '#fafafa' : '#09090b'} />
          <path d="M16 16l5 5" stroke={isDark ? '#fafafa' : '#09090b'} />
        </svg>
      </button>
    </motion.div>
    </>
  )
}

const DEMOS = [
  {
    title: 'match — key=value',
    verb: 'parse.',
    lines: [
      { text: 'cat pair.match', type: 'command' as const },
      { text: 'key: one or more letters', type: 'output' as const, delay: 150 },
      { text: 'value: one or more digits', type: 'output' as const },
      { text: 'pair: key then equals then value', type: 'output' as const },
      { text: '', type: 'output' as const },
      { text: 'echo "name=42" | match-run pair.match', type: 'command' as const, delay: 400 },
      { text: '', type: 'output' as const, delay: 200 },
      { text: '✓ matched in 0.02ms', type: 'success' as const },
      { text: '  key: "name"  value: "42"', type: 'output' as const },
    ],
  },
  {
    title: 'match — csv parser',
    verb: 'match.',
    lines: [
      { text: 'cat csv.match', type: 'command' as const },
      { text: 'field: one or more characters except (comma, newline)', type: 'output' as const, delay: 150 },
      { text: 'row: field joined by comma', type: 'output' as const },
      { text: 'csv: row joined by newline', type: 'output' as const },
      { text: '', type: 'output' as const },
      { text: 'echo "a,b,c\\n1,2,3" | match-run csv.match', type: 'command' as const, delay: 400 },
      { text: '', type: 'output' as const, delay: 200 },
      { text: '✓ matched in 0.03ms', type: 'success' as const },
      { text: '  row[0]: ["a","b","c"]  row[1]: ["1","2","3"]', type: 'output' as const },
    ],
  },
  {
    title: 'match — extract emails',
    verb: 'extract.',
    lines: [
      { text: 'cat email.match', type: 'command' as const },
      { text: 'local: one or more of (letter, digit, period, hyphen)', type: 'output' as const, delay: 150 },
      { text: 'domain: one or more letters then period then one or more letters', type: 'output' as const },
      { text: 'email: extract (local then at then domain)', type: 'output' as const },
      { text: '', type: 'output' as const },
      { text: 'echo "contact dev@match.io today" | match-run email.match', type: 'command' as const, delay: 400 },
      { text: '', type: 'output' as const, delay: 200 },
      { text: '✓ matched in 0.01ms', type: 'success' as const },
      { text: '  extracted: "dev@match.io"', type: 'output' as const },
    ],
  },
  {
    title: 'match — hex colors',
    verb: 'validate.',
    lines: [
      { text: 'cat color.match', type: 'command' as const },
      { text: 'hex: any of ("0" to "9", "a" to "f", "A" to "F")', type: 'output' as const, delay: 150 },
      { text: 'color: hash then 6 hex digits', type: 'output' as const },
      { text: '', type: 'output' as const },
      { text: 'echo "#6366f1" | match-run color.match', type: 'command' as const, delay: 400 },
      { text: '', type: 'output' as const, delay: 200 },
      { text: '✓ matched in 0.01ms', type: 'success' as const },
      { text: '  color: "#6366f1"', type: 'output' as const },
    ],
  },
]

function Hero() {
  const [copied, setCopied] = useState(false)
  const [demoIdx, setDemoIdx] = useState(0)
  const installCmd = `npm i ${CONFIG.npm.packageName}`

  useEffect(() => {
    const interval = setInterval(() => {
      setDemoIdx(prev => (prev + 1) % DEMOS.length)
    }, 12000)
    return () => clearInterval(interval)
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <section style={{
      minHeight: 'calc(85vh)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '120px 24px 48px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, ${T.heroGlow1} 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 20% 80%, ${T.heroGlow2} 0%, transparent 50%),
          radial-gradient(ellipse 60% 40% at 80% 80%, ${T.heroGlow3} 0%, transparent 50%)
        `,
        pointerEvents: 'none',
      }} />


      <div className="hero-grid" style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 64, alignItems: 'center',
        maxWidth: 1200, width: '100%', margin: '0 auto',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            style={{
              fontSize: 'clamp(36px, 4.5vw, 64px)',
              fontWeight: 700, lineHeight: 1.05,
              letterSpacing: '-0.04em',
              color: T.text,
              marginBottom: 24,
            }}
          >
            Describe{' '}
            what you want to{' '}
            <AnimatePresence mode="wait">
              <motion.span
                key={demoIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                style={{ display: 'inline-block' }}
              >
                <AuroraText>{DEMOS[demoIdx].verb}</AuroraText>
              </motion.span>
            </AnimatePresence>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            style={{
              fontSize: 'clamp(15px, 1.8vw, 18px)',
              color: T.textSecondary,
              maxWidth: 460,
              lineHeight: 1.7,
              marginBottom: 40,
            }}
          >
            A pattern matching language that replaces regular expressions.
            Full parse trees, no ReDoS.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
          >
            <button onClick={handleCopy} className="install-btn" style={{ minWidth: 280 }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 12,
                justifyContent: 'center', width: '100%',
              }}>
                <AnimatePresence mode="wait">
                  {copied ? (
                    <motion.span
                      key="copied"
                      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 0, color: T.success, fontFamily: T.mono, fontSize: 13 }}
                    >
                      <motion.svg
                        width="16" height="16" viewBox="0 0 16 16" fill="none"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                      >
                        <circle className="copied-circle" cx="8" cy="8" r="7" stroke={T.success} strokeWidth="1.5" fill="none" />
                        <path className="copied-check" d="M5 8l2 2 4-4" stroke={T.success} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
                  ) : (
                    <motion.span
                      key="cmd"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <span style={{ color: T.textMuted, fontSize: 13, fontFamily: T.mono }}>$</span>
                      <code style={{ fontFamily: T.mono, fontSize: 13, color: T.text }}>
                        {installCmd}
                      </code>
                      <span style={{ fontSize: 13, color: T.textMuted, display: 'flex', alignItems: 'center', marginLeft: 4 }}>⧉</span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </button>
            <motion.a
              href="#pricing"
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 0,
                padding: '12px 24px',
                borderRadius: 10,
                background: T.accent,
                color: T.bg,
                fontWeight: 600, fontSize: 13,
                textDecoration: 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
              className="license-btn"
            >
              Get a license
              <span className="license-arrow" style={{
                display: 'inline-flex', alignItems: 'center',
                width: 0, opacity: 0,
                overflow: 'hidden',
                transition: 'width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.3s ease',
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ marginLeft: 8, flexShrink: 0 }}>
                  <path className="arrow-line" d="M4 9h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path className="arrow-head" d="M10 5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </motion.a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          style={{ width: '100%', position: 'relative' }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.5 }}
            style={{
              position: 'absolute',
              inset: -100,
              borderRadius: 24,
              overflow: 'hidden',
              zIndex: 0,
              maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 20%, transparent 70%)',
            }}>
            <StripedPattern color={T.borderHover} gap={20} strokeWidth={1} />
          </motion.div>
          <div style={{ position: 'relative', zIndex: 1 }}>
          <Terminal
            title={DEMOS[demoIdx].title}
            lines={DEMOS[demoIdx].lines}
            typingSpeed={22}
            loop={false}
          />
          </div>
        </motion.div>
      </div>

    </section>
  )
}

const TILE_WORDS = [
  'digit', 'letter', 'one or more', 'then', 'any of', 'none of',
  'joined by', 'extract', 'optional', 'zero or more', 'or', 'isn\'t',
  'hyphen', 'equals', 'period', 'comma', 'space', 'colon',
  'newline', 'hash', 'slash', 'underscore', 'at', 'bang',
  'backslash', 'hex digit', 'printable', 'visible', 'uppercase',
  'lowercase', 'alphanumeric', 'word character', 'any character',
  'between', 'until', 'including', 'excluding',
  'double quote', 'single quote', 'open paren', 'close paren',
  'asterisk', 'caret', 'tilde', 'pipe', 'semicolon',
]

function PatternTile({ word, delay }: { word: string; delay: number }) {
  const [flipped, setFlipped] = useState(() => Math.random() < 0.3)
  const [inverted, setInverted] = useState(() => Math.random() < 0.25)
  const [rotation, setRotation] = useState(() => Math.random() < 0.3 ? 180 : 0)

  const doRandom = () => {
    const action = Math.random()
    if (action < 0.4) {
      setFlipped(f => !f)
    } else if (action < 0.7) {
      setInverted(v => !v)
    } else {
      const dir = Math.random() < 0.5 ? 90 : -90
      setRotation(r => {
        const next = r + dir
        if (next > 720 || next < -720) return dir
        return next
      })
    }
  }

  useEffect(() => {
    const base = 3000 + Math.random() * 3000
    const interval = setInterval(doRandom, base)
    return () => clearInterval(interval)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.3 }}
      onClick={doRandom}
      style={{
        width: 100, height: 100, flexShrink: 0,
        perspective: 600,
        cursor: 'pointer',
      }}
    >
      <motion.div
        animate={{
          rotateY: flipped ? 180 : 0,
          rotate: rotation,
          background: inverted ? T.text : T.surface,
          color: inverted ? T.bg : T.textMuted,
          borderColor: inverted ? T.text : T.border,
        }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{
          width: '100%', height: '100%',
          borderRadius: 14,
          border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 10,
          fontFamily: T.mono, fontSize: 12.5,
          textAlign: 'center', lineHeight: 1.3,
          backfaceVisibility: 'hidden',
        }}
      >
        <span style={{ transform: flipped ? 'scaleX(-1)' : 'none', transition: 'transform 0.6s' }}>
          {word}
        </span>
      </motion.div>
    </motion.div>
  )
}

const TILE_SIZE = 100
const TILE_GAP = 8

function PatternStrip() {
  const row = useMemo(() => [...TILE_WORDS].sort(() => Math.random() - 0.5), [])
  const copyWidth = row.length * (TILE_SIZE + TILE_GAP)

  return (
    <section style={{
      padding: '8px 0',
      borderTop: `1px solid ${T.border}`,
      borderBottom: `1px solid ${T.border}`,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 80,
        background: `linear-gradient(to right, ${T.bg}, transparent)`,
        zIndex: 1, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 80,
        background: `linear-gradient(to left, ${T.bg}, transparent)`,
        zIndex: 1, pointerEvents: 'none',
      }} />
      <div style={{
        display: 'flex', gap: TILE_GAP,
        width: 'max-content',
        animation: `tile-marquee ${row.length * 1.2}s linear infinite`,
      }}>
        {[...row, ...row].map((word, i) => (
          <PatternTile key={i} word={word} delay={0} />
        ))}
      </div>
      <style>{`
        @keyframes tile-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-${copyWidth}px); }
        }
      `}</style>
    </section>
  )
}

function Features() {
  const features = [
    {
      keyword: 'Readable',
      desc: 'Every pattern reads like a sentence. No escape sequences exist in the language.',
      code: `visible except (double quote, backslash)`,
      accent: T.text,
    },
    {
      keyword: 'Composable',
      desc: 'Rules reference rules. Build complex parsers from simple, reusable pieces.',
      code: `field: one or more characters except (comma, newline)\nrow: field joined by comma\ncsv: row joined by newline`,
      accent: T.text,
    },
    {
      keyword: 'Diagnostic',
      desc: 'Not "no match." Every failure returns byte offset, expected set, and full rule stack.',
      code: `match failed at byte 47 (line 3, col 12):\n  expected: digit, hyphen, or end of input\n  found: "x" (0x78)\n  in: forwarded > element > param`,
      accent: T.text,
    },
    {
      keyword: 'Predictable',
      desc: 'PEG ordered choice. First match wins. No ambiguity, no surprises.',
      code: `-- Regex: (a+)+$ on "aaaaX" → catastrophic\n-- Match: ordered choice, linear per alternative`,
      accent: T.text,
    },
    {
      keyword: 'Extract',
      desc: 'Pull out the parts you care about. Nested captures just work.',
      code: `num: one or more digits\nmain: "value=" then extract num\n-- result.extracted[0].text === "42"`,
      accent: T.text,
    },
  ]

  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)
  const [inView, setInView] = useState(false)
  const [paused, setPaused] = useState(false)
  const [navTick, setNavTick] = useState(0)
  const savedProgress = useRef(0)
  const sectionRef = useRef<HTMLDivElement>(null)
  const CYCLE_MS = 5000

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || paused) return
    const start = Date.now()
    const baseIdx = active
    const baseOffset = savedProgress.current * CYCLE_MS
    let raf: number
    const tick = () => {
      const elapsed = Date.now() - start + baseOffset
      const cycle = elapsed % (CYCLE_MS * features.length)
      const idx = (baseIdx + Math.floor(cycle / CYCLE_MS)) % features.length
      const pct = (cycle % CYCLE_MS) / CYCLE_MS
      setActive(idx)
      setProgress(pct)
      savedProgress.current = pct
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, features.length, paused, navTick])

  const manualNav = (idx: number) => {
    setActive(idx)
    setProgress(0)
    savedProgress.current = 0
    setNavTick(t => t + 1)
  }

  const goPrev = () => manualNav((active - 1 + features.length) % features.length)
  const goNext = () => manualNav((active + 1) % features.length)

  const f = features[active]

  return (
    <section ref={sectionRef} id="features" style={{ padding: '128px 24px', maxWidth: 1080, margin: '0 auto' }}>
      <FadeIn>
        <p style={{
          textAlign: 'center', fontSize: 12, fontFamily: T.mono,
          color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 16,
        }}>
          Features
        </p>
        <h2 className="section-heading">Built different</h2>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div style={{
          marginTop: 64,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1,
          background: T.border,
          borderRadius: T.radius,
          overflow: 'hidden',
          minHeight: 400,
          position: 'relative',
          cursor: 'pointer',
        }} onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          setPaused(!paused)
        }}>
          <button onClick={() => setPaused(!paused)} className="feature-nav-btn" style={{
            position: 'absolute', top: 12, right: 12, zIndex: 3,
            width: 36, height: 36, borderRadius: '50%',
            border: 'none', background: T.text,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', padding: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <AnimatePresence mode="wait">
                {paused ? (
                  <motion.path
                    key="play"
                    d="M4 2.5l10 5.5-10 5.5z"
                    fill={T.bg}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.15 }}
                  />
                ) : (
                  <motion.g
                    key="pause"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.15 }}
                  >
                    <rect x="2.5" y="2" width="4" height="12" rx="1" fill={T.bg} />
                    <rect x="9.5" y="2" width="4" height="12" rx="1" fill={T.bg} />
                  </motion.g>
                )}
              </AnimatePresence>
            </svg>
          </button>
          <div style={{
            background: T.bg,
            padding: '48px 48px 48px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
              background: T.border,
            }}>
              <motion.div
                key={active}
                initial={{ height: '0%' }}
                animate={{ height: `${progress * 100}%` }}
                transition={{ duration: 0.05, ease: 'linear' }}
                style={{
                  width: '100%',
                  background: f.accent,
                  borderRadius: 2,
                }}
              />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <div style={{
                  fontSize: 'clamp(48px, 5vw, 72px)',
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                  color: f.accent,
                  marginBottom: 20,
                  fontFamily: T.sans,
                }}>
                  {f.keyword}
                </div>
                <p style={{
                  fontSize: 16,
                  color: T.textSecondary,
                  lineHeight: 1.7,
                  maxWidth: 380,
                }}>
                  {f.desc}
                </p>
              </motion.div>
            </AnimatePresence>

          </div>

          <div style={{
            background: T.codeBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            position: 'relative',
          }}>
            <div style={{
              width: '100%',
              background: T.bg,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 14px',
                borderBottom: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.border }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.border }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.border }} />
                </div>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={active}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.04em' }}
                  >
                    {f.keyword.toLowerCase()}.match
                  </motion.span>
                </AnimatePresence>
              </div>
              <div style={{ padding: '16px 20px', minHeight: 120 }}>
                <AnimatePresence mode="wait">
                  <motion.pre
                    key={active}
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    transition={{ duration: 0.3 }}
                    style={{
                      fontFamily: T.mono,
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: T.codeText,
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                    }}
                  >
                    {f.code}
                  </motion.pre>
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>

        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center',
          marginTop: 20,
        }}>
          <button onClick={goPrev} className="feature-nav-btn" style={{
            width: 32, height: 32, borderRadius: 6,
            border: `1px solid ${T.borderHover}`, background: T.surface,
            color: T.text, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', padding: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {features.map((feat, i) => (
            <button
              key={i}
              onClick={() => manualNav(i)}
              style={{
                width: 32, height: 32,
                borderRadius: 6,
                border: `1px solid ${i === active ? feat.accent : i < active ? T.textMuted : T.border}`,
                cursor: 'pointer',
                background: i === active ? feat.accent : i < active ? T.textMuted : T.surface,
                opacity: i === active ? 1 : i < active ? 0.35 : 0.5,
                transition: 'all 0.3s',
                padding: 0,
              }}
            />
          ))}
          <button onClick={goNext} className="feature-nav-btn" style={{
            width: 32, height: 32, borderRadius: 6,
            border: `1px solid ${T.borderHover}`, background: T.surface,
            color: T.text, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', padding: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </FadeIn>
    </section>
  )
}

function Metrics() {
  return (
    <section style={{ padding: '96px 24px', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${T.heroGlow2} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <FadeIn>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1, maxWidth: 960, margin: '0 auto',
          background: T.border, borderRadius: T.radius, overflow: 'hidden',
        }}>
          {[
            { value: 333, label: 'Tests passing', suffix: '' },
            { value: 0, label: 'Dependencies', suffix: '', prefix: '' },
            { value: 100, label: 'Coverage', suffix: '%' },
            { value: 1, label: 'npm install', suffix: '', prefix: '' },
          ].map((m, i) => (
            <div key={m.label} style={{
              padding: '40px 24px',
              textAlign: 'center',
              background: T.bg,
            }}>
              <div style={{
                fontSize: 'clamp(32px, 4vw, 48px)',
                fontWeight: 700,
                color: T.text,
                letterSpacing: '-0.03em',
                fontFamily: T.mono,
              }}>
                <NumberTicker value={m.value} prefix={m.prefix} suffix={m.suffix} />
              </div>
              <div style={{
                fontSize: 12, color: T.textMuted, marginTop: 8,
                fontFamily: T.mono, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </FadeIn>
    </section>
  )
}

function Compare() {
  const [expanded, setExpanded] = useState(false)

  const regexCompact = "(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|\"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*\")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])"

  const regexExpanded = [
    "(?:                                  # local part",
    "  [a-z0-9!#$%&'*+/=?^_`{|}~-]+      #   atom",
    "  (?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)* #   dot-atom",
    "|                                    # or",
    '  "(?:                               #   quoted string',
    "    [\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f     #     qtext",
    "     \\x21\\x23-\\x5b\\x5d-\\x7f]",
    "  | \\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f] #     quoted-pair",
    '  )*"',
    ")",
    "@ (?:                                # domain",
    "  (?:[a-z0-9]                        #   label",
    "     (?:[a-z0-9-]*[a-z0-9])?\\.       #   dot",
    "  )+ [a-z0-9](?:[a-z0-9-]*[a-z0-9])?#   TLD",
    "|                                    # or",
    "  \\[(?:                              #   IP literal",
    "    (?:25[0-5]|2[0-4][0-9]           #     250-255 / 200-249",
    "      |[01]?[0-9][0-9]?)\\.           #     0-199",
    "  ){3}",
    "  (?:25[0-5]|2[0-4][0-9]            #     last octet",
    "    |[01]?[0-9][0-9]?",
    "    |[a-z0-9-]*[a-z0-9]:            #     general addr",
    "      (?:[\\x01-\\x08\\x0b\\x0c",
    "          \\x0e-\\x1f\\x21-\\x5a",
    "          \\x53-\\x7f]",
    "       |\\\\[\\x01-\\x09\\x0b\\x0c",
    "           \\x0e-\\x7f])+",
    "  )\\]",
    ")",
  ].join("\n")

  return (
    <section id="compare" style={{ padding: '128px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <FadeIn>
        <p style={{
          textAlign: 'center', fontSize: 12, fontFamily: T.mono,
          color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 16,
        }}>
          Comparison
        </p>
        <h2 className="section-heading">Same parser.<br />Only one is readable.</h2>
        <p style={{ textAlign: 'center', color: T.textSecondary, fontSize: 15, marginTop: 16, marginBottom: 48 }}>
          Validate an email address — side by side.
        </p>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gap: 1, maxWidth: 1200, margin: '0 auto',
          background: T.border, borderRadius: T.radius, overflow: 'hidden',
        }}>
          <div style={{ background: T.bg, padding: 0 }}>
            <div style={{
              padding: '12px 20px',
              borderBottom: `1px solid ${T.border}`,
              fontSize: 11, color: T.textMuted, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              fontFamily: T.mono,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>regex</span>
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 10, color: T.textFaint, fontFamily: T.mono,
                  letterSpacing: '0.04em', padding: '2px 0',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = T.textSecondary)}
                onMouseLeave={e => (e.currentTarget.style.color = T.textFaint)}
              >
                {expanded ? 'compact' : 'expand'}
              </button>
            </div>
            <div style={{ position: 'relative', overflow: 'hidden' }}>
              <AnimatePresence mode="wait">
                <motion.pre
                  key={expanded ? 'expanded' : 'compact'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    padding: 20, margin: 0,
                    fontSize: 12.5, fontFamily: T.mono,
                    color: T.textSecondary,
                    lineHeight: expanded ? 1.8 : 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >{expanded ? regexExpanded : regexCompact}</motion.pre>
              </AnimatePresence>
            </div>
          </div>

          <div style={{ background: T.bg, padding: 0 }}>
            <div style={{
              padding: '12px 20px',
              borderBottom: `1px solid ${T.border}`,
              fontSize: 11, color: T.accent, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              fontFamily: T.mono,
            }}>match</div>
            <pre style={{
              padding: 20, margin: 0,
              fontSize: 12.5, fontFamily: T.mono,
              color: T.codeText, lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}>{`atext: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, slash, equals, question, caret, underscore, backtick, open brace, pipe, close brace, tilde, hyphen)
dotted: one or more atext joined by period
qtext: any of (printable except (double quote, backslash), space, tab)
qpair: backslash then printable
quoted: double quote then zero or more (qtext or qpair) then double quote
local: dotted or quoted
label: one or more of (letter, digit, hyphen)
hostname: label joined by period
octet: between 1 and 3 digits
addr: octet joined by period
ip literal: open bracket then addr then close bracket
domain: hostname or ip literal
email: local then at then domain`}</pre>
          </div>
        </div>
      </FadeIn>

    </section>
  )
}

const TERMINAL_ICON = <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
const AGENT_ICON = <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="10" cy="6" r="1" fill="currentColor" /><path d="M5 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M8 10v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>

const QS_AGENT_PROMPT = `Install @hollowsolve/match, then set up the Match skill:

1. npm install @hollowsolve/match
2. mkdir -p .match
3. curl -o .match/match_skill.md https://matchlang.com/match_skill.md
4. Create .match/grammars.md with this content:

# Project Grammars

> Match syntax reference is at .match/match_skill.md

Add reusable grammars for this project below.

---`

function CopyBlock({ code, label, icon }: { code: string; label: string; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div
      onClick={handleCopy}
      style={{
        background: T.codeBg,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={{
        padding: '8px 14px',
        borderBottom: `1px solid ${T.border}`,
        fontSize: 10, color: T.textFaint, fontWeight: 500,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        fontFamily: T.mono,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>{icon}{label}</div>
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <pre style={{
          padding: 16, margin: 0, fontSize: 12.5, lineHeight: 1.7,
          fontFamily: T.mono, color: T.text, overflow: 'auto',
          opacity: copied ? 0 : 1,
          transition: 'opacity 0.1s',
        }}>{code}</pre>
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
                background: T.codeBg,
              }}
            >
              <motion.span
                style={{ display: 'flex', alignItems: 'center', gap: 0, color: T.success, fontFamily: T.mono, fontSize: 13 }}
              >
                <motion.svg
                  width="16" height="16" viewBox="0 0 16 16" fill="none"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <circle cx="8" cy="8" r="7" stroke={T.success} strokeWidth="1.5" fill="none" />
                  <path d="M5 8l2 2 4-4" stroke={T.success} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

function QuickStart() {
  const [installTab, setInstallTab] = useState<'manual' | 'agent'>('manual')

  const manualSteps = [
    {
      n: 2,
      title: 'Write a grammar',
      code: `key: one or more letters\nvalue: one or more digits\npair: key then equals then value`,
      lang: 'grammar',
    },
    {
      n: 3,
      title: 'Run it',
      code: `import { run } from '${CONFIG.npm.packageName}'\n\nconst result = run(\`\n  key: one or more letters\n  value: one or more digits\n  pair: key then equals then value\n\`, 'name=42')\n\nconsole.log(result.matched) // true\nconsole.log(result.tree.children) // [key:"name", value:"42"]`,
      lang: 'app.ts',
    },
  ]

  const agentSteps = [
    {
      n: 2,
      title: 'Try it',
      code: `Write a Match grammar that parses something interesting in this project, and run it to show the parse tree.`,
      lang: 'paste into agent',
      icon: AGENT_ICON,
    },
  ]

  const steps = installTab === 'manual' ? manualSteps : agentSteps

  return (
    <section style={{ padding: '128px 24px', maxWidth: 640, margin: '0 auto' }}>
      <FadeIn>
        <p style={{
          textAlign: 'center', fontSize: 12, fontFamily: T.mono,
          color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 16,
        }}>
          Quick start
        </p>
        <h2 className="section-heading">Running in 2 minutes</h2>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <div style={{
            display: 'inline-flex', borderRadius: 8,
            border: `1px solid ${T.border}`, overflow: 'hidden',
          }}>
            {([
              { key: 'manual' as const, label: 'Terminal', icon: TERMINAL_ICON },
              { key: 'agent' as const, label: 'AI Agent', icon: AGENT_ICON },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setInstallTab(t.key)}
                style={{
                  padding: '6px 14px',
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', fontFamily: T.mono,
                  border: 'none', cursor: 'pointer',
                  background: installTab === t.key ? T.accent : 'transparent',
                  color: installTab === t.key ? T.bg : T.textMuted,
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'all 0.15s',
                  borderRight: t.key === 'manual' ? `1px solid ${T.border}` : 'none',
                }}
              >{t.icon}{t.label}</button>
            ))}
          </div>
        </div>
      </FadeIn>

      <div style={{ marginTop: 48, position: 'relative' }}>
        <div style={{
          position: 'absolute',
          left: 19,
          top: 0,
          bottom: 0,
          width: 1,
          background: `linear-gradient(to bottom, ${T.accent}30, ${T.border}, transparent)`,
        }} />

        <FadeIn>
          <div style={{ position: 'relative', paddingLeft: 52, marginBottom: 48 }}>
            <div style={{
              position: 'absolute', left: 8, top: 0,
              width: 24, height: 24, borderRadius: 8,
              background: T.accentSurface,
              border: `1px solid ${T.accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, color: T.accentMuted, fontFamily: T.mono,
              zIndex: 1,
            }}>1</div>

            <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 12 }}>
              Install
            </div>

            <AnimatePresence mode="wait">
              {installTab === 'manual' ? (
                <motion.div
                  key="manual"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  <CopyBlock code={`npm install ${CONFIG.npm.packageName}`} label="terminal" icon={TERMINAL_ICON} />
                </motion.div>
              ) : (
                <motion.div
                  key="agent"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  <CopyBlock code={QS_AGENT_PROMPT} label="paste into agent" icon={AGENT_ICON} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FadeIn>

        <AnimatePresence mode="wait">
          <motion.div
            key={installTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {steps.map((step, i) => (
              <div key={step.n} style={{ position: 'relative', paddingLeft: 52, marginBottom: i < steps.length - 1 ? 48 : 0 }}>
                <div style={{
                  position: 'absolute', left: 8, top: 0,
                  width: 24, height: 24, borderRadius: 8,
                  background: T.accentSurface,
                  border: `1px solid ${T.accentBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, color: T.accentMuted, fontFamily: T.mono,
                  zIndex: 1,
                }}>{step.n}</div>

                <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 12 }}>
                  {step.title}
                </div>

                <CopyBlock code={step.code} label={step.lang} icon={'icon' in step ? step.icon : undefined} />
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

const COMPANY_TIERS = [
  { seats: 10, price: 499 },
  { seats: 25, price: 999 },
  { seats: 50, price: 1799 },
  { seats: 100, price: 2999 },
  { seats: 500, price: 9999 },
  { seats: 1000, price: 14999 },
  { seats: Infinity, price: 24999, label: 'Unlimited' },
]

function PersonalCard() {
  const [activated, setActivated] = useState(false)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (activated) return
    setActivated(true)
  }

  const t = '0.5s cubic-bezier(0.22, 1, 0.36, 1)'

  return (
    <BorderBeam beamColor={T.accent} duration={activated ? 2 : 5}>
      <div style={{
        padding: 32,
        background: T.surface,
        borderRadius: T.radius,
        position: 'relative',
      }}>
        <div style={{
          fontSize: 12, color: T.accentMuted, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16,
          fontFamily: T.mono,
          textAlign: activated ? 'center' : 'left',
          transition: `text-align ${t}`,
        }}>
          <span style={{
            display: 'inline-block',
            transition: `transform ${t}`,
          }}>Personal</span>
        </div>
        <div style={{
          fontSize: 44, fontWeight: 700, color: T.text, letterSpacing: '-0.03em',
          position: 'relative', overflow: 'hidden',
          height: 53,
        }}>
          <span style={{
            display: 'block',
            transition: `transform ${t}, opacity ${t}`,
            transform: activated ? 'translateY(-100%)' : 'translateY(0)',
            opacity: activated ? 0 : 1,
          }}>$99</span>
          <span style={{
            display: 'block',
            position: 'absolute', top: 0, left: 0, right: 0,
            transition: `transform ${t}, opacity ${t}`,
            transform: activated ? 'translateY(0)' : 'translateY(100%)',
            opacity: activated ? 1 : 0,
            textAlign: activated ? 'center' : 'left',
          }}>Thanks!</span>
        </div>
        <div style={{
          color: T.textMuted, fontSize: 13, marginBottom: 32, fontFamily: T.mono,
          position: 'relative', overflow: 'hidden',
          height: 20,
        }}>
          <span style={{
            display: 'block',
            transition: `transform ${t}, opacity ${t}`,
            transform: activated ? 'translateY(-100%)' : 'translateY(0)',
            opacity: activated ? 0 : 1,
          }}>one-time, yours forever</span>
          <span style={{
            display: 'block',
            position: 'absolute', top: 0, left: 0, right: 0,
            transition: `transform ${t}, opacity ${t}`,
            transform: activated ? 'translateY(0)' : 'translateY(100%)',
            opacity: activated ? 1 : 0,
            textAlign: activated ? 'center' : 'left',
          }}>enjoy your purchase :)</span>
        </div>
        <ul style={{
          textAlign: 'left', listStyle: 'none', padding: 0, margin: '0 0 32px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {[
            'Any personal project',
            'Commercial side projects',
            'Lifetime updates',
            'Priority support',
          ].map(item => (
            <li key={item} style={{
              fontSize: 13, color: T.textSecondary,
              display: 'flex', alignItems: 'baseline', gap: 10,
            }}>
              <span style={{ color: T.accentMuted, fontSize: 9 }}>&#9670;</span>
              {item}
            </li>
          ))}
        </ul>
        <ShimmerButton
          onClick={!activated ? handleClick : undefined}
          href={activated ? CONFIG.polar.personalCheckout : undefined}
          style={{ width: '100%', textAlign: 'center', display: 'block', padding: '14px 24px' }}
        >
          {activated ? 'Continue to checkout' : 'Buy license'}
        </ShimmerButton>
        {activated && (
          <button
            onClick={() => setActivated(false)}
            style={{
              position: 'absolute', top: 12, left: 12,
              width: 28, height: 28, borderRadius: 6,
              background: 'none', border: `1px solid ${T.border}`,
              color: T.textMuted, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, transition: 'border-color 0.2s, color 0.2s',
            }}
            className="ghost-btn"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </BorderBeam>
  )
}

function Pricing() {
  const [tierIdx, setTierIdx] = useState(0)
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const tier = COMPANY_TIERS[tierIdx]

  useEffect(() => {
    if (!dropOpen) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropOpen])

  return (
    <section id="pricing" style={{
      padding: '128px 24px',
      maxWidth: 960, margin: '0 auto',
      position: 'relative',
    }}>
      <FadeIn>
        <p style={{
          textAlign: 'center', fontSize: 12, fontFamily: T.mono,
          color: T.accent, letterSpacing: '0.1em', textTransform: 'uppercase',
          fontWeight: 600, marginBottom: 16,
        }}>
          Pricing
        </p>
        <h2 className="section-heading">Simple, honest pricing</h2>
        <p style={{ textAlign: 'center', color: T.textSecondary, fontSize: 15, marginTop: 16, marginBottom: 64 }}>
          Free for personal, educational, and open-source use.
        </p>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 20, maxWidth: 960, margin: '0 auto',
        }}>
          <div className="pricing-card" style={{
            padding: 32,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.radius,
          }}>
            <div style={{
              fontSize: 12, color: T.textMuted, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16,
              fontFamily: T.mono,
            }}>Open Source</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: T.text, letterSpacing: '-0.03em' }}>
              Free
            </div>
            <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 32, fontFamily: T.mono }}>forever</div>
            <ul style={{
              textAlign: 'left', listStyle: 'none', padding: 0, margin: '0 0 32px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {[
                'Open-source projects',
                'Educational use',
                'Community support',
                'Full feature set',
              ].map(item => (
                <li key={item} style={{
                  fontSize: 13, color: T.textSecondary,
                  display: 'flex', alignItems: 'baseline', gap: 10,
                }}>
                  <span style={{ color: T.textFaint, fontSize: 9 }}>◆</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link to="/docs" className="ghost-btn" style={{
              display: 'block', width: '100%', textAlign: 'center',
              padding: '14px 24px', borderRadius: 10,
              border: `1px solid ${T.border}`,
              color: T.textSecondary, fontWeight: 600, fontSize: 14,
              textDecoration: 'none', transition: 'all 0.2s',
            }}>
              Get started
            </Link>
          </div>

          <PersonalCard />

          <div className="pricing-card" style={{
            padding: 32,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.radius,
            position: 'relative',
          }}>
            <div ref={dropRef} style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
              <button
                onClick={() => setDropOpen(!dropOpen)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: T.surface,
                  border: `1px solid ${dropOpen ? T.borderHover : T.border}`,
                  borderRadius: 8,
                  padding: '5px 10px 5px 12px',
                  fontSize: 11,
                  fontFamily: T.mono,
                  fontWeight: 600,
                  color: T.text,
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              >
                {tier.label || tier.seats} seats
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{
                  transition: 'transform 0.2s',
                  transform: dropOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}>
                  <path d="M2.5 4L5 6.5L7.5 4" stroke={T.textMuted} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <AnimatePresence>
                {dropOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 4, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                    style={{
                      position: 'absolute', top: '100%', right: 0,
                      background: T.bg,
                      border: `1px solid ${T.border}`,
                      borderRadius: 10,
                      padding: 4,
                      minWidth: 140,
                      boxShadow: `0 8px 32px ${T.accent}10, 0 2px 8px rgba(0,0,0,0.08)`,
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {COMPANY_TIERS.map((t, i) => (
                      <button
                        key={t.seats}
                        onClick={() => { setTierIdx(i); setDropOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          width: '100%',
                          padding: '7px 12px',
                          border: 'none',
                          borderRadius: 6,
                          background: i === tierIdx ? T.accentSurface : 'transparent',
                          color: i === tierIdx ? T.text : T.textSecondary,
                          fontSize: 12,
                          fontFamily: T.mono,
                          fontWeight: i === tierIdx ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'background 0.15s, color 0.15s',
                          textAlign: 'left',
                        }}
                        className="seat-option"
                      >
                        <span>{t.label || t.seats} seats</span>
                        {i === tierIdx && <span style={{ fontSize: 10, color: T.accent }}>&#10003;</span>}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div style={{
              fontSize: 12, color: T.textMuted, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16,
              fontFamily: T.mono,
            }}>Company</div>
            <AnimatePresence mode="wait">
              <motion.div
                key={tierIdx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <div style={{ fontSize: 44, fontWeight: 700, color: T.text, letterSpacing: '-0.03em' }}>
                  ${tier.price.toLocaleString()}
                </div>
                <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 32, fontFamily: T.mono }}>
                  {tier.label ? 'unlimited seats, one-time' : `up to ${tier.seats} seats, one-time`}
                </div>
              </motion.div>
            </AnimatePresence>

            <ul style={{
              textAlign: 'left', listStyle: 'none', padding: 0, margin: '0 0 32px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {[
                'Organization-wide license',
                'Unlimited commercial products',
                'Lifetime updates',
                'Priority support + SLA',
              ].map(item => (
                <li key={item} style={{
                  fontSize: 13, color: T.textSecondary,
                  display: 'flex', alignItems: 'baseline', gap: 10,
                }}>
                  <span style={{ color: T.textFaint, fontSize: 9 }}>◆</span>
                  {item}
                </li>
              ))}
            </ul>
            <a
              href={CONFIG.polar.companyCheckout[tier.seats]}
              className="ghost-btn"
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                padding: '14px 24px', borderRadius: 10,
                border: `1px solid ${T.border}`,
                color: T.textSecondary, fontWeight: 600, fontSize: 14,
                textDecoration: 'none', transition: 'all 0.2s',
              }}
            >
              Buy license
            </a>
          </div>
        </div>
      </FadeIn>
    </section>
  )
}

function CTASection() {
  return (
    <section style={{
      padding: '128px 24px',
      position: 'relative',
      overflow: 'hidden',
      textAlign: 'center',
    }}>
      <GridRipple cellSize={40} color={T.gridRippleColor} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 600, margin: '0 auto' }}>
        <TextReveal
          text="Stop debugging regex. Start describing what you want."
          style={{
            fontSize: 'clamp(28px, 4vw, 44px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.2,
            color: T.text,
            justifyContent: 'center',
            marginBottom: 32,
          }}
        />

        <FadeIn delay={0.2}>
          <p style={{ color: T.textSecondary, fontSize: 16, marginBottom: 40, lineHeight: 1.7 }}>
            Match is a complete regex replacement. Readable grammars.
            Linear-time parsing. Zero dependencies.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={CONFIG.github.repoUrl} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '14px 32px',
              background: 'transparent',
              color: T.textSecondary,
              borderRadius: 10,
              fontWeight: 600, fontSize: 14,
              border: `1px solid ${T.border}`,
              textDecoration: 'none',
              transition: 'all 0.2s',
            }} className="ghost-btn">
              View on GitHub
            </a>
            <ShimmerButton href="#pricing">
              Get a license
            </ShimmerButton>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer style={{
      padding: '48px 24px',
      borderTop: `1px solid ${T.border}`,
      maxWidth: 960, margin: '0 auto',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 16,
      }}>
        <span className="footer-brand" style={{
          fontSize: 14, color: T.textFaint, fontFamily: T.mono,
          letterSpacing: '-0.02em',
          backgroundImage: `linear-gradient(90deg, ${T.textMuted} 0%, ${T.textMuted} 100%)`,
          backgroundSize: '100% 100%',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          transition: 'all 0.4s ease',
        }}>
          match by <a href="https://hollowsolve.com" target="_blank" rel="noopener noreferrer" style={{ WebkitTextFillColor: T.accent, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'transparent', transition: 'text-decoration-color 0.2s' }} onMouseEnter={e => e.currentTarget.style.textDecorationColor = T.accent} onMouseLeave={e => e.currentTarget.style.textDecorationColor = 'transparent'}>hollowsolve</a>
        </span>
        <div style={{ display: 'flex', gap: 24 }}>
          <a href={CONFIG.github.repoUrl} className="nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href={CONFIG.discord.inviteUrl} className="nav-link" target="_blank" rel="noopener noreferrer">Discord</a>
          <a href={`https://www.npmjs.com/package/${CONFIG.npm.packageName}`} className="nav-link" target="_blank" rel="noopener noreferrer">npm</a>
        </div>
      </div>
    </footer>
  )
}

const CMD_ITEMS: { label: string; section: string; path: string; keywords?: string }[] = [
  { label: 'Installation', section: 'Getting Started', path: '/docs/getting-started/installation', keywords: 'install npm setup import require' },
  { label: 'Your First Grammar', section: 'Getting Started', path: '/docs/getting-started/first-grammar', keywords: 'tutorial date parser compose quick start hello begin' },
  { label: 'Rules', section: 'Language', path: '/docs/language/rules', keywords: 'rule name entry point left recursion continuation indent' },
  { label: 'Characters', section: 'Language', path: '/docs/language/characters', keywords: 'hyphen dash period dot comma colon semicolon slash backslash at hash dollar percent ampersand asterisk plus equals pipe tilde caret underscore backtick exclamation question quote paren bracket brace space tab newline null byte' },
  { label: 'Character Classes', section: 'Language', path: '/docs/language/classes', keywords: 'letter digit uppercase lowercase hex whitespace visible printable alphanumeric word character any character' },
  { label: 'Text Blocks', section: 'Language', path: '/docs/language/text-blocks', keywords: 'begin end literal string multi-character' },
  { label: 'Sequences & Alternation', section: 'Language', path: '/docs/language/sequences', keywords: 'then or sequence alternation ordered choice' },
  { label: 'Repetition', section: 'Language', path: '/docs/language/repetition', keywords: 'one or more zero or more optional between repeat greedy' },
  { label: 'Sets', section: 'Language', path: '/docs/language/sets', keywords: 'any of none of except range to' },
  { label: 'Negation', section: 'Language', path: '/docs/language/negation', keywords: "isn't isnt not negate" },
  { label: 'Until', section: 'Language', path: '/docs/language/until', keywords: 'until including excluding consume terminator' },
  { label: 'Extract', section: 'Language', path: '/docs/language/extract', keywords: 'extract pull capture extracted' },
  { label: 'Joined By', section: 'Language', path: '/docs/language/joined-by', keywords: 'joined by separator list lenient trailing' },
  { label: 'Precedence', section: 'Language', path: '/docs/language/precedence', keywords: 'binding order priority parentheses grouping' },
  { label: 'Comments', section: 'Language', path: '/docs/language/comments', keywords: '-- comment inline' },
  { label: 'Unicode & Bytes', section: 'Language', path: '/docs/language/unicode', keywords: 'utf-8 codepoint ascii byte range unicode' },
  { label: 'run', section: 'API', path: '/docs/api/run', keywords: 'run match result' },
  { label: 'parse & match', section: 'API', path: '/docs/api/parse-match', keywords: 'parse match compile program reuse' },
  { label: 'find', section: 'API', path: '/docs/api/find', keywords: 'find search all matches' },
  { label: 'tryParse', section: 'API', path: '/docs/api/try-parse', keywords: 'tryParse partial tree failure diagnostic' },
  { label: 'Search', section: 'API', path: '/docs/api/search', keywords: 'searchString searchFile searchFolder stream grep' },
  { label: 'Diagnostics', section: 'API', path: '/docs/api/diagnostics', keywords: 'formatFailure formatTree error message' },
  { label: 'Types', section: 'API', path: '/docs/api/types', keywords: 'MatchResult MatchSuccess MatchFailure RuleMatch PartialResult MatchProgram FindMatch interface type' },
  { label: 'Key-Value Parser', section: 'Examples', path: '/docs/examples/key-value' },
  { label: 'CSV Parser', section: 'Examples', path: '/docs/examples/csv' },
  { label: 'Email Extractor', section: 'Examples', path: '/docs/examples/email' },
  { label: 'JSON Subset', section: 'Examples', path: '/docs/examples/json' },
  { label: 'RFC 7239 Forwarded', section: 'Examples', path: '/docs/examples/rfc7239', keywords: 'http header forwarded proxy' },
  { label: 'Log Search', section: 'Examples', path: '/docs/examples/log-search', keywords: 'log grep search stream' },
  { label: 'CLI', section: 'Docs', path: '/docs/cli', keywords: 'command line terminal npx' },
  { label: 'Playground', section: 'Navigation', path: '/playground', keywords: 'test try playground editor live' },
  { label: 'Home', section: 'Navigation', path: '/' },

  { label: 'then', section: 'Keywords', path: '/docs/language/sequences', keywords: 'sequence' },
  { label: 'or', section: 'Keywords', path: '/docs/language/sequences', keywords: 'alternation choice' },
  { label: 'one or more', section: 'Keywords', path: '/docs/language/repetition', keywords: 'repeat greedy plus' },
  { label: 'zero or more', section: 'Keywords', path: '/docs/language/repetition', keywords: 'repeat greedy star' },
  { label: 'optional', section: 'Keywords', path: '/docs/language/repetition', keywords: 'maybe zero or one' },
  { label: 'between', section: 'Keywords', path: '/docs/language/repetition', keywords: 'range count' },
  { label: 'any of', section: 'Keywords', path: '/docs/language/sets', keywords: 'set union' },
  { label: 'none of', section: 'Keywords', path: '/docs/language/sets', keywords: 'set negation' },
  { label: 'except', section: 'Keywords', path: '/docs/language/sets', keywords: 'exclude narrow' },
  { label: 'characters except', section: 'Keywords', path: '/docs/language/sets', keywords: 'negated set quantified' },
  { label: "isn't", section: 'Keywords', path: '/docs/language/negation', keywords: 'isnt negate not' },
  { label: 'until including', section: 'Keywords', path: '/docs/language/until', keywords: 'consume terminator' },
  { label: 'until excluding', section: 'Keywords', path: '/docs/language/until', keywords: 'stop before terminator' },
  { label: 'extract', section: 'Keywords', path: '/docs/language/extract', keywords: 'capture pull tag' },
  { label: 'joined by', section: 'Keywords', path: '/docs/language/joined-by', keywords: 'separator list csv' },
  { label: 'lenient', section: 'Keywords', path: '/docs/language/joined-by', keywords: 'trailing separator' },

  { label: 'letter', section: 'Keywords', path: '/docs/language/classes', keywords: 'a-z A-Z alphabet' },
  { label: 'digit', section: 'Keywords', path: '/docs/language/classes', keywords: '0-9 number' },
  { label: 'whitespace', section: 'Keywords', path: '/docs/language/classes', keywords: 'space tab newline' },
  { label: 'visible', section: 'Keywords', path: '/docs/language/classes', keywords: 'printable no space' },
  { label: 'printable', section: 'Keywords', path: '/docs/language/classes', keywords: 'visible with space' },
  { label: 'any character', section: 'Keywords', path: '/docs/language/classes', keywords: 'wildcard utf-8 codepoint' },
  { label: 'hex digit', section: 'Keywords', path: '/docs/language/classes', keywords: 'hexadecimal 0-f' },
  { label: 'alphanumeric', section: 'Keywords', path: '/docs/language/classes', keywords: 'letter digit' },
  { label: 'word character', section: 'Keywords', path: '/docs/language/classes', keywords: 'letter digit underscore' },
  { label: 'uppercase', section: 'Keywords', path: '/docs/language/classes', keywords: 'A-Z capital' },
  { label: 'lowercase', section: 'Keywords', path: '/docs/language/classes', keywords: 'a-z' },

  { label: 'hyphen', section: 'Keywords', path: '/docs/language/characters', keywords: 'dash -' },
  { label: 'period', section: 'Keywords', path: '/docs/language/characters', keywords: 'dot .' },
  { label: 'comma', section: 'Keywords', path: '/docs/language/characters', keywords: ',' },
  { label: 'colon', section: 'Keywords', path: '/docs/language/characters', keywords: ':' },
  { label: 'semicolon', section: 'Keywords', path: '/docs/language/characters', keywords: ';' },
  { label: 'slash', section: 'Keywords', path: '/docs/language/characters', keywords: '/' },
  { label: 'backslash', section: 'Keywords', path: '/docs/language/characters', keywords: '\\' },
  { label: 'at', section: 'Keywords', path: '/docs/language/characters', keywords: '@' },
  { label: 'hash', section: 'Keywords', path: '/docs/language/characters', keywords: '#' },
  { label: 'equals', section: 'Keywords', path: '/docs/language/characters', keywords: '=' },
  { label: 'underscore', section: 'Keywords', path: '/docs/language/characters', keywords: '_' },
  { label: 'space', section: 'Keywords', path: '/docs/language/characters', keywords: 'whitespace' },
  { label: 'tab', section: 'Keywords', path: '/docs/language/characters', keywords: 'whitespace indent' },
  { label: 'newline', section: 'Keywords', path: '/docs/language/characters', keywords: 'line feed \\n' },
  { label: 'double quote', section: 'Keywords', path: '/docs/language/characters', keywords: '"' },
  { label: 'single quote', section: 'Keywords', path: '/docs/language/characters', keywords: "'" },
  { label: 'open paren', section: 'Keywords', path: '/docs/language/characters', keywords: '(' },
  { label: 'close paren', section: 'Keywords', path: '/docs/language/characters', keywords: ')' },
  { label: 'open bracket', section: 'Keywords', path: '/docs/language/characters', keywords: '[' },
  { label: 'close bracket', section: 'Keywords', path: '/docs/language/characters', keywords: ']' },
  { label: 'open brace', section: 'Keywords', path: '/docs/language/characters', keywords: '{' },
  { label: 'close brace', section: 'Keywords', path: '/docs/language/characters', keywords: '}' },
  { label: 'exclamation', section: 'Keywords', path: '/docs/language/characters', keywords: 'bang !' },
  { label: 'question', section: 'Keywords', path: '/docs/language/characters', keywords: '?' },
  { label: 'asterisk', section: 'Keywords', path: '/docs/language/characters', keywords: 'star *' },
  { label: 'plus', section: 'Keywords', path: '/docs/language/characters', keywords: '+' },
  { label: 'pipe', section: 'Keywords', path: '/docs/language/characters', keywords: '|' },
  { label: 'tilde', section: 'Keywords', path: '/docs/language/characters', keywords: '~' },
  { label: 'caret', section: 'Keywords', path: '/docs/language/characters', keywords: '^' },
  { label: 'dollar', section: 'Keywords', path: '/docs/language/characters', keywords: '$' },
  { label: 'percent', section: 'Keywords', path: '/docs/language/characters', keywords: '%' },
  { label: 'ampersand', section: 'Keywords', path: '/docs/language/characters', keywords: '&' },
  { label: 'backtick', section: 'Keywords', path: '/docs/language/characters', keywords: '`' },
  { label: 'less than', section: 'Keywords', path: '/docs/language/characters', keywords: '<' },
  { label: 'greater than', section: 'Keywords', path: '/docs/language/characters', keywords: '>' },
]

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const lastMousePos = useRef({ x: 0, y: 0 })
  const mouseMovedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    if (!query.trim()) return CMD_ITEMS.filter(item => item.section !== 'Keywords')
    const q = query.toLowerCase()
    const terms = q.split(/\s+/).filter(Boolean)

    const scored = CMD_ITEMS.map(item => {
      const label = item.label.toLowerCase()
      const kw = (item.keywords || '').toLowerCase()
      const sec = item.section.toLowerCase()
      let score = 0

      if (label === q) score = 100
      else if (label.startsWith(q)) score = 80
      else if (kw.split(/\s+/).some(w => w === q)) score = 70
      else if (label.includes(q)) score = 60
      else if (kw.includes(q)) score = 40
      else if (sec.includes(q)) score = 20
      else {
        const allMatch = terms.every(t =>
          label.includes(t) || kw.includes(t) || sec.includes(t)
        )
        if (allMatch) score = 30
      }

      if (score > 0 && item.section === 'Keywords') score -= 1

      return { item, score }
    }).filter(s => s.score > 0)

    scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    return scored.map(s => s.item)
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      mouseMovedRef.current = false
      const capture = (e: MouseEvent) => { lastMousePos.current = { x: e.clientX, y: e.clientY } }
      document.addEventListener('mousemove', capture, { once: true })
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const scrollSource = useRef<'keyboard' | 'none'>('none')

  useEffect(() => {
    if (scrollSource.current === 'keyboard') {
      const el = listRef.current?.children[selected] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }
    scrollSource.current = 'none'
  }, [selected])

  const go = useCallback((path: string) => {
    navigate(path)
    onClose()
  }, [navigate, onClose])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      scrollSource.current = 'keyboard'
      setSelected(s => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      scrollSource.current = 'keyboard'
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && filtered[selected]) {
      go(filtered[selected].path)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [filtered, selected, go, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
            display: 'flex', justifyContent: 'center', paddingTop: '15vh',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, height: 'fit-content',
              background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 16, overflow: 'hidden',
              boxShadow: `0 24px 80px rgba(0,0,0,0.25), 0 0 0 1px ${T.border}`,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 18px', borderBottom: `1px solid ${T.border}`,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, flexShrink: 0 }}>
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search docs, API, examples..."
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 15, fontFamily: T.mono, color: T.text,
                }}
              />
              <kbd style={{
                padding: '3px 7px', borderRadius: 5, fontSize: 10,
                border: `1px solid ${T.border}`, color: T.textMuted,
                fontFamily: T.mono, fontWeight: 500,
              }}>esc</kbd>
            </div>
            <div ref={listRef} style={{
              maxHeight: 380, overflowY: 'auto', padding: 6,
            }}>
              {filtered.length === 0 && (
                <div style={{
                  padding: 32, textAlign: 'center', fontSize: 13,
                  color: T.textMuted, fontFamily: T.mono,
                }}>No results</div>
              )}
              {filtered.map((item, i) => (
                <button
                  key={`${item.section}-${item.label}`}
                  onClick={() => go(item.path)}
                  onMouseMove={(e) => { if (!mouseMovedRef.current) { if (e.clientX === lastMousePos.current.x && e.clientY === lastMousePos.current.y) return; lastMousePos.current = { x: e.clientX, y: e.clientY }; mouseMovedRef.current = true } setSelected(i) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '10px 14px', border: 'none',
                    borderRadius: 10, cursor: 'pointer',
                    background: i === selected ? T.accentSurface : 'transparent',
                    color: i === selected ? T.text : T.textSecondary,
                    fontSize: 13, fontFamily: T.mono, textAlign: 'left',
                    transition: 'none',
                  }}
                >
                  <span style={{
                    fontSize: 9, color: i === selected ? T.accentMuted : T.textMuted,
                    minWidth: 85, textTransform: 'uppercase',
                    letterSpacing: '0.06em', fontWeight: 600,
                  }}>{item.section}</span>
                  <span style={{ fontWeight: i === selected ? 600 : 400 }}>{item.label}</span>
                  {i === selected && (
                    <kbd style={{
                      marginLeft: 'auto', padding: '2px 6px', borderRadius: 4,
                      fontSize: 9, border: `1px solid ${T.border}`,
                      fontFamily: T.mono, color: T.textMuted,
                    }}>&#9166;</kbd>
                  )}
                </button>
              ))}
            </div>
            <div style={{
              padding: '8px 18px', borderTop: `1px solid ${T.border}`,
              display: 'flex', gap: 16, alignItems: 'center',
              fontSize: 10, fontFamily: T.mono, color: T.textMuted, opacity: 0.5,
            }}>
              <span><kbd style={{ fontFamily: T.mono }}>&#8593;&#8595;</kbd> navigate</span>
              <span><kbd style={{ fontFamily: T.mono }}>&#9166;</kbd> open</span>
              <span><kbd style={{ fontFamily: T.mono }}>esc</kbd> close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ScrollToHash() {
  const location = useLocation()
  useEffect(() => {
    if (location.hash) {
      const id = location.hash.slice(1)
      const attempt = () => {
        const el = document.getElementById(id)
        if (el) { el.scrollIntoView({ behavior: 'smooth' }); return true }
        return false
      }
      if (!attempt()) {
        const timer = setTimeout(attempt, 100)
        return () => clearTimeout(timer)
      }
    }
  }, [location])
  return null
}

export default function App() {
  const [isDark, setIsDark] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  T = (isDark ? DARK : LIGHT) as any

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(o => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <ScrollToHash />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
          font-family: ${T.sans};
          background: ${T.bg};
          color: ${T.text};
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          transition: none;
          --t-bg: ${T.bg};
          --t-text: ${T.text};
          --t-text-muted: ${T.textMuted};
          --t-border: ${T.border};
          --t-accent: ${T.accent};
          --t-success: ${T.success};
          --t-code-bg: ${T.codeBg};
          --t-code-text: ${T.codeText};
          --t-mono: ${T.mono};
          --t-sans: ${T.sans};
        }
        a { text-decoration: none; color: inherit; }

        .nav-link {
          font-size: 13px; color: ${T.textMuted}; transition: color 0.2s;
        }
        .nav-link:hover { color: ${T.text}; }

        .section-heading {
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 700; letter-spacing: -0.035em;
          text-align: center; color: ${T.text};
          line-height: 1.15;
        }

        .feature-nav-btn:hover {
          border-color: ${T.borderHover} !important;
          color: ${T.text} !important;
        }

        .install-btn {
          display: flex; align-items: center; gap: 12;
          padding: 12px 20px;
          background: ${T.installBg};
          border: 1px solid ${T.border};
          border-radius: 10px; cursor: pointer;
          transition: all 0.2s;
          color: ${T.text};
          backdrop-filter: blur(8px);
        }
        .install-btn:hover {
          border-color: ${T.borderHover};
          background: ${T.installBgHover};
        }

        .copied-circle {
          stroke-dasharray: 44;
          stroke-dashoffset: 44;
          animation: draw-circle 0.4s ease forwards;
        }
        .copied-check {
          stroke-dasharray: 12;
          stroke-dashoffset: 12;
          animation: draw-check 0.25s ease forwards 0.2s;
        }
        @keyframes draw-circle {
          to { stroke-dashoffset: 0; }
        }
        @keyframes draw-check {
          to { stroke-dashoffset: 0; }
        }

        .license-btn:hover {
          box-shadow: 0 4px 20px ${T.accent}40;
        }
        .license-btn .arrow-line {
          stroke-dasharray: 10;
          stroke-dashoffset: 10;
          transition: stroke-dashoffset 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .license-btn .arrow-head {
          stroke-dasharray: 12;
          stroke-dashoffset: 12;
          transition: stroke-dashoffset 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s;
        }
        .license-btn:hover .license-arrow {
          width: 26px !important;
          opacity: 1 !important;
        }
        .license-btn:hover .arrow-line {
          stroke-dashoffset: 0;
        }
        .license-btn:hover .arrow-head {
          stroke-dashoffset: 0;
        }

        .seat-option:hover {
          background: ${T.accentSurface} !important;
          color: ${T.text} !important;
        }

        .pricing-card {
          transition: border-color 0.3s;
        }
        .pricing-card:hover {
          border-color: ${T.borderHover} !important;
        }

        .ghost-btn:hover {
          border-color: ${T.borderHover} !important;
          color: ${T.text} !important;
        }

        .footer-brand {
          transition: all 0.4s ease;
        }
        .footer-brand:hover {
          background-image: ${T.footerHoverGrad} !important;
        }

        @keyframes blink {
          50% { opacity: 0; }
        }

        .shimmer-btn {
          transition: filter 0.2s ease, transform 0.2s ease;
        }
        .shimmer-btn:hover {
          filter: brightness(1.15);
          transform: translateY(-1px);
        }
        .shimmer-btn:active {
          transform: translateY(0);
        }

        @keyframes shimmer-sweep {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(50%); }
        }

        @keyframes shimmer-bg {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        @keyframes border-beam-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        .marquee-container:hover > div {
          animation-play-state: paused;
        }

        @keyframes aurora-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        @keyframes ripple-pulse {
          0% { transform: scale(0.5); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: scale(1.2); opacity: 0; }
        }

        @media (max-width: 768px) {
          .feature-card { grid-column: span 1 !important; }
          nav > div:first-of-type + div + div { display: none; }
          .hero-grid { grid-template-columns: 1fr !important; text-align: center; }
          .hero-grid > div:first-child { align-items: center !important; }
          .hero-grid > div:first-child > div:first-child { align-self: center !important; }
        }

        @media (max-width: 640px) {
          section#pricing > div > div > div {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <Nav isDark={isDark} onToggle={() => setIsDark(d => !d)} onSearch={() => setCmdOpen(true)} />
      <Routes>
        <Route path="/" element={<>
          <Hero />
          <PatternStrip />
          <Features />
          <Metrics />
          <Compare />
          <QuickStart />
          <Pricing />
          <CTASection />
          <Footer />
        </>} />
        <Route path="/docs/*" element={<Suspense fallback={null}><DocsLayout /></Suspense>} />
        <Route path="/playground" element={<Suspense fallback={null}><Playground /></Suspense>} />
      </Routes>
    </>
  )
}
