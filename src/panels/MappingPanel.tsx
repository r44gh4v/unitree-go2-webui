import { useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { TOPICS } from '../lib/constants'
import { EyeIcon } from '../components/Icons'

/**
 * The SLAM module is driven by plain strings on rt/uslam/client_command -
 * "module/action/arg/arg" - and answers with log lines on rt/uslam/server_log.
 * It is not the API-id protocol the rest of the robot uses.
 */

interface CommandGroup {
  label: string
  note?: string
  items: { cmd: string; label: string; args?: { name: string; value: number }[]; note?: string }[]
}

const GROUPS: CommandGroup[] = [
  {
    label: 'Mapping',
    note: 'Builds a map of the space. The robot has one map slot, so a new map replaces the old one.',
    items: [
      { cmd: 'mapping/start', label: 'Start mapping' },
      { cmd: 'mapping/stop', label: 'Stop mapping', note: 'Does not assign a map id - set one below afterwards' },
      { cmd: 'mapping/cancel', label: 'Cancel' },
      { cmd: 'mapping/get_status', label: 'Status' },
      { cmd: 'mapping/get_cloud_map', label: 'Fetch cloud map' },
    ],
  },
  {
    label: 'Localisation',
    note: 'Works out where the robot is on the saved map. Give it a starting guess if it cannot find itself.',
    items: [
      { cmd: 'localization/start', label: 'Start' },
      { cmd: 'localization/stop', label: 'Stop' },
      { cmd: 'localization/get_status', label: 'Status' },
      {
        cmd: 'localization/set_initial_pose',
        label: 'Set starting pose',
        args: [
          { name: 'x', value: 0 },
          { name: 'y', value: 0 },
          { name: 'yaw', value: 0 },
        ],
        note: 'Yaw is in radians, counter-clockwise from the map x axis',
      },
    ],
  },
  {
    label: 'Navigation',
    note: 'Walks to a point on the map. Localization has to succeed first.',
    items: [
      { cmd: 'navigation/start', label: 'Start' },
      { cmd: 'navigation/stop', label: 'Stop' },
      { cmd: 'navigation/get_status', label: 'Status' },
      {
        cmd: 'navigation/set_goal_pose',
        label: 'Go to point',
        args: [
          { name: 'x', value: 1 },
          { name: 'y', value: 0 },
          { name: 'yaw', value: 0 },
        ],
      },
    ],
  },
  {
    label: 'Patrol',
    note: 'Points must be added in the window right after Start; the module rejects them once it is idle.',
    items: [
      { cmd: 'patrol/start', label: 'Start (do this first)' },
      { cmd: 'patrol/clear_all_patrol_points', label: 'Clear points' },
      {
        cmd: 'patrol/add_patrol_point',
        label: 'Add point',
        args: [
          { name: 'x', value: 0 },
          { name: 'y', value: 0 },
          { name: 'yaw', value: 0 },
        ],
      },
      { cmd: 'patrol/get_patrol_points', label: 'List points' },
      { cmd: 'patrol/go', label: 'Begin patrolling' },
      { cmd: 'patrol/pause', label: 'Pause' },
      { cmd: 'patrol/stop', label: 'Stop' },
      { cmd: 'patrol/get_status', label: 'Status' },
      { cmd: 'patrol/set_patrol_number_limit', label: 'Lap limit', args: [{ name: 'laps', value: 1 }] },
      { cmd: 'patrol/set_total_time_limit', label: 'Time limit', args: [{ name: 'seconds', value: 600 }] },
      {
        cmd: 'patrol/set_bms_soc_limit',
        label: 'Battery limits',
        args: [
          { name: 'min', value: 20 },
          { name: 'max', value: 90 },
        ],
        note: 'Zero and one hundred are rejected; stay inside 1 to 99',
      },
    ],
  },
  {
    label: 'Charging dock',
    items: [
      { cmd: 'autocharge/start', label: 'Dock now' },
      { cmd: 'autocharge/stop', label: 'Stop docking' },
      { cmd: 'autocharge/get_status', label: 'Status' },
      { cmd: 'autocharge/set_plate_distance', label: 'Plate distance', args: [{ name: 'metres', value: 0.5 }] },
      { cmd: 'autocharge/go_back_charge_and_stop_patrol', label: 'Return and charge' },
    ],
  },
  {
    label: 'Lidar pipeline',
    items: [
      { cmd: 'frontend/start', label: 'Start' },
      { cmd: 'frontend/stop', label: 'Stop' },
      { cmd: 'frontend/restart', label: 'Restart' },
      { cmd: 'frontend/get_status', label: 'Status' },
    ],
  },
  {
    label: 'Map slot',
    items: [
      { cmd: 'common/get_map_id', label: 'Read map id' },
      { cmd: 'common/set_map_id', label: 'Set map id', args: [{ name: 'id', value: 1 }] },
      { cmd: 'common/enable_joystick_control', label: 'Allow the remote' },
      { cmd: 'common/disable_joystick_control', label: 'Ignore the remote' },
    ],
  },
]

export default function MappingPanel() {
  const { conn, connState, log } = useRobot()
  const connected = connState === 'connected'
  const [enabled, setEnabled] = useState(false)
  const [serverLog, setServerLog] = useState<string[]>([])
  const [args, setArgs] = useState<Record<string, number[]>>({})
  const [downloading, setDownloading] = useState(false)
  const [dlStatus, setDlStatus] = useState('')
  const restoreRef = useRef<HTMLInputElement>(null)

  // Restore a previously downloaded bundle onto the robot's single map slot.
  const restoreMap = async (picked: FileList) => {
    const wanted = ['map.pcd', 'map.pgm', 'map.txt']
    const files = [...picked].filter((f) => wanted.includes(f.name))
    if (!files.some((f) => f.name === 'map.pcd')) {
      setDlStatus('Pick the downloaded map files - map.pcd is required.')
      return
    }
    setDownloading(true)
    try {
      const bundle = await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      )
      await conn.files.uploadMap(bundle, (name, frac) => setDlStatus(`Sending ${name} ${Math.round(frac * 100)}%…`))
      setDlStatus(`Restored ${bundle.map((b) => b.name).join(', ')}. Set the map id, then start localisation.`)
    } catch (e) {
      setDlStatus(`Restore failed: ${(e as Error).message}`)
    } finally {
      setDownloading(false)
    }
  }
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || !connected) return
    const unsub = conn.subscribe(TOPICS.USLAM_SERVER_LOG, (d) => {
      const text = typeof d === 'string' ? d : JSON.stringify(d)
      setServerLog((prev) => [...prev, text].slice(-200))
    })
    return unsub
  }, [enabled, connected, conn])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [serverLog])

  const send = (cmd: string) => {
    conn.publish(TOPICS.USLAM_CMD, cmd)
    setServerLog((prev) => [...prev, `> ${cmd}`].slice(-200))
  }

  const sendWithArgs = (item: CommandGroup['items'][number]) => {
    const values = args[item.cmd] ?? item.args!.map((a) => a.value)
    // The module parses these positionally, three decimal places.
    send(`${item.cmd}/${values.map((v) => v.toFixed(3)).join('/')}`)
  }

  const saveBytes = (name: string, bytes: Uint8Array) => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadMap = async () => {
    setDownloading(true)
    setDlStatus('Asking the robot for the map…')
    try {
      const files = await conn.files.downloadMap((f) => setDlStatus(`Fetching ${f}…`))
      if (!files.length) {
        setDlStatus('The robot returned no map data - build a map first.')
        return
      }
      files.forEach((f) => saveBytes(f.name, f.bytes))
      const kb = files.reduce((n, f) => n + f.bytes.length, 0) / 1024
      setDlStatus(`Saved ${files.map((f) => f.name).join(', ')} · ${kb.toFixed(0)} KB.`)
    } catch (e) {
      setDlStatus(`Download failed: ${(e as Error).message}`)
    } finally {
      setDownloading(false)
    }
  }

  if (!connected) {
    return (
      <div className="section">
        <p className="note">Mapping controls appear once the robot is connected</p>
      </div>
    )
  }

  return (
    <div className="section">
      <p className="eyebrow">Mapping and navigation</p>
      <p className="note">
        These drive the robot's SLAM module, which builds a map, works out where the robot is on it, and walks to
        points you choose. It needs the lidar running and only exists on firmware that ships the mapping service.
      </p>

      <label className={`toggle${enabled ? ' on' : ''}`} style={{ marginBottom: 10 }} title="Subscribe to the SLAM module's log so you can see command replies">
        <span className="toggle-label">
          <EyeIcon size={15} />
          Watch the mapping log
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />
        <span className="track" />
      </label>

      {!enabled && <p className="note warn">Turn the log on before sending commands, or you will not see the replies.</p>}

      <div style={{ marginBottom: 14 }}>
        <p className="eyebrow">Save the map</p>
        <p className="note">
          Pulls the built map off the robot - the point cloud (map.pcd) plus the occupancy grid and metadata
          (map.pgm, map.txt) when present - and saves them to your computer. Build or load a map first.
        </p>
        <button className="btn sm block" title="Download map.pcd, map.pgm and map.txt from the robot" onClick={downloadMap} disabled={downloading}>
          {downloading ? 'Downloading…' : 'Download map'}
        </button>
        <input
          ref={restoreRef}
          type="file"
          multiple
          accept=".pcd,.pgm,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) void restoreMap(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          className="btn sm block"
          style={{ marginTop: 4 }}
          title="Send a downloaded map bundle back to the robot's single map slot"
          onClick={() => restoreRef.current?.click()}
          disabled={downloading}
        >
          Restore a saved map
        </button>
        {dlStatus && <p className={`note${dlStatus.includes('failed') || dlStatus.includes('no map') || dlStatus.includes('required') ? ' warn' : ''}`}>{dlStatus}</p>}
      </div>

      {GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 14 }}>
          <p className="eyebrow">{g.label}</p>
          {g.note && <p className="note">{g.note}</p>}
          {g.items.map((item) =>
            item.args ? (
              <div key={item.cmd} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {item.args.map((a, i) => (
                    <input
                      key={a.name}
                      className="input"
                      style={{ width: 62, padding: '4px 6px', fontSize: 12 }}
                      type="number"
                      step="0.1"
                      aria-label={`${item.label} ${a.name}`}
                      title={a.name}
                      value={(args[item.cmd] ?? item.args!.map((x) => x.value))[i]}
                      onChange={(e) => {
                        const next = [...(args[item.cmd] ?? item.args!.map((x) => x.value))]
                        next[i] = Number(e.target.value)
                        setArgs((prev) => ({ ...prev, [item.cmd]: next }))
                      }}
                    />
                  ))}
                  <button className="btn sm" style={{ flex: 1 }} title={item.note ?? `Send ${item.cmd} with the values on the left`} onClick={() => sendWithArgs(item)}>
                    {item.label}
                  </button>
                </div>
                {item.note && <p className="note">{item.note}</p>}
              </div>
            ) : (
              <button
                key={item.cmd}
                className="btn sm block"
                style={{ justifyContent: 'space-between', marginBottom: 4 }}
                title={item.note ?? item.cmd}
                onClick={() => send(item.cmd)}
              >
                <span>{item.label}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.cmd.split('/')[1]}</span>
              </button>
            ),
          )}
        </div>
      ))}

      <div className="divider" />
      <p className="eyebrow">Mapping log</p>
      <div ref={logRef} className="log" style={{ height: 220 }}>
        {serverLog.length === 0 && <div className="meta">Nothing yet.</div>}
        {serverLog.map((line, i) => (
          <div key={i} className={line.startsWith('>') ? 'out' : line.includes('fail') ? 'err' : 'in'}>
            {line}
          </div>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn sm ghost" title="Empty the mapping log" onClick={() => setServerLog([])} disabled={!serverLog.length}>
          Clear
        </button>
        <button className="btn sm ghost" title="Replies also go to the Console log" onClick={() => log('Mapping commands are logged in the Console tab too.')}>
          Where are replies?
        </button>
      </div>
    </div>
  )
}
