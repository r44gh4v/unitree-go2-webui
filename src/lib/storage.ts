// Reading and writing the small things the console remembers.
//
// localStorage is not always there. Safari in private browsing, a browser with
// site data blocked, and an iframe with third-party storage disabled all throw
// on access rather than returning nothing - and the throw comes from the getter
// itself, so even a read has to be guarded.
//
// Everything remembered here is a convenience: a pane width, the last address,
// which connection method was used. None of it is worth taking the console down
// for, so storage that refuses is treated as storage that is empty.

/** The remembered value, or null if there is none or storage refused. */
export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Remember a value. Silently does nothing if storage refuses. */
export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* nothing is remembered this session; the console still works */
  }
}

/** Forget a value. Silently does nothing if storage refuses. */
export function forgetSetting(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to clear if there was nowhere to store it */
  }
}
