// Who owns the keyboard.
//
// The console drives from the keyboard, so anything that swallows a keypress
// takes the robot with it. The rule is narrow on purpose: only a control the
// operator is genuinely typing into gets the keys.

/**
 * Input types that consume a keypress as text or as a value. Everything else
 * an <input> can be - a range, a checkbox, a radio, a button - does not, and
 * treating those as typing is what stopped WASD working after touching a
 * speed slider.
 */
const TEXT_ENTRY_TYPES = new Set([
  'text',
  'password',
  'email',
  'number',
  'search',
  'url',
  'tel',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
])

/** Is this element one the operator types into? */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  // A missing or unrecognised type is a text field, per the HTML spec.
  const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text'
  return TEXT_ENTRY_TYPES.has(type)
}
