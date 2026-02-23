import { useState, useEffect, useRef } from 'react'

interface NumberTickerProps {
  value: number
  duration?: number
  prefix?: string
  suffix?: string
  style?: React.CSSProperties
}

export function NumberTicker({ value, duration = 1500, prefix = '', suffix = '', style }: NumberTickerProps) {
  const [display, setDisplay] = useState(0)
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
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * value))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [started, value, duration])

  return (
    <span ref={ref} style={style}>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  )
}
