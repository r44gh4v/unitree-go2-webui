// What the operator is asking the robot to do, from three inputs at once.
//
// A pointer on the dial, keys held down, and a gamepad can all be live in the
// same tick, and the rules for combining them decide what a 15kg robot does.
// They used to exist only as statements inside a 20Hz loop, where the only way
// to check one was to drive a real robot and watch.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'driveInput.ts')
const { demandFrom, approach, DEADZONE } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

const ZERO = { x: 0, y: 0, z: 0 }
const keys = (...k) => new Set(k)
const round = (v) => ({ x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) })

console.log('[driveinput] nothing held')
{
  check('no input is rest', demandFrom({ stick: ZERO, keys: keys(), pad: null }), ZERO)
}

console.log('[driveinput] the pointer')
{
  check('the dial passes through', demandFrom({ stick: { x: 0.5, y: -0.25, z: 0.1 }, keys: keys(), pad: null }), {
    x: 0.5, y: -0.25, z: 0.1,
  })
}

console.log('[driveinput] keys')
{
  check('w walks forward', demandFrom({ stick: ZERO, keys: keys('w'), pad: null }).y, 1)
  check('s walks back', demandFrom({ stick: ZERO, keys: keys('s'), pad: null }).y, -1)
  check('a strafes left', demandFrom({ stick: ZERO, keys: keys('a'), pad: null }).x, -1)
  check('d strafes right', demandFrom({ stick: ZERO, keys: keys('d'), pad: null }).x, 1)
  // Measured on hardware: q turns left, e turns right, and z is positive-is-left.
  check('q turns one way', demandFrom({ stick: ZERO, keys: keys('q'), pad: null }).z, 1)
  check('e turns the other', demandFrom({ stick: ZERO, keys: keys('e'), pad: null }).z, -1)
  check('arrows match wasd', demandFrom({ stick: ZERO, keys: keys('arrowup'), pad: null }).y, 1)
}
{
  // Both directions of one axis held is a contradiction; the later rule wins,
  // deterministically, rather than the two cancelling to a surprising zero.
  const d = demandFrom({ stick: ZERO, keys: keys('w', 's'), pad: null })
  check('opposite keys resolve deterministically', d.y, -1)
}
{
  check('a key overrides the dial', demandFrom({ stick: { x: 0, y: 0.3, z: 0 }, keys: keys('w'), pad: null }).y, 1)
}

console.log('[driveinput] the gamepad')
{
  const pad = { axes: [0.8, -0.6, 0, 0] }
  const d = demandFrom({ stick: ZERO, keys: keys(), pad })
  check('left stick x strafes', d.x, 0.8)
  // Axis 1 is pushed away from the operator for forward, so it is inverted.
  check('left stick y is inverted for forward', d.y, 0.6)
}
{
  const pad = { axes: [0, 0, -0.5, 0] }
  check('right stick x turns', demandFrom({ stick: ZERO, keys: keys(), pad }).z, 0.5)
}
{
  // A resting stick reports small non-zero values forever. Without a deadzone
  // the robot would creep whenever a pad is merely plugged in.
  const pad = { axes: [DEADZONE - 0.001, DEADZONE - 0.001, DEADZONE - 0.001, 0] }
  check('drift inside the deadzone is ignored', demandFrom({ stick: ZERO, keys: keys(), pad }), ZERO)
}
{
  // The left stick is one control, so deflecting it replaces the whole
  // translation demand rather than merging axis by axis with the keyboard.
  const pad = { axes: [0.9, 0, 0, 0] }
  const d = demandFrom({ stick: ZERO, keys: keys('w'), pad })
  check('the pad takes over translation from the keys', d, { x: 0.9, y: 0, z: 0 })
}
{
  // Turning is a separate control, so a resting right stick leaves q/e alone.
  const pad = { axes: [0.9, 0, 0, 0] }
  check('a resting turn stick does not cancel the keys', demandFrom({ stick: ZERO, keys: keys('q'), pad }).z, 1)
}
{
  check('a missing pad is simply absent', demandFrom({ stick: { x: 0.2, y: 0, z: 0 }, keys: keys(), pad: null }).x, 0.2)
}

console.log('[driveinput] diagonals stay inside full travel')
{
  // w and d together asked for 1.41x the straight-line speed, which on its own
  // was enough to make a diagonal walk look unsteady.
  const d = round(demandFrom({ stick: ZERO, keys: keys('w', 'd'), pad: null }))
  check('a diagonal is normalised', d, { x: 0.7071, y: 0.7071, z: 0 })
  check('and its magnitude is one', +Math.hypot(d.x, d.y).toFixed(3), 1)
}
{
  const d = demandFrom({ stick: { x: 0.3, y: 0.4, z: 0 }, keys: keys(), pad: null })
  check('an input already inside the circle is untouched', round(d), { x: 0.3, y: 0.4, z: 0 })
}
{
  // Turning is its own axis and is not part of the translation circle.
  const d = demandFrom({ stick: ZERO, keys: keys('w', 'd', 'q'), pad: null })
  check('turn is not scaled by the translation limit', d.z, 1)
}

console.log('[driveinput] ramping toward the demand')
{
  check('rises at the ramp-up rate', approach(0, 1), 0.5)
  check('two ticks reach full travel', approach(approach(0, 1), 1), 1)
  // Release must never trail the key: letting go stops now.
  check('falls to rest in one tick', approach(1, 0), 0)
  check('falls from part travel in one tick', approach(0.5, 0), 0)
  check('a reversal is not slewed through zero slowly', approach(1, -1), 0)
  check('already there stays there', approach(0.25, 0.25), 0.25)
  check('a small step lands exactly', approach(0, 0.1), 0.1)
}

finish()
