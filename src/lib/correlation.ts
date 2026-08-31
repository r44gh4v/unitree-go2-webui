// Matching a reply to the request that asked for it.
//
// The robot echoes this number back in the response header and nothing else
// identifies the pair, so two live requests sharing one id means the console
// resolves the wrong promise - and, because the map is keyed on it, the first
// request never settles at all while the second's entry gets deleted by the
// first's timeout. Uniqueness is the whole job.
//
// The previous implementation was (Date.now() % 2^31) + random(0..999), which
// drew from one thousand values per millisecond. A burst of api calls in a
// single tick - which is what happens on connect, when four queries go out at
// once - collided at the birthday bound rather than the naive 1-in-1000.

/**
 * Ids start from the current time so they look like what the firmware and the
 * reference implementations produce, and so two console tabs against one robot
 * are unlikely to overlap. Within a session they only ever ascend.
 */
let next = Date.now() % 1000000000

/**
 * The next correlation id. Unique within this session, ascending, and inside
 * signed 32-bit range because that is what the wire format uses.
 */
export function nextRequestId(): number {
  next += 1
  // A session would have to mint a billion ids to reach the ceiling, but wrap
  // rather than silently leave the range the firmware expects.
  if (next > 2147483647) next = 1
  return next
}
