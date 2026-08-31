// What counts as a robot address.
//
// The address arrives in a request body and is interpolated into a URL the
// server then fetches, so without a check it decides where the server connects.
// "evil.com:80/path#" is enough: the fragment truncates the rest of the
// template and the proxy talks to whatever is on the other end.
//
// A dotted-quad IPv4 literal is the only thing the robot is ever reached at -
// discovery returns one, the access point is a fixed one, and the operator
// types one. Nothing else needs to be allowed, so nothing else is.

/** A robot address: four decimal octets, nothing else, no port or path. */
export function isRobotAddress(value) {
  if (typeof value !== 'string') return false
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
