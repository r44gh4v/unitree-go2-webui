// Small inline-SVG icons. They inherit the current text colour and default to
// 1em, so they sit cleanly beside button labels. Stroke-based and minimal to
// match the flat interface.

interface IconProps {
  size?: number
  className?: string
}

function svg(children: React.ReactNode, extra?: { fill?: boolean }) {
  return function Icon({ size = 16, className }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill={extra?.fill ? 'currentColor' : 'none'}
        stroke={extra?.fill ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {children}
      </svg>
    )
  }
}

export const CameraIcon = svg(
  <>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </>,
)

export const CameraOffIcon = svg(
  <>
    <path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v2l4-3v9" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </>,
)

export const MicIcon = svg(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </>,
)

export const MicOffIcon = svg(
  <>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 12V5a3 3 0 0 0-5.9-.7" />
    <path d="M17 16.9A7 7 0 0 1 5 12v-2m14 2v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </>,
)

export const SpeakerIcon = svg(
  <>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </>,
)

export const SpeakerOffIcon = svg(
  <>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </>,
)

export const PhotoIcon = svg(
  <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>,
)

export const FrameIcon = svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 3v18" />
  </>,
)

export const ExpandIcon = svg(
  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
)

export const StopIcon = svg(<rect x="6" y="6" width="12" height="12" rx="1.5" />, { fill: true })

export const PlugIcon = svg(
  <>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0V8z" />
    <line x1="12" y1="17" x2="12" y2="22" />
  </>,
)

export const CheckIcon = svg(<path d="M20 6L9 17l-5-5" />)

export const AlertIcon = svg(
  <>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>,
)

export const ScanIcon = svg(
  <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </>,
)

export const BatteryIcon = svg(
  <>
    <rect x="1" y="6" width="18" height="12" rx="2" />
    <line x1="23" y1="10" x2="23" y2="14" />
  </>,
)

export const PlayIcon = svg(<path d="M6 4l14 8-14 8V4z" />, { fill: true })

export const PauseIcon = svg(
  <>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </>,
  { fill: true },
)

export const SkipBackIcon = svg(
  <>
    <path d="M19 20L9 12l10-8v16z" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </>,
  { fill: true },
)

export const SkipFwdIcon = svg(
  <>
    <path d="M5 4l10 8-10 8V4z" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </>,
  { fill: true },
)

export const RadarIcon = svg(
  <>
    <path d="M19.07 4.93A10 10 0 1 0 22 12" />
    <path d="M12 12l6-6" />
    <circle cx="12" cy="12" r="4" />
  </>,
)

export const RefreshIcon = svg(
  <>
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
  </>,
)

export const UploadIcon = svg(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </>,
)

export const LightIcon = svg(
  <>
    <path d="M9 18h6M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
  </>,
)

export const MegaphoneIcon = svg(
  <>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5l-9 5H4a1 1 0 0 0-1 1z" />
    <path d="M18 8a4 4 0 0 1 0 8" />
  </>,
)

export const ShieldIcon = svg(
  <>
    <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
    <path d="M9 12l2 2 4-4" />
  </>,
)

export const GamepadIcon = svg(
  <>
    <line x1="6" y1="11" x2="10" y2="11" />
    <line x1="8" y1="9" x2="8" y2="13" />
    <line x1="15" y1="12" x2="15.01" y2="12" />
    <line x1="18" y1="10" x2="18.01" y2="10" />
    <rect x="2" y="6" width="20" height="12" rx="6" />
  </>,
)

export const BoltIcon = svg(<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />, { fill: true })

export const TerminalIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </>,
)

export const EyeIcon = svg(
  <>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)

export const SunIcon = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
)

export const MoonIcon = svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />)
