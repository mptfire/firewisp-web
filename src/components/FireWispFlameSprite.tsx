export function FireWispFlameSprite({
  idPrefix,
  variant = 'ember',
}: {
  idPrefix: string
  variant?: 'ember' | 'white' | 'green'
}) {
  const outerId = `${idPrefix}-wisp-outer`
  const coreId = `${idPrefix}-wisp-core`
  const palette =
    variant === 'white'
      ? {
          o0: '#94a3b8',
          o1: '#cbd5e1',
          o2: '#f1f5f9',
          o3: '#ffffff',
          c0: '#ffffff',
          c1: '#f8fafc',
          c2: '#e2e8f0',
          sideTop: '#e2e8f0',
          sideBot: '#cbd5e1',
          heart: '#ffffff',
          heartOp: '0.98',
          spark: '#f8fafc',
        }
      : variant === 'green'
        ? {
            o0: '#047857',
            o1: '#10b981',
            o2: '#34d399',
            o3: '#a7f3d0',
            c0: '#ecfdf5',
            c1: '#6ee7b7',
            c2: '#34d399',
            sideTop: '#10b981',
            sideBot: '#059669',
            heart: '#ecfdf5',
            heartOp: '0.95',
            spark: '#6ee7b7',
          }
        : {
            o0: '#c92a2a',
            o1: '#e8590c',
            o2: '#ff922b',
            o3: '#ffd43b',
            c0: '#fff9db',
            c1: '#ffd43b',
            c2: '#ff922b',
            sideTop: '#e8590c',
            sideBot: '#d9480f',
            heart: '#fff9db',
            heartOp: '0.92',
            spark: '#ff922b',
          }
  return (
    <svg
      viewBox="0 0 28 20"
      width="24"
      height="17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full overflow-visible"
    >
      <defs>
        <linearGradient id={outerId} x1="2" y1="10" x2="26" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.o0} />
          <stop offset="45%" stopColor={palette.o1} />
          <stop offset="82%" stopColor={palette.o2} />
          <stop offset="100%" stopColor={palette.o3} />
        </linearGradient>
        <radialGradient id={coreId} cx="76%" cy="50%" r="55%">
          <stop offset="0%" stopColor={palette.c0} />
          <stop offset="48%" stopColor={palette.c1} />
          <stop offset="100%" stopColor={palette.c2} />
        </radialGradient>
      </defs>
      {/* Upper & lower curving side flame wisps matching the Fire Wisp logo */}
      <path
        d="M19.6 3.7C16.8 1.5 12.8 1.5 9.4 3.4C12.2 3.0 14.8 3.6 17.0 4.6C18.0 4.4 18.9 4.1 19.6 3.7Z"
        fill={palette.sideTop}
      />
      <path
        d="M20.0 16.0C17.0 18.2 13.2 18.1 10.0 16.2C12.7 16.6 15.2 16.0 17.4 15.1C18.4 15.3 19.3 15.6 20.0 16.0Z"
        fill={palette.sideBot}
      />
      {/* Main sweeping S-curved Fire Wisp body */}
      <path
        d="M25.5 10C25.5 6.4 22.4 4.2 18.2 4.5C14.8 4.7 12.2 6.3 8.8 5.8C6.0 5.4 4.1 3.6 2.2 4.6C4.4 7.0 6.8 8.6 9.6 9.4C6.6 10.2 4.6 11.4 3.0 13.0C5.8 13.3 8.6 12.4 11.6 13.2C15.2 14.3 18.0 15.8 21.4 15.2C24.0 14.7 25.5 12.6 25.5 10Z"
        fill={`url(#${outerId})`}
      />
      {/* Bright inner flame core */}
      <path
        d="M23.6 10C23.6 7.5 21.3 6.0 18.3 6.3C15.5 6.6 13.4 8.2 9.2 8.2C12.6 9.4 13.8 10.9 11.2 12.0C14.4 12.2 16.8 13.6 19.6 13.5C22.1 13.4 23.6 12.0 23.6 10Z"
        fill={`url(#${coreId})`}
      />
      {/* Luminous wisp heart, cute wisp eyes & floating sparks */}
      <ellipse
        cx="20.5"
        cy="10"
        rx="3.2"
        ry="2.8"
        fill={palette.heart}
        fillOpacity={palette.heartOp}
      />
      <circle cx="21.4" cy="8.2" r="1.15" fill="#111218" />
      <circle cx="21.8" cy="7.85" r="0.35" fill="#ffffff" />
      <circle cx="21.4" cy="11.8" r="1.15" fill="#111218" />
      <circle cx="21.8" cy="11.45" r="0.35" fill="#ffffff" />
      <path
        d="M6.8 2.2C5.6 1.7 4.7 2.4 4.2 3.1C5.2 3.1 6.2 2.9 6.8 2.2Z"
        fill={palette.spark}
      />
      <path
        d="M8.0 17.2C6.9 17.5 6.0 16.9 5.5 16.2C6.5 16.2 7.4 16.5 8.0 17.2Z"
        fill={palette.spark}
      />
    </svg>
  )
}
