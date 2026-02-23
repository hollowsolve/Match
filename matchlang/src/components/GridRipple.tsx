import { useCallback, useRef, useEffect, useState } from 'react'

interface GridRippleProps {
  cellSize?: number
  color?: string
}

export function GridRipple({ cellSize = 40, color = 'rgba(99,102,241,0.15)' }: GridRippleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ripples = useRef<{ x: number; y: number; time: number }[]>([])
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => {
      if (parentRef.current) {
        setDims({
          w: parentRef.current.offsetWidth,
          h: parentRef.current.offsetHeight,
        })
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dims.w) return

    canvas.width = dims.w
    canvas.height = dims.h

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number

    const draw = () => {
      ctx.clearRect(0, 0, dims.w, dims.h)
      const now = performance.now()

      const cols = Math.ceil(dims.w / cellSize)
      const rows = Math.ceil(dims.h / cellSize)

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = c * cellSize + cellSize / 2
          const cy = r * cellSize + cellSize / 2
          let alpha = 0

          for (const ripple of ripples.current) {
            const dist = Math.sqrt((cx - ripple.x) ** 2 + (cy - ripple.y) ** 2)
            const elapsed = (now - ripple.time) / 1000
            const radius = elapsed * 300
            const ringWidth = 120
            const ringDist = Math.abs(dist - radius)
            if (ringDist < ringWidth) {
              const fade = Math.max(0, 1 - elapsed / 2)
              const ring = 1 - ringDist / ringWidth
              alpha = Math.max(alpha, ring * fade * 0.5)
            }
          }

          if (alpha > 0.01) {
            ctx.fillStyle = color.replace(/[\d.]+\)$/, `${alpha})`)
            ctx.fillRect(c * cellSize, r * cellSize, cellSize - 1, cellSize - 1)
          }
        }
      }

      ripples.current = ripples.current.filter(r => (now - r.time) < 3000)
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [dims, cellSize, color])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    ripples.current.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      time: performance.now(),
    })
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      if (dims.w && dims.h) {
        ripples.current.push({
          x: Math.random() * dims.w,
          y: Math.random() * dims.h,
          time: performance.now(),
        })
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [dims])

  return (
    <div
      ref={parentRef}
      onClick={handleClick}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'all',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}
