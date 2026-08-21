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
  armed: boolean
  motionMode: MotionMode
  reportedMode: string | null
  linkStats: { messages: number; bytes: number; topics: number; rate: number }
  setArmed: (v: boolean) => void
  setMotionMode: (m: MotionMode) => void
  connect: (opts: ConnectOptions) => Promise<void>
  /** re-run the last connect attempt, or null if there hasn't been one */
  retry: (() => void) | null
  disconnect: () => void
  setVideo: (on: boolean) => void
  setAudio: (on: boolean) => void
  /** resolved api id for an action under the current motion mode, or null */
  apiIdFor: (a: ActionSpec) => number | null
  sport: (apiId: number, parameter?: unknown) => Promise<ApiResponse>
  runAction: (a: ActionSpec, toggleOn?: boolean) => Promise<ApiResponse>
  move: (x: number, y: number, z: number) => void
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
  const [armed, setArmed] = useState(false)
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
      if (d.state === 'connected') setIp(conn.ip)
      if (d.state === 'closed' || d.state === 'error') {
        setVideoOnState(false)
        setAudioOnState(false)
        setArmed(false)
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

  const log = useCallback(
    (text: string) => {
      pendingTraffic.current.push({ dir: 'sys', text, ts: Date.now() })
    },
    [],
  )

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

  const apiIdFor = useCallback((a: ActionSpec) => a.ids[motionMode] ?? null, [motionMode])

  const runAction = useCallback(
    (a: ActionSpec, toggleOn = true) => {
      const apiId = a.ids[motionMode]
      if (apiId === undefined) {
        return Promise.reject(new Error(`${a.label} is not available in ${motionMode} mode`))
      }
      const parameter = a.toggle ? { data: toggleOn } : a.parameter
      return conn.request(TOPICS.SPORT_MOD, apiId, parameter)
    },
    [conn, motionMode],
  )

  const move = useCallback(
    (x: number, y: number, z: number) => {
      const apiId = motionMode === 'mcf' ? SPORT_CMD_MCF.Move : SPORT_CMD.Move
      // Quiet: this fires at ~20Hz and would drown the console log.
      conn.sendNoReply(TOPICS.SPORT_MOD, apiId, { x, y, z }, true)
    },
    [conn, motionMode],
  )

  const stopMove = useCallback(() => {
    conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.StopMove, undefined, true)
  }, [conn])

  const emergencyStop = useCallback(() => {
    // Halt locomotion, then go compliant. Both fire-and-forget so neither waits
    // on the other, and both are sent even if the robot is mid-command.
    conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.StopMove)
    conn.sendNoReply(TOPICS.SPORT_MOD, SPORT_CMD.Damp)
    setArmed(false)
    log('EMERGENCY STOP - sent StopMove + Damp')
  }, [conn, log])

  const refreshMotionMode = useCallback(async () => {
    const res = await conn.request(TOPICS.MOTION_SWITCHER, MOTION_SWITCHER_API.GET_MODE)
    const data = unwrapResponse<{ name?: string }>(res)
    const name = data?.name ?? null
    setReportedMode(name)
    if (name === 'normal' || name === 'ai') setMotionMode(name)
    return name
  }, [conn])

  const switchMotionMode = useCallback(
    async (name: string) => {
      await conn.request(TOPICS.MOTION_SWITCHER, MOTION_SWITCHER_API.SET_MODE, { name })
      setReportedMode(name)
      if (name === 'normal' || name === 'ai') setMotionMode(name)
      log(`Motion mode set to ${name}. The robot takes a few seconds to settle.`)
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
      armed,
      motionMode,
      reportedMode,
      linkStats,
      setArmed,
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
      stopMove,
      emergencyStop,
      refreshMotionMode,
      switchMotionMode,
      clearTraffic,
      clearErrors,
      log,
    }),
    [conn, connState, connError, ip, lowState, sportState, traffic, robotErrors, stream, videoOn, audioOn, armed, motionMode, reportedMode, linkStats, connect, canRetry, retry, disconnect, setVideo, setAudio, apiIdFor, sport, runAction, move, stopMove, emergencyStop, refreshMotionMode, switchMotionMode, clearTraffic, clearErrors, log],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

