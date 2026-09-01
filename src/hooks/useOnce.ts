import { useRef } from 'react'

/**
 * A value built once, on the first render that needs it.
 *
 * `useRef(new Thing())` reads as "make one of these and keep it", and keeps
 * the right one - but it constructs a fresh Thing on every single render and
 * throws all but the first away. Harmless for a Set; not harmless for a
 * WebRTC connection or anything that registers itself on construction.
 *
 * This says the same thing and means it.
 */
export function useOnce<T>(make: () => T): T {
  const held = useRef<T | null>(null)
  if (held.current === null) held.current = make()
  return held.current
}
