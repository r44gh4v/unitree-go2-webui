// What the audio hub's play-state topic means for the operator.
//
// The robot only pushes this topic when a track starts, stops or advances, and
// across firmware versions it has spelled the same two facts - which track,
// doing what - several ways. The normalisation is wire knowledge, so it lives
// here with a test rather than inside the Media panel's subscribe callback.
//
// Imports only wireJson, with the extension, so node loads it straight from
// source for the tests - see CLAUDE.md's testing constraints.

import { parseMaybeJson } from './wireJson.ts'

/**
 * The "Playing:" row for one play-state frame.
 *
 * Three answers, three meanings: a string is what to show, null is a real
 * report that nothing is playing, and undefined means the frame carried no
 * usable report - keep showing whatever was known before.
 */
export function playbackLabel(d: unknown): string | null | undefined {
  const s = parseMaybeJson<Record<string, unknown>>(d)
  if (!s || typeof s !== 'object') return undefined
  const name = s.CUSTOM_NAME ?? s.custom_name ?? s.name ?? s.unique_id ?? s.UNIQUE_ID
  const status = s.status ?? s.state ?? s.play_state
  return typeof name === 'string' ? `${name}${status ? ` - ${status}` : ''}` : status ? String(status) : null
}
