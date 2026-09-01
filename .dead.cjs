const fs = require('fs')
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8').replace(/\r/g, '')
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`${file}: missing ${JSON.stringify(from.slice(0, 55))}`)
    s = s.split(from).join(to)
  }
  fs.writeFileSync(file, s)
}

// Left behind when signalling moved out - connect() reads route.method now.
edit('src/lib/go2.ts', [
  ["    let method = opts.method ?? 'ip'\n    let targetIp = opts.ip ?? ''\n", ''],
  ["import { decodeVoxelMesh, type VoxelMesh } from './voxel'", "import { decodeVoxelMesh } from './voxel'"],
])

// Left behind when the telemetry feed and fault parsing moved out.
edit('src/state/RobotContext.tsx', [
  ['  describeError,\n', ''],
  ['const TRAFFIC_LIMIT = 500\n', ''],
  ['const UI_FLUSH_MS = 150\n', ''],
  // Real: setAudio/setVideo close over linkState but did not declare it.
  ['      linkState.setAudioOn(on)\n    },\n    [conn],', '      linkState.setAudioOn(on)\n    },\n    [conn, linkState],'],
])

edit('src/App.tsx', [["import { useEffect, useRef, useState } from 'react'", "import { useEffect, useState } from 'react'"]])
edit('src/panels/ConnectPanel.tsx', [["import type { CloudRobot, ConnectMethod, DiscoveredRobot } from '../lib/types'", "import type { ConnectMethod, DiscoveredRobot } from '../lib/types'"]])

// Real: a ref read in cleanup is read at teardown, not at setup. Capturing it
// inside the effect is the difference between clearing the set this effect
// owned and clearing whatever happens to be current when React tears down.
edit('src/hooks/useDriveLoop.ts', [
  [
    `    return () => {
      clearInterval(id)`,
    `    // Captured here rather than read in the cleanup: by the time cleanup
    // runs these refs may point at a later render's values, and the intent is
    // to settle the loop this effect started.
    const heldKeys = keys.current
    return () => {
      clearInterval(id)`,
  ],
  ['      keys.current.clear()', '      heldKeys.clear()'],
])
console.log('dead code removed, two hook deps corrected')
