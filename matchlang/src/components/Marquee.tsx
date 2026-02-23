import { type ReactNode } from 'react'

interface MarqueeProps {
  children: ReactNode
  speed?: number
  reverse?: boolean
  pauseOnHover?: boolean
}

export function Marquee({ children, speed = 30, reverse = false, pauseOnHover = true }: MarqueeProps) {
  const direction = reverse ? 'reverse' : 'normal'

  return (
    <div
      className={pauseOnHover ? 'marquee-container' : undefined}
      style={{
        overflow: 'hidden',
        width: '100%',
        maskImage: 'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
      }}
    >
      <div style={{
        display: 'flex',
        gap: 48,
        width: 'max-content',
        animation: `marquee-scroll ${speed}s linear infinite`,
        animationDirection: direction,
      }}>
        {children}
        {children}
      </div>
    </div>
  )
}
