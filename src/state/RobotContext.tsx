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
/**
 * How long to wait before each automatic reconnect. Five attempts over
 * about half a minute: long enough to ride out an access point handover or
 * a router reboot, short enough that a robot which is genuinely off stops
 * being knocked on.
 */
const AUTO_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

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
   * of these, and a dropped OFF leaves the sensor turning.
   *
   * Nothing here subscribes to a utlidar topic. Asking the robot for map
   * data is a request for the sensor, so a watchdog that listened for frames
   * to check the lidar had stopped was capable of starting it again.
   */
  useEffect(() => {
    if (connState !== 'connected') return
    let cancelled = false
    // Repeated because the firmware drops one routinely. It stays a tight
    // burst: the sensor is observed to act on the off every time, so the
    // packet is arriving, and trailing repeats seconds later only make it
    // harder to tell our own traffic apart from whatever restarts it.
    const AT = [0, 100, 200, 300, 400]
    const send = (state: 'ON' | 'OFF') => {
      for (const ms of AT) {
        setTimeout(() => {
          if (!cancelled) conn.publish(TOPICS.ULIDAR_SWITCH, state)
        }, ms)
      }
    }

    // Voxel frames are large, so an on lidar needs the full-rate channel.
    if (lidarOn) conn.disableTrafficSaving(true).catch(() => undefined)
    send(lidarOn ? 'ON' : 'OFF')

    return () => {
      cancelled = true
    }
  }, [lidarOn, connState, conn])

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
  /** Set when the operator hangs up, so recovery does not undo their choice. */
  const userQuit = useRef(false)
  /**
   * Whether this set of connection details ever produced a working link.
   * Recovery is for a link that dropped, not for one that never worked: a
   * mistyped address should fail once and say so, not fail five times over
   * half a minute while the operator waits to find out what is wrong.
   */
  const everConnected = useRef(false)
  const [canRetry, setCanRetry] = useState(false)

  const connect = useCallback(
    async (opts: ConnectOptions) => {
      if (opts !== lastConnect.current) everConnected.current = false
      lastConnect.current = opts
      userQuit.current = false
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
    userQuit.current = true
    everConnected.current = false
    conn.disconnect()
    setStream(null)
    setLowState(null)
    setSportState(null)
    setReportedMode(null)
  }, [conn])

  /**
   * Roaming between access points on one network gives this machine a new
   * local address, which kills every ICE candidate pair the session was
   * built on. The robot has not gone anywhere and the credentials are still
   * good, so the console gets itself back rather than making the operator
   * notice a dead panel and press a button.
   *
   * It has to be a fresh session: signalling on this robot is one-shot over
   * HTTP, so there is no renegotiating the peer connection that just died.
   * connect() tears the old one down first, so this cannot leave the robot
   * holding a session that no longer has a client.
   *
   * Attempts back off and then stop. A robot that is switched off should not
   * be knocked on forever, and at that point the operator wants to know.
   */
  /**
   * Closing the tab, navigating away, or shutting the lid is a disconnect the
   * operator never presses a button for, and it leaves the robot in whatever
   * mode it was put into. pagehide is the last moment a send can still go out.
   *
   * pagehide rather than beforeunload: it fires for the phone and laptop cases
   * that beforeunload misses, and it does not risk a confirmation dialog.
   */
  useEffect(() => {
    const onGone = () => {
      if (connState === 'connected') conn.makeSafe('page closing')
    }
    window.addEventListener('pagehide', onGone)
    return () => window.removeEventListener('pagehide', onGone)
  }, [conn, connState])

  const autoAttempt = useRef(0)

  useEffect(() => {
    if (connState === 'connected') {
      autoAttempt.current = 0
      everConnected.current = true
      return
    }
    if (connState !== 'error' && connState !== 'closed') return
    // A deliberate disconnect is not a fault to recover from, and neither is
    // a set of details that has never worked in the first place.
    if (userQuit.current || !lastConnect.current || !everConnected.current) return

    const n = autoAttempt.current
    if (n >= AUTO_BACKOFF_MS.length) {
      log('Could not get the link back. Press Connect when the robot is ready')
      return
    }
    autoAttempt.current = n + 1
    const wait = AUTO_BACKOFF_MS[n]
    log(`Link lost - reconnecting in ${Math.round(wait / 1000)}s (attempt ${n + 1} of ${AUTO_BACKOFF_MS.length})`)
    const t = setTimeout(() => {
      if (userQuit.current || !lastConnect.current) return
      void connect(lastConnect.current).catch(() => undefined)
    }, wait)
    return () => clearTimeout(t)
  }, [connState, connect, log])

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
    [conn, connState, connError, ip, lowState, sportState, traffic, robotErrors, stream, videoOn, audioOn, posing, lidarOn, motionMode, reportedMode, linkStats, connect, canRetry, retry, disconnect, setVideo, setAudio, apiIdFor, sport, runAction, move, moveSticks, setEuler, setPosingManually, stopMove, emergencyStop, refreshMotionMode, switchMotionMode, clearTraffic, clearErrors, log],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

