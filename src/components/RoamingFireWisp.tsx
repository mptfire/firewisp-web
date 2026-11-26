import { useEffect, useRef, useState } from 'react'
import { FireWispFlameSprite } from './FireWispFlameSprite'

interface Point {
  x: number
  y: number
}

interface PathSample {
  x: number
  y: number
  cumDist: number
}

interface BoxRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  pane: 'left' | 'main' | 'right'
  isBrand?: boolean
}

// Matches the original 24s brand-box orbit (~544px / 24s ≈ 22.7 px/s)
const WISP_SPEED_PX_PER_SEC = 23
const SAMPLE_STEP_PX = 3.5
const TAIL_DIST_OFFSETS = [11, 19, 27, 35, 43] as const

const BOX_SELECTOR =
  '.fw-flame-box, aside .rounded-2xl, aside .rounded-xl, aside nav, main article, main section, main .rounded-2xl, main .rounded-xl, main img, main video'

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function getShellBounds(): BoxRect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const shell = document.querySelector('[data-fw-shell]')
  const r = shell?.getBoundingClientRect()
  const rawLeft = r ? Math.max(0, r.left) : 0
  const rawRight = r ? Math.min(vw, r.right) : vw

  const left = rawLeft + 10
  const right = Math.max(left + 80, rawRight - 10)
  const top = 14
  const bottom = Math.max(top + 80, vh - 14)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    pane: 'main',
  }
}

function discoverVisibleBoxes(bounds: BoxRect): BoxRect[] {
  const shell = document.querySelector('[data-fw-shell]') || document
  const candidates = Array.from(shell.querySelectorAll(BOX_SELECTOR))
  const found: BoxRect[] = []
  const midX = (bounds.left + bounds.right) / 2

  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    if (r.width < 60 || r.height < 32) continue
    if (r.bottom <= bounds.top + 8 || r.top >= bounds.bottom - 8) continue
    if (r.right <= bounds.left + 8 || r.left >= bounds.right - 8) continue

    const left = clamp(r.left, bounds.left, bounds.right)
    const right = clamp(r.right, bounds.left, bounds.right)
    const top = clamp(r.top, bounds.top, bounds.bottom)
    const bottom = clamp(r.bottom, bounds.top, bounds.bottom)
    const width = right - left
    const height = bottom - top

    if (width < 72 || height < 36) continue

    // Deduplicate overlapping parent/child wrappers with nearly identical bounds
    const duplicate = found.some(
      (b) =>
        Math.abs(b.left - left) < 12 &&
        Math.abs(b.top - top) < 12 &&
        Math.abs(b.right - right) < 12 &&
        Math.abs(b.bottom - bottom) < 12,
    )
    if (duplicate) continue

    let pane: 'left' | 'main' | 'right' = 'main'
    if (el.closest('aside')) {
      pane = left + width / 2 < midX ? 'left' : 'right'
    }

    found.push({
      left,
      top,
      right,
      bottom,
      width,
      height,
      pane,
      isBrand: el.classList.contains('fw-flame-box'),
    })
  }

  if (found.length > 0) return found

  // Safe fallback rectangle inside the 3-pane shell if no boxes are mounted yet
  const pad = 18
  const fbLeft = bounds.left + pad
  const fbRight = Math.max(fbLeft + 120, bounds.right - pad)
  const fbTop = bounds.top + pad
  const fbBottom = Math.max(fbTop + 120, Math.min(bounds.bottom - pad, fbTop + 320))
  return [
    {
      left: fbLeft,
      top: fbTop,
      right: fbRight,
      bottom: fbBottom,
      width: fbRight - fbLeft,
      height: fbBottom - fbTop,
      pane: 'main',
    },
  ]
}

function buildRoundedRectLoop(rect: BoxRect): Point[] {
  const rad = Math.min(14, rect.width * 0.22, rect.height * 0.22)
  const pts: Point[] = []

  const pushArc = (cx: number, cy: number, startRad: number, endRad: number) => {
    const arcLen = Math.max(4, Math.abs(endRad - startRad) * rad)
    const steps = Math.max(3, Math.round(arcLen / SAMPLE_STEP_PX))
    for (let i = 0; i < steps; i++) {
      const a = startRad + ((endRad - startRad) * i) / steps
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad })
    }
  }

  const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
    const dist = Math.hypot(x2 - x1, y2 - y1)
    const steps = Math.max(1, Math.round(dist / SAMPLE_STEP_PX))
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t })
    }
  }

  // Clockwise perimeter around the border of the box
  pushLine(rect.left + rad, rect.top, rect.right - rad, rect.top)
  pushArc(rect.right - rad, rect.top + rad, -Math.PI / 2, 0)
  pushLine(rect.right, rect.top + rad, rect.right, rect.bottom - rad)
  pushArc(rect.right - rad, rect.bottom - rad, 0, Math.PI / 2)
  pushLine(rect.right - rad, rect.bottom, rect.left + rad, rect.bottom)
  pushArc(rect.left + rad, rect.bottom - rad, Math.PI / 2, Math.PI)
  pushLine(rect.left, rect.bottom - rad, rect.left, rect.top + rad)
  pushArc(rect.left + rad, rect.top + rad, Math.PI, Math.PI * 1.5)

  return pts
}

