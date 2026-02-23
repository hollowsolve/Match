interface RippleProps {
  color?: string
  count?: number
}

export function Ripple({ color = 'rgba(99,102,241,0.12)', count = 5 }: RippleProps) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      overflow: 'hidden',
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: `${(i + 1) * 200}px`,
            height: `${(i + 1) * 200}px`,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            animation: `ripple-pulse 4s ease-out ${i * 0.6}s infinite`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  )
}
