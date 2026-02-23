import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

interface TextRevealProps {
  text: string
  style?: React.CSSProperties
}

export function TextReveal({ text, style }: TextRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.95', 'start 0.65'],
  })

  const words = text.split(' ')

  return (
    <div ref={ref} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', ...style }}>
      {words.map((word, i) => {
        const start = i / words.length
        const end = start + 1 / words.length
        return <Word key={i} word={word} range={[start, end]} progress={scrollYProgress} />
      })}
    </div>
  )
}

function Word({ word, range, progress }: { word: string; range: [number, number]; progress: ReturnType<typeof useScroll>['scrollYProgress'] }) {
  const opacity = useTransform(progress, range, [0.15, 1])
  return (
    <motion.span style={{ opacity, transition: 'opacity 0.1s' }}>
      {word}
    </motion.span>
  )
}
