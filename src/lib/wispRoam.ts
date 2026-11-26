export type WispZone = 'upper' | 'middle' | 'lower'

export interface Point {
  x: number
  y: number
}

export interface BoxRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  pane: 'left' | 'main' | 'right'
  isBrand?: boolean
}

export interface VerticalBand {
  top: number
  bottom: number
}

const ZONES: readonly WispZone[] = ['upper', 'middle', 'lower']

export function getDayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1)
  const curr = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((curr - start) / 86_400_000)
}

export function readDevWispHourOverride(search?: string): number | null {
  const raw =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
        ? window.location.search
        : ''
  if (!raw) return null
  try {
    const val = new URLSearchParams(raw).get('wispHour')
    if (val === null || !/^\d{1,2}$/.test(val.trim())) return null
    const n = Number(val)
    return n >= 0 && n <= 23 ? n : null
  } catch {
    return null
  }
}

export function getHourlyWispZone(date: Date, overrideHour?: number | null): WispZone {
  const h =
    typeof overrideHour === 'number' && overrideHour >= 0 && overrideHour <= 23
      ? Math.floor(overrideHour)
      : date.getHours()
  const idx = ((h % 24) + 24 + getDayOfYear(date)) % 3
  return ZONES[idx]
}

export function getZoneVerticalBand(
  boundsTop: number,
  boundsBottom: number,
  zone: WispZone,
): VerticalBand {
  const h = Math.max(60, boundsBottom - boundsTop)
  const third = h / 3
  if (zone === 'upper') return { top: boundsTop, bottom: boundsTop + third }
  if (zone === 'middle') return { top: boundsTop + third, bottom: boundsTop + third * 2 }
  return { top: boundsTop + third * 2, bottom: boundsBottom }
}

/**
 * Picks target band with 80% inside the active hourly zone and 20% soft-bleed
 * into an adjacent band so transitions feel organic instead of boxed in.
 */
export function pickTargetBand(
  boundsTop: number,
  boundsBottom: number,
  zone: WispZone,
  roll = Math.random(),
): VerticalBand {
  if (roll < 0.8) return getZoneVerticalBand(boundsTop, boundsBottom, zone)
  const neighbor: WispZone =
    zone === 'upper'
      ? 'middle'
      : zone === 'lower'
        ? 'middle'
        : roll < 0.9
          ? 'upper'
          : 'lower'
  return getZoneVerticalBand(boundsTop, boundsBottom, neighbor)
}

export interface VisitedGrid {
  markVisited: (x: number, y: number, bounds: Pick<BoxRect, 'left' | 'top' | 'width' | 'height'>) => void
  scoreRect: (rect: Pick<BoxRect, 'left' | 'top' | 'right' | 'bottom'>, bounds: Pick<BoxRect, 'left' | 'top' | 'width' | 'height'>) => number
  decay: () => void
  pickLeastVisitedPoint: (
    bounds: Pick<BoxRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>,
    band: VerticalBand,
    rng?: () => number,
  ) => Point
}

export function createVisitedGrid(cols = 6, rows = 3): VisitedGrid {
  const counts = new Float32Array(cols * rows)

  const cellFor = (
    x: number,
    y: number,
    bounds: Pick<BoxRect, 'left' | 'top' | 'width' | 'height'>,
  ) => {
    const cx = Math.min(
      cols - 1,
      Math.max(0, Math.floor(((x - bounds.left) / Math.max(1, bounds.width)) * cols)),
    )
    const cy = Math.min(
      rows - 1,
      Math.max(0, Math.floor(((y - bounds.top) / Math.max(1, bounds.height)) * rows)),
    )
    return cy * cols + cx
  }

  return {
    markVisited(x, y, bounds) {
      counts[cellFor(x, y, bounds)] += 1
    },
    scoreRect(rect, bounds) {
      const mx = (rect.left + rect.right) / 2
      const my = (rect.top + rect.bottom) / 2
      return counts[cellFor(mx, my, bounds)]
    },
    decay() {
      for (let i = 0; i < counts.length; i++) counts[i] *= 0.85
    },
    pickLeastVisitedPoint(bounds, band, rng = Math.random) {
      const bandMidY = (band.top + band.bottom) / 2
      const bandRow = Math.min(
        rows - 1,
        Math.max(0, Math.floor(((bandMidY - bounds.top) / Math.max(1, bounds.height)) * rows)),
      )
      let minVal = Infinity
      const bestCols: number[] = []
      for (let c = 0; c < cols; c++) {
        const val = counts[bandRow * cols + c]
        if (val < minVal - 0.15) {
          minVal = val
          bestCols.length = 0
          bestCols.push(c)
        } else if (Math.abs(val - minVal) <= 0.15) {
          bestCols.push(c)
        }
      }
      const chosenCol = bestCols[Math.floor(rng() * bestCols.length)] ?? 0
      const cellW = bounds.width / cols
      const xMin = bounds.left + chosenCol * cellW + cellW * 0.15
      const xMax = bounds.left + (chosenCol + 1) * cellW - cellW * 0.15
      const yPad = Math.min(18, Math.max(4, (band.bottom - band.top) * 0.15))
      return {
        x: xMin + rng() * Math.max(4, xMax - xMin),
        y: band.top + yPad + rng() * Math.max(4, band.bottom - band.top - yPad * 2),
      }
    },
  }
}
