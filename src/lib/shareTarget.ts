/**
 * Parses Web Share Target query params (`title`, `text`, `url`) from Android / OS share sheets
 * into clean, deduplicated composer draft text.
 */
export function parseSharedQueryParams(search: string): string | null {
  const params = new URLSearchParams(search)
  const rawTitle = (params.get('title') || '').trim().slice(0, 300)
  const rawText = (params.get('text') || '').trim().slice(0, 1500)
  const rawUrl = (params.get('url') || '').trim().slice(0, 1000)

  const parts: string[] = []
  const bodyCandidate = [rawText, rawUrl].filter(Boolean).join('\n')

  if (
    rawTitle &&
    rawTitle !== rawText &&
    rawTitle !== rawUrl &&
    !bodyCandidate.includes(rawTitle)
  ) {
    parts.push(rawTitle)
  }
  if (rawText) {
    parts.push(rawText)
  }
  if (rawUrl && !rawText.includes(rawUrl)) {
    parts.push(rawUrl)
  }

  const combined = parts.join('\n').trim()
  return combined.length > 0 ? combined.slice(0, 2000) : null
}
