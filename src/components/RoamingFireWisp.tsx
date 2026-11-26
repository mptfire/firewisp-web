import { useEffect, useRef, useState } from 'react'
import { FireWispFlameSprite } from './FireWispFlameSprite'

interface Point {
  x: number
  y: number
}

interface BezierSegment {
  p0: Point
  p1: Point
  p2: Point
  p3: Point
  durationSec: number
}

const TAIL_TIME_OFFSETS = [0.028, 0.056, 0.088, 0.124, 0.165] as const

function randomWaypoint(width: number, height: number, from?: Point): Point {
  const minX = Math.max(24, width * 0.04)
  const maxX = Math.max(minX + 40, width * 0.96)
  const minY = Math.max(24, height * 0.06)
  const maxY = Math.max(minY + 40, height * 0.92)
  const minDist = Math.min(width, height) * 0.35

  let best: Point = {
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
  }
  if (!from) return best

  for (let i = 0; i < 8; i++) {
    const candidate = {
      x: minX + Math.random() * (maxX - minX),
      y: minY + Math.random() * (maxY - minY),
    }
    const dist = Math.hypot(candidate.x - from.x, candidate.y - from.y)
    best = candidate
    if (dist >= minDist) break
  }
  return best
}

function createNextSegment(
  prev: BezierSegment | null,
  width: number,
  height: number,
): BezierSegment {
  const p0 = prev ? prev.p3 : randomWaypoint(width, height)
  const p3 = randomWaypoint(width, height, p0)
  const dx = p3.x - p0.x
  const dy = p3.y - p0.y
  const dist = Math.max(120, Math.hypot(dx, dy))

  // C1 continuity: mirror the exit handle of the previous cubic Bezier across p0
  let p1: Point
  if (prev) {
    const outX = prev.p3.x - prev.p2.x
    const outY = prev.p3.y - prev.p2.y
    const outLen = Math.hypot(outX, outY) || 1
    const handleLen = Math.min(dist * 0.42, Math.max(60, outLen))
    p1 = {
      x: p0.x + (outX / outLen) * handleLen,
      y: p0.y + (outY / outLen) * handleLen,
    }
  } else {
    const perpX = -dy / dist
    const perpY = dx / dist
    const curveSign = Math.random() > 0.5 ? 1 : -1
    const sway = dist * (0.2 + Math.random() * 0.25) * curveSign
    p1 = {
      x: p0.x + dx * 0.32 + perpX * sway,
      y: p0.y + dy * 0.32 + perpY * sway,
    }
  }

  const perpX = -dy / dist
  const perpY = dx / dist
  const sway2 = dist * (0.18 + Math.random() * 0.28) * (Math.random() > 0.5 ? 1 : -1)
  const p2 = {
    x: p0.x + dx * 0.68 + perpX * sway2,
    y: p0.y + dy * 0.68 + perpY * sway2,
  }

  // Clamp control handles safely inside padded viewport bounds so turns stay visible
  const clampX = (v: number) => Math.min(width - 16, Math.max(16, v))
  const clampY = (v: number) => Math.min(height - 16, Math.max(16, v))
  p1 = { x: clampX(p1.x), y: clampY(p1.y) }

  // Wandering speed ~95-140 px/s -> calm 4.5s to 8.5s arcs
  const speed = 95 + Math.random() * 45
  const approxLength = dist * 1.18
  const durationSec = Math.min(8.5, Math.max(4.5, approxLength / speed))

  return {
    p0,
    p1,
    p2: { x: clampX(p2.x), y: clampY(p2.y) },
    p3,
    durationSec,
  }
}

function evalBezier(seg: BezierSegment, t: number): { x: number; y: number; angleDeg: number } {
  const u = Math.min(1, Math.max(0, t))
  const m = 1 - u
  const mm = m * m
  const uu = u * u

  const x =
    mm * m * seg.p0.x +
    3 * mm * u * seg.p1.x +
    3 * m * uu * seg.p2.x +
    uu * u * seg.p3.x
  const y =
    mm * m * seg.p0.y +
    3 * mm * u * seg.p1.y +
    3 * m * uu * seg.p2.y +
    uu * u * seg.p3.y

  const dxdt =
    3 * mm * (seg.p1.x - seg.p0.x) +
    6 * m * u * (seg.p2.x - seg.p1.x) +
    3 * uu * (seg.p3.x - seg.p2.x)
  const dydt =
    3 * mm * (seg.p1.y - seg.p0.y) +
    6 * m * u * (seg.p2.y - seg.p1.y) +
    3 * uu * (seg.p3.y - seg.p2.y)

  const angleDeg = (Math.atan2(dydt, dxdt) * 180) / Math.PI
  return { x, y, angleDeg }
}

