import { type ReactNode } from 'react'

interface AuroraTextProps {
  children: ReactNode
  style?: React.CSSProperties
  className?: string
}

export function AuroraText({ children, style, className }: AuroraTextProps) {
  return (
    <span
      className={`aurora-text ${className || ''}`}
      style={{
        backgroundImage: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-text-muted) 25%, var(--t-text-muted) 50%, var(--t-accent) 75%, var(--t-text-muted) 100%)',
        backgroundSize: '300% 300%',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        animation: 'aurora-shift 4s ease infinite',
        ...style,
      }}
    >
      {children}
    </span>
  )
}
