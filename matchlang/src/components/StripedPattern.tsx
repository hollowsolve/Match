interface StripedPatternProps {
  color?: string
  gap?: number
  strokeWidth?: number
  direction?: 'left' | 'right'
  style?: React.CSSProperties
}

export function StripedPattern({
  color = 'rgba(0,0,0,0.06)',
  gap = 20,
  strokeWidth = 1,
  direction = 'right',
  style,
}: StripedPatternProps) {
  const id = `stripes-${direction}-${gap}`
  const d = direction === 'right'
    ? `M0 ${gap} L${gap} 0 M-${gap / 4} ${gap / 4} L${gap / 4} -${gap / 4} M${gap * 0.75} ${gap * 1.25} L${gap * 1.25} ${gap * 0.75}`
    : `M${gap} ${gap} L0 0 M${gap * 1.25} ${gap / 4} L${gap * 0.75} -${gap / 4} M${gap / 4} ${gap * 1.25} L-${gap / 4} ${gap * 0.75}`

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={gap} height={gap}>
          <path
            d={d}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
