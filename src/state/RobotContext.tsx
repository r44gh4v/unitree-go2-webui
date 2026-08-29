import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Go2Connection, unwrapResponse, type ApiResponse, type ConnectOptions, type ConnState, type TrafficEntry } from '../lib/go2'
import {
  DATA_CHANNEL_TYPE,
  MOTION_SWITCHER_API,
  SPORT_CMD,
  SPORT_CMD_MCF,
  TOPICS,
  describeError,
  type ActionSpec,
  type MotionMode,
} from '../lib/constants'
import type { LowState, RobotError, SportModeState } from '../lib/types'

/** sportmodestate.mode while the robot is holding a pose. */
const MODE_POSE = 2

/** How long a deliberate pose change is trusted before telemetry overrules it. */
const POSE_SETTLE_MS = 1500

const TRAFFIC_LIMIT = 500
const UI_FLUSH_MS = 150


export interface RobotApi {
  conn: Go2Connection
  connState: ConnState
  connError: string | null
  ip: string
  lowState: LowState | null
  sportState: SportModeState | null
  traffic: TrafficEntry[]
  robotErrors: RobotError[]
  stream: MediaStream | null
  videoOn: boolean
  audioOn: boolean
  /** while true the drive sticks lean the body instead of walking it */
  posing: boolean
  /**
   * Whether the head lidar is running. The sensor itself, not the map view, so
   * it lives here rather than in the lidar panel: the panel only exists while
   * its tab is open, and stopping a spinning part should not depend on which
   * tab someone happens to be looking at.
   */
  lidarOn: boolean
  /** The robot kept the lidar running after being told to stop. */
  lidarStuck: boolean
  /** Say it again, for a lidar that ignored the last off. */
  retryLidar: () => void
  motionMode: MotionMode
  reportedMode: string | null
  linkStats: { messages: number; bytes: number; topics: number; rate: number }
  setPosing: (v: boolean) => void
  setLidarOn: (v: boolean) => void
  setMotionMode: (m: MotionMode) => void
  connect: (opts: ConnectOptions) => Promise<void>
  /** re-run the last connect attempt, or null if there hasn't been one */
  retry: (() => void) | null
  disconnect: () => void
  setVideo: (on: boolean) => void
  setAudio: (on: boolean) => void
  /** resolved api id for an action under the current motion mode, or null */
  /**
   * Which id to send for an action, and whether the running motion service
   * actually lists it. `exact: false` means we are falling back to another
   * service's id - the robot may well accept it, and if it does not it answers
   * "API not registered", which is a better outcome than the console deciding
   * on the robot's behalf that the button cannot be pressed.
   */
  apiIdFor: (a: ActionSpec) => { apiId: number; exact: boolean; from: MotionMode } | null
  sport: (apiId: number, parameter?: unknown) => Promise<ApiResponse>
  runAction: (a: ActionSpec, toggleOn?: boolean) => Promise<ApiResponse>
  move: (x: number, y: number, z: number) => void
  /**
   * Stick frame on the wireless-controller topic - the wire the handheld
   * remote itself uses, and the only one legion1581/unitree_ui drives with.
   */
  moveSticks: (lx: number, ly: number, rx: number, ry: number) => void
  /** body attitude in radians; only obeyed while the robot is in pose mode */
  setEuler: (roll: number, pitch: number, yaw: number) => void
  stopMove: () => void
  emergencyStop: () => void
  refreshMotionMode: () => Promise<string | null>
  switchMotionMode: (name: string) => Promise<void>
  clearTraffic: () => void
  clearErrors: () => void
  log: (text: string) => void
}

const Ctx = createContext<RobotApi | null>(null)

export function useRobot(): RobotApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRobot must be used inside RobotProvider')
  return v
}

