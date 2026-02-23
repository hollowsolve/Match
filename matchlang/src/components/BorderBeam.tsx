interface BorderBeamProps {
  children: React.ReactNode
  style?: React.CSSProperties
  beamColor?: string
  duration?: number
  className?: string
}

export function BorderBeam({
  children,
  style,
  beamColor = '#6366f1',
  duration = 4,
  className,
}: BorderBeamProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        borderRadius: 12,
        padding: 1,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{
        position: 'absolute',
        inset: '-200%',
        background: `conic-gradient(from 0deg at 50% 50%, transparent 0%, transparent 60%, ${beamColor} 75%, ${beamColor}80 85%, transparent 90%, transparent 100%)`,
        animation: `border-beam-spin ${duration}s linear infinite`,
        pointerEvents: 'none',
        zIndex: 0,
      }} />
      <div style={{
        position: 'absolute',
        inset: 1,
        borderRadius: 11,
        background: 'var(--t-bg)',
        zIndex: 1,
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', zIndex: 2 }}>
        {children}
      </div>
    </div>
  )
}
