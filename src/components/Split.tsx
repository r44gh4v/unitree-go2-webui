import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

interface SplitProps {
  /** 'vertical' puts the gutter between side-by-side panes */
  direction?: 'vertical' | 'horizontal'
  /** starting size of the first pane, in pixels */
  initial: number
  min?: number
  max?: number
  /** remembers the size across sessions when set */
  storageKey?: string
  children: [ReactNode, ReactNode]
}

/**
 * Two panes with a draggable gutter. The first pane is sized, the second takes
 * the remaining space, so the layout stays sane when the window resizes.
 * Double-click the gutter to return to the starting size.
 */
export default function Split({ direction = 'vertical', initial, min = 140, max = 900, storageKey, children }: SplitProps) {
  const [size, setSize] = useState(() => {
    if (!storageKey) return initial
    const saved = Number(localStorage.getItem(storageKey))
    return Number.isFinite(saved) && saved >= min ? saved : initial
  })
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const vertical = direction === 'vertical'

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(size))
  }, [size, storageKey])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  // Listening on the window rather than the handle means the drag survives the
  // pointer moving faster than the 5px gutter can follow.
  useEffect(() => {
    if (!dragging) return

    const move = (e: PointerEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const raw = vertical ? e.clientX - rect.left : e.clientY - rect.top
      const limit = vertical ? rect.width : rect.height
      // always leave room for the second pane, whatever the caller asked for
      setSize(Math.max(min, Math.min(Math.min(max, limit - min), raw)))
    }
    const stop = () => setDragging(false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, vertical, min, max])

  // Keyboard resizing keeps the layout reachable without a pointer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const back = vertical ? 'ArrowLeft' : 'ArrowUp'
    const fwd = vertical ? 'ArrowRight' : 'ArrowDown'
    const step = e.shiftKey ? 48 : 16
    if (e.key === back) setSize((s) => Math.max(min, s - step))
    else if (e.key === fwd) setSize((s) => Math.min(max, s + step))
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: vertical ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        // stop the cursor flickering to a text caret mid-drag
        userSelect: dragging ? 'none' : undefined,
      }}
    >
      <div className="pane" style={vertical ? { width: size, flex: 'none' } : { height: size, flex: 'none' }}>
        {children[0]}
      </div>

      <div
        className={`gutter ${direction}${dragging ? ' dragging' : ''}`}
        role="separator"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setSize(initial)}
        onKeyDown={onKeyDown}
        title="Drag to resize, double-click to reset"
      />

      <div className="pane" style={{ flex: 1 }}>
        {children[1]}
      </div>
    </div>
  )
}