/**
 * Main Orange Fire Wisp sprite that organically roams across the viewport.
 * Sits at `z-[5]` so it glides visibly over text while disappearing underneath
 * pictures, videos, YouTube cards, and live players (`relative z-[6]`).
 */
export function RoamingFireWisp() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      : true,
  )

  const headRef = useRef<HTMLDivElement | null>(null)
  const tailRefs = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined') return

    let width = window.innerWidth
    let height = window.innerHeight
    let prevSeg: BezierSegment | null = null
    let currSeg = createNextSegment(null, width, height)
    let elapsedSec = 0
    let lastTs: number | null = null
    let rafId = 0

    const onResize = () => {
      width = window.innerWidth
      height = window.innerHeight
    }

    const onVisibility = () => {
      if (!document.hidden) {
        lastTs = null
      }
    }

    const renderFrame = (ts: number) => {
      if (document.hidden) {
        lastTs = null
        rafId = requestAnimationFrame(renderFrame)
        return
      }

      if (lastTs === null) {
        lastTs = ts
      }
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000))
      lastTs = ts
      elapsedSec += dt

      while (elapsedSec >= currSeg.durationSec) {
        elapsedSec -= currSeg.durationSec
        prevSeg = currSeg
        currSeg = createNextSegment(prevSeg, width, height)
      }

      const u = elapsedSec / currSeg.durationSec
      const head = evalBezier(currSeg, u)
      if (headRef.current) {
        headRef.current.style.transform = `translate3d(${head.x - 14}px, ${head.y - 10}px, 0) rotate(${head.angleDeg.toFixed(1)}deg)`
      }

      for (let i = 0; i < TAIL_TIME_OFFSETS.length; i++) {
        const el = tailRefs.current[i]
        if (!el) continue
        const offsetSec = TAIL_TIME_OFFSETS[i]
        let sample: { x: number; y: number; angleDeg: number }
        if (elapsedSec >= offsetSec) {
          sample = evalBezier(currSeg, (elapsedSec - offsetSec) / currSeg.durationSec)
        } else if (prevSeg) {
          const prevRemain = offsetSec - elapsedSec
          const prevT = Math.max(0, 1 - prevRemain / prevSeg.durationSec)
          sample = evalBezier(prevSeg, prevT)
        } else {
          sample = head
        }
        el.style.transform = `translate3d(${sample.x}px, ${sample.y}px, 0) translate(-50%, -50%) rotate(${sample.angleDeg.toFixed(1)}deg)`
      }

      rafId = requestAnimationFrame(renderFrame)
    }

    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    rafId = requestAnimationFrame(renderFrame)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reducedMotion])

  if (reducedMotion) return null

  return (
    <div
      aria-hidden="true"
      className="fw-roam-layer fixed inset-0 z-[5] pointer-events-none overflow-hidden"
    >
      <span
        ref={(el) => {
          tailRefs.current[4] = el
        }}
        className="fw-roam-tail fw-roam-tail-5"
      />
      <span
        ref={(el) => {
          tailRefs.current[3] = el
        }}
        className="fw-roam-tail fw-roam-tail-4"
      />
      <span
        ref={(el) => {
          tailRefs.current[2] = el
        }}
        className="fw-roam-tail fw-roam-tail-3"
      />
      <span
        ref={(el) => {
          tailRefs.current[1] = el
        }}
        className="fw-roam-tail fw-roam-tail-2"
      />
      <span
        ref={(el) => {
          tailRefs.current[0] = el
        }}
        className="fw-roam-tail fw-roam-tail-1"
      />
      <div ref={headRef} className="fw-roam-head">
        <div className="fw-roam-wisp">
          <FireWispFlameSprite idPrefix="fw-roam" variant="ember" />
        </div>
      </div>
    </div>
  )
}