function isSameBox(a: BoxRect, b: BoxRect): boolean {
  return (
    Math.abs(a.left - b.left) < 12 &&
    Math.abs(a.top - b.top) < 12 &&
    Math.abs(a.right - b.right) < 12 &&
    Math.abs(a.bottom - b.bottom) < 12
  )
}

function pickNextBox(
  boxes: BoxRect[],
  currPos: Point,
  lastBox: BoxRect | null,
): BoxRect {
  const candidates = lastBox ? boxes.filter((b) => !isSameBox(b, lastBox)) : boxes
  const pool = candidates.length > 0 ? candidates : boxes

  // Sometimes roam across panes (left -> main -> right); mostly explore nearby boxes calmly
  const crossPane = Math.random() < 0.35
  const byDist = [...pool].sort((a, b) => {
    const da = Math.hypot((a.left + a.right) / 2 - currPos.x, (a.top + a.bottom) / 2 - currPos.y)
    const db = Math.hypot((b.left + b.right) / 2 - currPos.x, (b.top + b.bottom) / 2 - currPos.y)
    return da - db
  })

  if (crossPane && lastBox) {
    const otherPane = byDist.filter((b) => b.pane !== lastBox.pane)
    if (otherPane.length > 0) {
      return otherPane[Math.floor(Math.random() * Math.min(3, otherPane.length))]
    }
  }

  const nearCount = Math.min(4, byDist.length)
  return byDist[Math.floor(Math.random() * nearCount)]
}

function appendPoint(samples: PathSample[], pt: Point, bounds: BoxRect) {
  const x = clamp(pt.x, bounds.left, bounds.right)
  const y = clamp(pt.y, bounds.top, bounds.bottom)
  const last = samples[samples.length - 1]
  if (!last) {
    samples.push({ x, y, cumDist: 0 })
    return
  }
  const d = Math.hypot(x - last.x, y - last.y)
  if (d < 0.4) return
  samples.push({ x, y, cumDist: last.cumDist + d })
}

function appendBezierTransition(
  samples: PathSample[],
  p0: Point,
  exitAngleRad: number,
  p3: Point,
  entryAngleRad: number,
  bounds: BoxRect,
) {
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  if (dist < 4) return

  const handle = Math.min(96, Math.max(16, dist * 0.36))
  const p1: Point = {
    x: clamp(p0.x + Math.cos(exitAngleRad) * handle, bounds.left, bounds.right),
    y: clamp(p0.y + Math.sin(exitAngleRad) * handle, bounds.top, bounds.bottom),
  }
  const p2: Point = {
    x: clamp(p3.x - Math.cos(entryAngleRad) * handle, bounds.left, bounds.right),
    y: clamp(p3.y - Math.sin(entryAngleRad) * handle, bounds.top, bounds.bottom),
  }

  const approxLen = Math.max(dist, Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y))
  const steps = Math.max(4, Math.ceil(approxLen / SAMPLE_STEP_PX))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    const mm = m * m
    const tt = t * t
    appendPoint(
      samples,
      {
        x: mm * m * p0.x + 3 * mm * t * p1.x + 3 * m * tt * p2.x + tt * t * p3.x,
        y: mm * m * p0.y + 3 * mm * t * p1.y + 3 * m * tt * p2.y + tt * t * p3.y,
      },
      bounds,
    )
  }
}

function samplePositionAtDist(samples: PathSample[], targetDist: number): Point {
  if (samples.length === 0) return { x: 0, y: 0 }
  if (targetDist <= samples[0].cumDist) return { x: samples[0].x, y: samples[0].y }
  const last = samples[samples.length - 1]
  if (targetDist >= last.cumDist) return { x: last.x, y: last.y }

  let lo = 0
  let hi = samples.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].cumDist <= targetDist) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const span = Math.max(0.0001, b.cumDist - a.cumDist)
  const frac = (targetDist - a.cumDist) / span
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  }
}

function samplePoseAtDist(
  samples: PathSample[],
  targetDist: number,
): { x: number; y: number; angleDeg: number } {
  const pos = samplePositionAtDist(samples, targetDist)
  const behind = samplePositionAtDist(samples, targetDist - 4)
  const ahead = samplePositionAtDist(samples, targetDist + 4)
  const dx = ahead.x - behind.x
  const dy = ahead.y - behind.y
  const angleDeg = dx * dx + dy * dy > 0.01 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0
  return { x: pos.x, y: pos.y, angleDeg }
}

