import { type ReactNode } from 'react'

interface ShimmerButtonProps {
  children: ReactNode
  onClick?: () => void
  href?: string
  style?: React.CSSProperties
  className?: string
}

export function ShimmerButton({ children, onClick, href, style, className }: ShimmerButtonProps) {
  const baseStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 32px',
    background: 'linear-gradient(135deg, var(--t-accent) 0%, var(--t-text-muted) 50%, var(--t-accent) 100%)',
    backgroundSize: '200% 200%',
    color: 'var(--t-bg)',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 14,
    border: 'none',
    cursor: 'pointer',
    overflow: 'hidden',
    textDecoration: 'none',
    animation: 'shimmer-bg 3s ease infinite',
    ...style,
  }

  const content = (
    <>
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
      <div style={{
        position: 'absolute',
        top: 0, left: '-100%',
        width: '200%', height: '100%',
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
        animation: 'shimmer-sweep 2.5s ease-in-out infinite',
      }} />
    </>
  )

  const cls = ['shimmer-btn', className].filter(Boolean).join(' ')

  if (href) {
    return <a href={href} style={baseStyle} className={cls}>{content}</a>
  }
  return <button onClick={onClick} style={baseStyle} className={cls}>{content}</button>
}
