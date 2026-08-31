// The robot sometimes sends JSON as a string, and sometimes as an object.
//
// The same field can arrive either way depending on the topic and the firmware,
// so every reader has to cope with both. Two places had grown their own version
// of this and they did not agree on what to do with the awkward cases.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'wireJson.ts')
const { parseMaybeJson } = await import('file://' + modPath.replace(/[\u005c]/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[wirejson] already decoded')
{
  check('an object passes through', parseMaybeJson({ a: 1 }), { a: 1 })
  check('an array passes through', parseMaybeJson([1, 2]), [1, 2])
  check('a number passes through', parseMaybeJson(7), 7)
  check('a boolean passes through', parseMaybeJson(true), true)
}

console.log('[wirejson] sent as a string')
{
  check('an object in a string', parseMaybeJson('{"enable":true}'), { enable: true })
  check('an array in a string', parseMaybeJson('[1,2]'), [1, 2])
  check('a number in a string', parseMaybeJson('42'), 42)
  check('a boolean in a string', parseMaybeJson('false'), false)
}

console.log('[wirejson] nothing usable')
{
  check('null', parseMaybeJson(null), null)
  check('undefined', parseMaybeJson(undefined), null)
  check('an empty string is absence, not an error', parseMaybeJson(''), null)
}
{
  // A string that is not JSON is a real case: some topics carry plain text.
  // Returning it unchanged beats throwing, and beats returning null - the
  // caller asked to decode if possible, not to insist.
  check('plain text comes back as itself', parseMaybeJson('lidar ok'), 'lidar ok')
  check('a broken fragment comes back as itself', parseMaybeJson('{oh no'), '{oh no')
}
{
  // JSON.parse('null') is a valid parse producing null, which must not be
  // confused with a failure to parse.
  check('the string null decodes to null', parseMaybeJson('null'), null)
}

finish()