/**
 * Main Orange Fire Wisp sprite that moves at the same calm speed (~23 px/s) as
 * the original brand-box orbit, carefully tracing around visible text boxes,
 * notes, sidebar panels, and images strictly within the 3-pane layout shell.
 * Sits at `z-[5]` so it glides over text while ducking under `z-[6]` media.
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

    let bounds = getShellBounds()
    const samples: PathSample[] = []
    let headDist = 0
    let lastBox: BoxRect | null = null
    let lastAngleRad = 0
    let lastTs: number | null = null
    let rafId = 0

    const enqueueBoxTrace = (box: BoxRect, isInitial = false) => {
      const loop = buildRoundedRectLoop(box)
      if (loop.length < 4) return

      const lastSample = samples[samples.length - 1]
      let startIdx = 0
      if (!isInitial && lastSample) {
        let bestDist = Infinity
        for (let i = 0; i < loop.length; i++) {
          const d = Math.hypot(loop[i].x - lastSample.x, loop[i].y - lastSample.y)
          if (d < bestDist) {
            bestDist = d
            startIdx = i
          }
        }
      }

      const dir = isInitial || Math.random() > 0.45 ? 1 : -1
      const totalPerimeter = loop.length * SAMPLE_STEP_PX
      const traceLength = isInitial
        ? Math.min(totalPerimeter * 0.55, 220)
        : Math.min(totalPerimeter * 0.78, 160 + Math.random() * 240)
      const stepCount = Math.max(12, Math.round(traceLength / SAMPLE_STEP_PX))

      const entryPt = loop[startIdx]
      const entryNext = loop[(startIdx + dir + loop.length) % loop.length]
      const entryAngle = Math.atan2(entryNext.y - entryPt.y, entryNext.x - entryPt.x)

      if (!isInitial && lastSample) {
        appendBezierTransition(samples, lastSample, lastAngleRad, entryPt, entryAngle, bounds)
      }

      for (let k = 0; k < stepCount; k++) {
        const idx = (startIdx + dir * k + loop.length * 4) % loop.length
        appendPoint(samples, loop[idx], bounds)
      }

      const endIdx = (startIdx + dir * (stepCount - 1) + loop.length * 4) % loop.length
      const prevEndIdx = (endIdx - dir + loop.length * 4) % loop.length
      lastAngleRad = Math.atan2(
        loop[endIdx].y - loop[prevEndIdx].y,
        loop[endIdx].x - loop[prevEndIdx].x,
      )
      lastBox = box
    }

    const ensurePathAhead = () => {
      bounds = getShellBounds()
      const totalDist = samples[samples.length - 1]?.cumDist ?? 0
      if (totalDist - headDist >= 110) return

      const boxes = discoverVisibleBoxes(bounds)
      if (!lastBox) {
        const brandBox = boxes.find((b) => b.isBrand) || boxes[0]
        enqueueBoxTrace(brandBox, true)
        return
      }

      const currPos = samples[samples.length - 1] || {
        x: bounds.left + bounds.width * 0.25,
        y: bounds.top + 80,
      }
      const next = pickNextBox(boxes, currPos, lastBox)
      enqueueBoxTrace(next, false)
    }

    const onResize = () => {
      bounds = getShellBounds()
    }

    const onVisibility = () => {
      if (!document.hidden) lastTs = null
    }

    ensurePathAhead()

    const renderFrame = (ts: number) => {
      if (document.hidden) {
        lastTs = null
        rafId = requestAnimationFrame(renderFrame)
        return
      }

      if (lastTs === null) lastTs = ts
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000))
      lastTs = ts

      headDist += WISP_SPEED_PX_PER_SEC * dt
      ensurePathAhead()

      // Keep path bounded strictly inside current 3-pane horizontal edges on resize
      const head = samplePoseAtDist(samples, headDist)
      const hx = clamp(head.x, bounds.left, bounds.right)
      const hy = clamp(head.y, bounds.top, bounds.bottom)

      if (headRef.current) {
        headRef.current.style.transform = `translate3d(${(hx - 14).toFixed(1)}px, ${(hy - 10).toFixed(1)}px, 0) rotate(${head.angleDeg.toFixed(1)}deg)`
      }

      for (let i = 0; i < TAIL_DIST_OFFSETS.length; i++) {
        const el = tailRefs.current[i]
        if (!el) continue
        const tailPose = samplePoseAtDist(samples, headDist - TAIL_DIST_OFFSETS[i])
        const tx = clamp(tailPose.x, bounds.left, bounds.right)
        const ty = clamp(tailPose.y, bounds.top, bounds.bottom)
        el.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${tailPose.angleDeg.toFixed(1)}deg)`
      }

      // Prune old path history well behind the tail to keep memory tiny
      const keepFrom = headDist - 90
      if (samples.length > 60 && samples[16].cumDist < keepFrom) {
        let drop = 0
        while (drop < samples.length - 40 && samples[drop + 1].cumDist < keepFrom) {
          drop++
        }
        if (drop > 0) samples.splice(0, drop)
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
