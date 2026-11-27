export interface FormatRelativeTimeOptions {
  nowSec?: number
  underMinuteLabel?: string
  includeWeeks?: boolean
  dateFormatOptions?: Intl.DateTimeFormatOptions
}

export function formatRelativeTime(
  unixSec: number,
  options: FormatRelativeTimeOptions = {},
): string {
  const {
    nowSec = Math.floor(Date.now() / 1000),
    underMinuteLabel,
    includeWeeks = true,
    dateFormatOptions,
  } = options
  const diff = Math.max(0, nowSec - unixSec)
  if (diff < 60) return underMinuteLabel ?? `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (!includeWeeks || diff < 604800) return `${Math.floor(diff / 86400)}d`
  return dateFormatOptions
    ? new Date(unixSec * 1000).toLocaleDateString(undefined, dateFormatOptions)
    : new Date(unixSec * 1000).toLocaleDateString()
}

export interface FormatCompactCountOptions {
  kThreshold?: number
  lowercaseK?: boolean
  stripTrailingZero?: boolean
  formatPlain?: boolean
}

export function formatCompactCount(
  n: number,
  options: FormatCompactCountOptions = {},
): string {
  const {
    kThreshold = 1000,
    lowercaseK = false,
    stripTrailingZero = true,
    formatPlain = false,
  } = options
  const formatScaled = (val: number, suffix: string) => {
    const fixed = val.toFixed(1)
    return `${stripTrailingZero ? fixed.replace(/\.0$/, '') : fixed}${suffix}`
  }
  if (n >= 1_000_000) return formatScaled(n / 1_000_000, 'M')
  if (n >= kThreshold) return formatScaled(n / 1_000, lowercaseK ? 'k' : 'K')
  return formatPlain ? n.toLocaleString() : String(n)
}

export function formatChatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const whole = Math.floor(sec)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = s < 10 ? `0${s}` : String(s)
  if (h > 0) {
    const mm = m < 10 ? `0${m}` : String(m)
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}
