// What the audio hub's play-state topic means for the "Playing:" row. The
// firmware spells the same two facts several ways across versions; the
// normalisation is wire knowledge, so it is pinned here rather than living
// inside the Media panel.
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const modPath = path.join(here, '..', 'src', 'lib', 'audioPlayback.ts')
const { playbackLabel } = await import('file://' + modPath.replace(/\\/g, '/'))

import { makeChecker } from './harness.mjs'
const { check, finish } = makeChecker()

console.log('[audioplayback] the spellings firmware uses for the same fields')
{
  check('upper-case name', playbackLabel({ CUSTOM_NAME: 'bark' }), 'bark')
  check('lower-case name', playbackLabel({ custom_name: 'bark' }), 'bark')
  check('plain name', playbackLabel({ name: 'bark' }), 'bark')
  check('unique id stands in for a missing name', playbackLabel({ unique_id: 'a1' }), 'a1')
  check('status rides along with the name', playbackLabel({ name: 'bark', status: 'playing' }), 'bark - playing')
  check('state is a spelling of status', playbackLabel({ name: 'bark', state: 'paused' }), 'bark - paused')
  check('play_state is a spelling of status', playbackLabel({ name: 'bark', play_state: 'stopped' }), 'bark - stopped')
}

console.log('[audioplayback] frames without a usable name')
{
  check('status alone is still worth showing', playbackLabel({ status: 'stopped' }), 'stopped')
  check('an empty report means nothing is playing', playbackLabel({}), null)
}

console.log('[audioplayback] the payload may arrive as a JSON string')
{
  check('a stringified report decodes first', playbackLabel('{"name":"bark","status":"playing"}'), 'bark - playing')
  check('plain text is not a report - keep what is shown', playbackLabel('hello'), undefined)
  check('absence is not a report either', playbackLabel(null), undefined)
}

finish()
