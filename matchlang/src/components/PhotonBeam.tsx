import { useRef, useEffect } from 'react'

interface PhotonBeamProps {
  color?: string
  wireCount?: number
  direction?: 'ltr' | 'rtl'
}

export function PhotonBeam({ color = '#6366f1', wireCount = 8, direction = 'ltr' }: PhotonBeamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = parentRef.current
    if (!canvas || !parent) return

    const resize = () => {
      canvas.width = parent.offsetWidth
      canvas.height = parent.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    const startTime = performance.now()

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      if (!w || !h) { animId = requestAnimationFrame(draw); return }

      ctx.clearRect(0, 0, w, h)
      const now = (performance.now() - startTime) / 1000

      const convergeX = direction === 'ltr' ? w * 0.85 : w * 0.15
      const convergeY = h * 0.5
      const spreadX = direction === 'ltr' ? w * 0.05 : w * 0.95
      const spreadRange = h * 0.7
      const spreadTop = (h - spreadRange) / 2

      for (let i = 0; i < wireCount; i++) {
        const t = wireCount > 1 ? i / (wireCount - 1) : 0.5
        const startY = spreadTop + t * spreadRange
        const startX = spreadX

        const pulse = Math.sin(now * 1.5 + i * 0.8) * 0.3 + 0.7

        ctx.beginPath()
        ctx.moveTo(startX, startY)

        const cp1x = direction === 'ltr' ? w * 0.35 : w * 0.65
        const cp1y = startY + Math.sin(now * 0.8 + i) * 15
        const cp2x = direction === 'ltr' ? w * 0.65 : w * 0.35
        const cp2y = convergeY + (startY - convergeY) * 0.2 + Math.sin(now * 0.6 + i * 0.5) * 8

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, convergeX, convergeY)

        const grad = ctx.createLinearGradient(startX, startY, convergeX, convergeY)
        grad.addColorStop(0, color + '15')
        grad.addColorStop(0.5, color + Math.round(pulse * 40).toString(16).padStart(2, '0'))
        grad.addColorStop(1, color + Math.round(pulse * 70).toString(16).padStart(2, '0'))

        ctx.strokeStyle = grad
        ctx.lineWidth = 1.2
        ctx.stroke()
      }

      const glowPulse = Math.sin(now * 2) * 0.3 + 0.7
      const glowRadius = 30 * glowPulse
      const glow = ctx.createRadialGradient(convergeX, convergeY, 0, convergeX, convergeY, glowRadius)
      glow.addColorStop(0, color + '30')
      glow.addColorStop(0.5, color + '10')
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(convergeX - glowRadius, convergeY - glowRadius, glowRadius * 2, glowRadius * 2)

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [color, wireCount, direction])

  return (
    <div ref={parentRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
