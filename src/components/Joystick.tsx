import { useCallback, useEffect, useRef, useState } from 'react'

export interface JoystickProps {
  label: string
  size?: number
  /** normalized vector, each axis in [-1, 1]; y is +up */
  onChange: (x: number, y: number) => void
  disabled?: boolean
}

export default function Joystick({ label, size = 132, onChange, disabled }: JoystickProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const pointerId = useRef<number | null>(null)

  const compute = useCallback((e: PointerEvent | React.PointerEvent) => {
    const pad = padRef.current
    if (!pad) return { x: 0, y: 0 }
    const r = pad.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let x = (e.clientX - cx) / (r.width / 2)
    let y = -(e.clientY - cy) / (r.height / 2)
    const mag = Math.hypot(x, y)
    if (mag > 1) {
      x /= mag
      y /= mag
    }
    return { x, y }
  }, [])

  const onDown = (e: React.PointerEvent) => {
    if (disabled) return
    pointerId.current = e.pointerId
        padRef.current?.setPointerCapture(e.pointerId)
    const v = compute(e)
    setDrag(v)
    onChange(v.x, v.y)
  }

  useEffect(() => {
    const pad = padRef.current
    if (!pad) return
    const move = (e: PointerEvent) => {
      if (pointerId.current === null || e.pointerId !== pointerId.current) return
      const v = compute(e)
      setDrag(v)
      onChange(v.x, v.y)
    }
    const up = (e: PointerEvent) => {
      if (pointerId.current === null || e.pointerId !== pointerId.current) return
      pointerId.current = null
      setDrag(null)
      onChange(0, 0)
    }
    pad.addEventListener('pointermove', move)
    pad.addEventListener('pointerup', up)
    pad.addEventListener('pointercancel', up)
    return () => {
      pad.removeEventListener('pointermove', move)
      pad.removeEventListener('pointerup', up)
      pad.removeEventListener('pointercancel', up)
    }
  }, [compute, onChange])

  const pos = drag ?? { x: 0, y: 0 }
  // nub travels up to 33% of pad radius from center
  const tx = pos.x * size * 0.33
  const ty = -pos.y * size * 0.33
  const c = size / 2
  const ticks = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const cardinal = i % 6 === 0
    const r1 = c - 3
    const r2 = c - (cardinal ? 11 : 7)
    ticks.push(
      <line
        key={i}
        x1={c + Math.cos(a) * r1}
        y1={c + Math.sin(a) * r1}
        x2={c + Math.cos(a) * r2}
        y2={c + Math.sin(a) * r2}
        stroke={cardinal ? 'var(--line-strong)' : 'var(--line)'}
        strokeWidth={cardinal ? 1.5 : 1}
      />,
    )
  }

  return (
    <div className={`joystick${drag ? ' engaged' : ''}${disabled ? ' disabled' : ''}`} style={{ opacity: disabled ? 0.45 : 1 }}>
      <div
        ref={padRef}
        className="pad"
        style={{ width: size, height: size }}
        onPointerDown={onDown}
        role="application"
        aria-label={label}
      >
        <svg width={size} height={size}>
          {ticks}
          <circle cx={c} cy={c} r={c * 0.62} fill="none" stroke="var(--line-strong)" strokeWidth={1} />
          <line x1={c - 7} y1={c} x2={c + 7} y2={c} stroke="var(--faint)" strokeWidth={1} />
          <line x1={c} y1={c - 7} x2={c} y2={c + 7} stroke="var(--faint)" strokeWidth={1} />
        </svg>
        <div className="nub" style={{ transform: `translate(${tx}px, ${ty}px)` }} />
      </div>
      <div className="cap">{label}</div>
    </div>
  )
}
