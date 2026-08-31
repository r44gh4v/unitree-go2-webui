import { useEffect, useState } from 'react'

/**
 * A field the console remembers between visits.
 *
 * The connect panel had six of these - the method, address, serial, device key,
 * email and region - each written out by hand as a useState with a localStorage
 * read in its initialiser and a useEffect to write it back. Six copies of one
 * idea, each able to drift from the others, and two of them already had.
 *
 * Storage can throw: Safari in private mode, and any browser with site data
 * blocked. A remembered field is a convenience, so it degrades to an ordinary
 * piece of state rather than taking the panel down with it.
 */
export function useRemembered(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* nothing is remembered this session; the console still works */
    }
  }, [key, value])

  return [value, setValue]
}