export function RobotProvider({ children }: { children: ReactNode }) {
  const connRef = useRef<Go2Connection | null>(null)
  if (!connRef.current) connRef.current = new Go2Connection()
  const conn = connRef.current

  const [connState, setConnState] = useState<ConnState>('idle')
  const [connError, setConnError] = useState<string | null>(null)
  const [ip, setIp] = useState('')
  const [lowState, setLowState] = useState<LowState | null>(null)
  const [sportState, setSportState] = useState<SportModeState | null>(null)
  const [traffic, setTraffic] = useState<TrafficEntry[]>([])
  const [robotErrors, setRobotErrors] = useState<RobotError[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [videoOn, setVideoOnState] = useState(false)
  const [audioOn, setAudioOnState] = useState(false)
  const [posing, setPosing] = useState(false)
  /**
   * When the operator last changed pose deliberately. Telemetry is the
   * authority on whether the robot is posing, but it lags the command by a
   * flush or two, so a manual change is trusted briefly before the robot gets
   * to overrule it. Without that grace the switch would flick back the
   * instant it was pressed.
   */
  const poseChangedAt = useRef(0)
  const setPosingManually = useCallback((v: boolean) => {
    poseChangedAt.current = Date.now()
    setPosing(v)
  }, [])
  // The robot brings its lidar up with itself, so the switch starts on to
  // match. Starting off would have shown a stopped sensor that was in fact
  // spinning, until someone toggled it twice to sync the two up.
  const [lidarOn, setLidarOn] = useState(true)
  const [motionMode, setMotionMode] = useState<MotionMode>('normal')
  const [reportedMode, setReportedMode] = useState<string | null>(null)
  const [linkStats, setLinkStats] = useState({ messages: 0, bytes: 0, topics: 0, rate: 0 })
  // Tracks the last sample so the flush loop can turn the running message count
  // into a smoothed messages-per-second rate.
  const rateSample = useRef({ messages: 0, at: 0, rate: 0 })

  // High-rate telemetry accumulates in refs; a slow timer flushes it into state
  // so React re-renders at a readable rate instead of hundreds of times a second.
  const pendingLow = useRef<LowState | null>(null)
  const pendingSport = useRef<SportModeState | null>(null)
  const pendingTraffic = useRef<TrafficEntry[]>([])

  useEffect(() => {
    const onState = (e: Event) => {
      const d = (e as CustomEvent).detail as { state: ConnState; error?: string }
      setConnState(d.state)
      setConnError(d.error ?? null)
      if (d.state === 'connected') {
        setIp(conn.ip)
        // Seeing through the robot is the point of opening the console, so the
        // camera comes up with the link rather than waiting to be asked. Audio
        // stays off: it is a live microphone in someone's room.
        conn.setVideo(true)
        setVideoOnState(true)
      }
      if (d.state === 'closed' || d.state === 'error') {
        setVideoOnState(false)
        setAudioOnState(false)
        setPosing(false)
      }
    }
    const onTraffic = (e: Event) => {
      pendingTraffic.current.push((e as CustomEvent).detail as TrafficEntry)
    }
    const onTrack = (e: Event) => {
      setStream((e as CustomEvent).detail.stream as MediaStream)
    }
    const onRobotError = (e: Event) => {
      const d = (e as CustomEvent).detail as { type: string; data: unknown }
      const rows = Array.isArray(d.data) && Array.isArray(d.data[0]) ? (d.data as number[][]) : [d.data as number[]]
      const entries: RobotError[] = []
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 3) continue
        const [ts, source, code] = row
        const { source: srcText, text } = describeError(source, code)
        entries.push({
          ts: ts * 1000,
          source: srcText,
          text,
          cleared: d.type === DATA_CHANNEL_TYPE.RM_ERROR,
        })
      }
      if (entries.length) setRobotErrors((prev) => [...entries, ...prev].slice(0, 80))
    }
    conn.addEventListener('state', onState)
    conn.addEventListener('traffic', onTraffic)
    conn.addEventListener('track', onTrack)
    conn.addEventListener('robot-error', onRobotError)
    return () => {
      conn.removeEventListener('state', onState)
      conn.removeEventListener('traffic', onTraffic)
      conn.removeEventListener('track', onTrack)
      conn.removeEventListener('robot-error', onRobotError)
    }
  }, [conn])

  const log = useCallback(
    (text: string) => {
      pendingTraffic.current.push({ dir: 'sys', text, ts: Date.now() })
    },
    [],
  )

  /**
   * The lidar switch is driven from here rather than from the lidar panel,
   * because the panel only exists while its tab is open. The switch lives on
   * the drive column, so toggling it used to do nothing at all unless the
   * Lidar tab happened to be showing - the code that publishes it was not
   * mounted.
   *
   * The payload is upper case and repeated: the firmware routinely drops one
   * of these, and a dropped OFF leaves the sensor turning. On a LAN link the
   * repeats are enough. Over the cloud relay they are not, which is why off
   * is verified below rather than assumed.
   */
  /** Set when the robot keeps the lidar running after being told to stop. */
  const [lidarStuck, setLidarStuck] = useState(false)
  // Bumping this re-runs the send below without changing what the operator
  // asked for, so a retry does not have to flick the lidar back on first.
  const [lidarNudge, setLidarNudge] = useState(0)
  const retryLidar = useCallback(() => setLidarNudge((n) => n + 1), [])

  useEffect(() => {
    if (connState !== 'connected') return
    let cancelled = false
    // Five fast repeats is what the firmware wants (it drops one routinely),
    // but on the cloud relay a fast burst can be overtaken by an earlier
    // in-flight ON, and the last packet to land is the one that wins. The two
    // late repeats put the intent beyond any burst still in the air.
    const AT = [0, 100, 200, 300, 400, 1200, 2500]
    const send = (state: 'ON' | 'OFF') => {
      for (const ms of AT) {
        setTimeout(() => {
          if (!cancelled) conn.publish(TOPICS.ULIDAR_SWITCH, state)
        }, ms)
      }
    }

    if (lidarOn) {
      // Voxel frames are large, so they need the full-rate channel.
      conn.disableTrafficSaving(true).catch(() => undefined)
      setLidarStuck(false)
      send('ON')
      return () => {
        cancelled = true
      }
    }

    /**
     * Off is not fire-and-forget. A voxel frame can only exist while the
     * sensor is turning, so any frame arriving after this point means
     * something put the lidar back - a lost packet on the relay, or a service
     * on the robot that wants it. Say off again, a few times, and if it still
     * will not stop, stop lying about it in the UI.
     */
    const REASSERT_GAP = 2000
    const MAX_REASSERTS = 4
    let attempts = 0
    let lastAt = Date.now()
    let unsub = () => {}
    setLidarStuck(false)
    send('OFF')

    unsub = conn.subscribe(TOPICS.ULIDAR_ARRAY, () => {
      if (cancelled) return
      const now = Date.now()
      if (now - lastAt < REASSERT_GAP) return
      lastAt = now
      attempts += 1
      if (attempts > MAX_REASSERTS) {
        setLidarStuck(true)
        log('Lidar is still running after repeated off commands - something on the robot is holding it on')
        unsub()
        return
      }
      log(`Lidar is still sending - repeating off (${attempts}/${MAX_REASSERTS})`)
      send('OFF')
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [lidarOn, lidarNudge, connState, conn, log])

  /**
   * Follow the robot into and out of pose mode.
   *
   * Some actions leave the robot posing on their own - a jump forward does -
   * and the console had no idea, because this flag was only ever set by the
   * Pose tile. The sticks would keep sending walk commands at a robot that
   * was leaning, and the tile would claim pose was off while it plainly was
   * not. sportmodestate reports mode 2 for pose, so believe that instead.
   */
  useEffect(() => {
    const mode = sportState?.mode
    if (mode === undefined) return
    if (Date.now() - poseChangedAt.current < POSE_SETTLE_MS) return
    const robotIsPosing = mode === MODE_POSE
    setPosing((was) => (was === robotIsPosing ? was : robotIsPosing))
  }, [sportState?.mode])

  // Core telemetry stays subscribed for the life of the app.
  useEffect(() => {
    const unsubs = [
      conn.subscribe(TOPICS.LOW_STATE, (d) => (pendingLow.current = d as LowState)),
      conn.subscribe(TOPICS.LF_SPORT_MOD_STATE, (d) => (pendingSport.current = d as SportModeState)),
      conn.subscribe(TOPICS.SPORT_MOD_STATE, (d) => (pendingSport.current = d as SportModeState)),
    ]
    return () => unsubs.forEach((u) => u())
  }, [conn])

  useEffect(() => {
    const t = setInterval(() => {
      if (pendingLow.current) {
        setLowState(pendingLow.current)
        pendingLow.current = null
      }
      if (pendingSport.current) {
        setSportState(pendingSport.current)
        pendingSport.current = null
      }
      if (pendingTraffic.current.length) {
        const chunk = pendingTraffic.current
        pendingTraffic.current = []
        setTraffic((prev) => [...prev, ...chunk].slice(-TRAFFIC_LIMIT))
      }
      const s = conn.stats
      const now = performance.now()
      const prev = rateSample.current
      if (prev.at === 0) {
        prev.at = now
        prev.messages = s.messages
      } else {
        const dt = (now - prev.at) / 1000
        if (dt >= 0.5) {
          // messages reset to zero on a fresh connection; don't report a negative delta
          const delta = s.messages >= prev.messages ? s.messages - prev.messages : s.messages
          const inst = delta / dt
          // light smoothing so the number doesn't jitter every update
          prev.rate = prev.rate === 0 ? inst : prev.rate * 0.5 + inst * 0.5
          prev.messages = s.messages
          prev.at = now
        }
      }
      setLinkStats({ ...s, rate: Math.round(prev.rate) })
    }, UI_FLUSH_MS)
    return () => clearInterval(t)
  }, [conn])

  const lastConnect = useRef<ConnectOptions | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  const connect = useCallback(
    async (opts: ConnectOptions) => {
      lastConnect.current = opts
      setCanRetry(true)
      setConnError(null)
      setRobotErrors([])
      rateSample.current = { messages: 0, at: 0, rate: 0 }
      await conn.connect(opts)
    },
    [conn],
  )

  const retry = useCallback(() => {
    if (lastConnect.current) void connect(lastConnect.current).catch(() => undefined)
  }, [connect])

  const disconnect = useCallback(() => {
    conn.disconnect()
    setStream(null)
    setLowState(null)
    setSportState(null)
    setReportedMode(null)
  }, [conn])

  const setVideo = useCallback(
    (on: boolean) => {
      conn.setVideo(on)
      setVideoOnState(on)
    },
    [conn],
  )

  const setAudio = useCallback(
    (on: boolean) => {
      conn.setAudio(on)
      setAudioOnState(on)
    },
    [conn],
  )

  const sport = useCallback(
    (apiId: number, parameter?: unknown) => conn.request(TOPICS.SPORT_MOD, apiId, parameter),
    [conn],
  )

  const apiIdFor = useCallback(
    (a: ActionSpec) => {
      const exact = a.ids[motionMode]
      if (exact !== undefined) return { apiId: exact, exact: true, from: motionMode }
      // Our id tables are transcriptions, not the robot's own manifest, so an
      // action missing from the running service may simply be missing from our
      // table. Offer the id we do have and let the robot be the one to refuse.
      for (const mode of ['mcf', 'ai', 'advanced', 'normal'] as MotionMode[]) {
        const id = a.ids[mode]
        if (id !== undefined) return { apiId: id, exact: false, from: mode }
      }
      return null
    },
    [motionMode],
  )

  const runAction = useCallback(
    (a: ActionSpec, toggleOn = true) => {
      const resolved = apiIdFor(a)
      if (!resolved) {
        return Promise.reject(new Error(`${a.label} has no known command id`))
      }
      const parameter = a.toggle ? { data: toggleOn } : a.parameter
      return conn.request(TOPICS.SPORT_MOD, resolved.apiId, parameter)
    },
    [conn, apiIdFor],
  )

  const move = useCallback(
    (x: number, y: number, z: number) => {
      const apiId = motionMode === 'mcf' ? SPORT_CMD_MCF.Move : SPORT_CMD.Move
      // Quiet: this fires at ~20Hz and would drown the console log.
      conn.sendNoReply(TOPICS.SPORT_MOD, apiId, { x, y, z }, true)
    },
    [conn, motionMode],
  )

  const setEuler = useCallback(
    (roll: number, pitch: number, yaw: number) => {
      conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.Euler, { x: roll, y: pitch, z: yaw }, true)
    },
    [conn],
  )

  const moveSticks = useCallback(
    (lx: number, ly: number, rx: number, ry: number) => {
      // Quiet: this is a 20Hz stream and would drown the console log.
      conn.publish(TOPICS.WIRELESS_CONTROLLER, { lx, ly, rx, ry }, DATA_CHANNEL_TYPE.MSG, true)
    },
    [conn],
  )

  const stopMove = useCallback(() => {
    conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.StopMove, undefined, true)
  }, [conn])

  const emergencyStop = useCallback(() => {
    // Halt locomotion, then go compliant. Both fire-and-forget so neither waits
    // on the other, and both are sent even if the robot is mid-command.
    // Damp goes out priority so it jumps the queue instead of waiting behind
    // an in-flight gait; StopMove halts locomotion first.
    conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.StopMove)
    conn.sendPriority(TOPICS.SPORT_MOD, SPORT_CMD.Damp)
    log('EMERGENCY STOP - sent StopMove + priority Damp')
  }, [conn, log])

  const refreshMotionMode = useCallback(async () => {
    const res = await conn.request(TOPICS.MOTION_SWITCHER, MOTION_SWITCHER_API.GET_MODE)
    const data = unwrapResponse<{ name?: string }>(res)
    const name = data?.name ?? null
    setReportedMode(name)
    // Follow whatever the robot says it runs. Rejecting 'mcf' here is what used
    // to leave a 1.1.7+ robot being sent the legacy id table.
    if (name === 'normal' || name === 'ai' || name === 'advanced' || name === 'mcf') setMotionMode(name)
    return name
  }, [conn])

  const switchMotionMode = useCallback(
    async (name: string) => {
      await conn.request(TOPICS.MOTION_SWITCHER, MOTION_SWITCHER_API.SET_MODE, { name })
      setReportedMode(name)
      if (name === 'normal' || name === 'ai' || name === 'advanced' || name === 'mcf') setMotionMode(name as MotionMode)
      log(`Motion service set to ${name}. The robot takes a few seconds to settle.`)
    },
    [conn, log],
  )

  const clearTraffic = useCallback(() => setTraffic([]), [])
  const clearErrors = useCallback(() => setRobotErrors([]), [])

  const api = useMemo<RobotApi>(
    () => ({
      conn,
      connState,
      connError,
      ip,
      lowState,
      sportState,
      traffic,
      robotErrors,
      stream,
      videoOn,
      audioOn,
      posing,
      lidarOn,
      lidarStuck,
      retryLidar,
      motionMode,
      reportedMode,
      linkStats,
      setPosing: setPosingManually,
      setLidarOn,
      setMotionMode,
      connect,
      retry: canRetry ? retry : null,
      disconnect,
      setVideo,
      setAudio,
      apiIdFor,
      sport,
      runAction,
      move,
      moveSticks,
      setEuler,
      stopMove,
      emergencyStop,
      refreshMotionMode,
      switchMotionMode,
      clearTraffic,
      clearErrors,
      log,
    }),
    [conn, connState, connError, ip, lowState, sportState, traffic, robotErrors, stream, videoOn, audioOn, posing, lidarOn, lidarStuck, retryLidar, motionMode, reportedMode, linkStats, connect, canRetry, retry, disconnect, setVideo, setAudio, apiIdFor, sport, runAction, move, moveSticks, setEuler, setPosingManually, stopMove, emergencyStop, refreshMotionMode, switchMotionMode, clearTraffic, clearErrors, log],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

