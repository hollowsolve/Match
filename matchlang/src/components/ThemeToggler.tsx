import { useRef } from 'react'
import { motion } from 'framer-motion'

interface ThemeTogglerProps {
  isDark: boolean
  onToggle: () => void
  size?: number
}

export function ThemeToggler({ isDark, onToggle, size = 20 }: ThemeTogglerProps) {
  const rotationRef = useRef(isDark ? 0 : -180)
  const prevDarkRef = useRef(isDark)

  if (isDark !== prevDarkRef.current) {
    rotationRef.current -= 180
    prevDarkRef.current = isDark
  }

  return (
    <button
      onClick={onToggle}
      aria-label="Toggle theme"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        transition: 'background 0.2s',
      }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ rotate: rotationRef.current }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      >
        <motion.circle
          cx="12"
          cy="12"
          stroke={isDark ? '#fafafa' : '#09090b'}
          animate={{
            r: isDark ? 0 : 5,
            opacity: isDark ? 0 : 1,
          }}
          transition={{ duration: 0.35 }}
        />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180
          const x1 = 12 + Math.cos(rad) * 7
          const y1 = 12 + Math.sin(rad) * 7
          const x2 = 12 + Math.cos(rad) * 9
          const y2 = 12 + Math.sin(rad) * 9
          return (
            <motion.line
              key={angle}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isDark ? '#fafafa' : '#09090b'}
              animate={{
                opacity: isDark ? 0 : 1,
                scale: isDark ? 0 : 1,
              }}
              transition={{ duration: 0.3, delay: isDark ? 0 : 0.15 }}
            />
          )
        })}
        <motion.path
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          stroke={isDark ? '#fafafa' : '#09090b'}
          fill={isDark ? '#fafafa' : 'none'}
          animate={{
            opacity: isDark ? 1 : 0,
            scale: isDark ? 1 : 0.5,
          }}
          transition={{ duration: 0.4 }}
        />
      </motion.svg>
    </button>
  )
}
