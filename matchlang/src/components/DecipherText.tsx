import { useState, useEffect, useRef } from 'react'

interface DecipherTextProps {
  text: string
  speed?: number
  revealDelay?: number
  style?: React.CSSProperties
  className?: string
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'

export function DecipherText({ text, speed = 40, revealDelay = 800, style, className }: DecipherTextProps) {
  const [display, setDisplay] = useState('')
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true) },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [started])

  useEffect(() => {
    if (!started) return

    let revealed = 0
    let frame = 0

    const interval = setInterval(() => {
      frame++
      const chars = text.split('').map((ch, i) => {
        if (ch === ' ' || ch === '\n') return ch
        if (i < revealed) return text[i]
        return CHARS[Math.floor(Math.random() * CHARS.length)]
      })
      setDisplay(chars.join(''))

      if (frame % Math.max(1, Math.floor(revealDelay / speed / text.length * 3)) === 0) {
        revealed++
      }
      if (revealed > text.length) {
        clearInterval(interval)
        setDisplay(text)
      }
    }, speed)

    return () => clearInterval(interval)
  }, [started, text, speed, revealDelay])

  return <span ref={ref} className={className} style={style}>{display || text.replace(/[^ \n]/g, '\u00A0')}</span>
}
