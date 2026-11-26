import { useEffect, useState } from 'react'

interface ReactionEmoteProps {
  src: string
  alt: string
  fallback: string
  className?: string
}

/**
 * Renders a NIP-30 custom emoji image with zero-referrer privacy and graceful text fallback on error.
 */
export function ReactionEmote({
  src,
  alt,
  fallback,
  className = 'w-4 h-4 object-contain shrink-0',
}: ReactionEmoteProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed) {
    return <span>{fallback}</span>
  }

  return (
    <img
      src={src}
      alt={alt}
      title={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}
