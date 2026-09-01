import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Go2Connection, unwrapResponse, type ApiResponse, type ConnectOptions, type ConnState, type TrafficEntry } from '../lib/go2'
import {
  DATA_CHANNEL_TYPE,
  MOTION_SWITCHER_API,
  SPORT_CMD,
  SPORT_CMD_MCF,
  TOPICS,
  type ActionSpec,
  type MotionMode,
} from '../lib/constants'
import type { LowState, RobotError, SportModeState } from '../lib/types'
import { ReconnectPolicy } from '../lib/reconnect'
import { useTelemetryFeed } from '../hooks/useTelemetryFeed'
import { useLinkState } from '../hooks/useLinkState'
import { sendsToggleData } from '../lib/actionKinds'
import { resolveAction, type Availability } from '../lib/actionAvailability'
import { useSensing, type Sensing } from '../hooks/useSensing'
import { useOnce } from '../hooks/useOnce'

/** sportmodestate.mode while the robot is holding a pose. */
const MODE_POSE = 2

/** How long a deliberate pose change is trusted before telemetry overrules it. */
const POSE_SETTLE_MS = 1500



/**
 * What a panel needs to know to work the robot.
 *
 * Five things nearly every panel touches stay at the top; the rest is grouped
 * by what it is for. A panel that drives learns `motion`, one that shows the
 * link learns `link`, and neither has to read past the other.
 *
 * Telemetry is deliberately not here. It arrives twenty times a second, and
 * putting it in this object meant every tick built a new one and re-rendered
 * all thirteen consumers - eleven of which never read it. It has its own
 * context; see useTelemetry.
 */
export interface RobotApi {
  conn: Go2Connection
  connState: ConnState
  connError: string | null
  ip: string
  log: (text: string) => void
  link: LinkApi
  motion: MotionApi
  media: MediaApi
  /** The lidar and the assist that reads it, driven as the pair they are. */
  sensing: Sensing
  diagnostics: DiagnosticsApi
}

/** Opening, holding and closing the link. */
export interface LinkApi {
  stats: { messages: number; bytes: number; topics: number; rate: number }
  connect: (opts: ConnectOptions) => Promise<void>
  /** re-run the last connect attempt, or null if there hasn't been one */
  retry: (() => void) | null
  disconnect: () => void
}

/** Everything that makes the robot move, or stop. */
export interface MotionApi {
  /** while true the drive sticks lean the body instead of walking it */
  posing: boolean
  setPosing: (v: boolean) => void
  mode: MotionMode
  /** what the robot says it is running, which can differ from `mode` */
  reportedMode: string | null
  setMode: (m: MotionMode) => void
  /** How an action stands against the running motion service. */
  availabilityOf: (a: ActionSpec) => Availability
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
  refreshMode: () => Promise<string | null>
  switchMode: (name: string) => Promise<void>
}

/** Seeing and hearing through the robot. */
export interface MediaApi {
  stream: MediaStream | null
  videoOn: boolean
  audioOn: boolean
  setVideo: (on: boolean) => void
  setAudio: (on: boolean) => void
}

/** What went past, and what went wrong. */
export interface DiagnosticsApi {
  traffic: TrafficEntry[]
  errors: RobotError[]
  clearTraffic: () => void
  clearErrors: () => void
}

/**
 * What the robot is reporting about itself, right now.
 *
 * Separate from RobotApi because of how often it changes: lowstate and
 * sportmodestate arrive continuously, so anything sharing an object with them
 * is rebuilt continuously too. Only the two panels that display readings
 * subscribe here; everything else is left alone.
 */
export interface Telemetry {
  lowState: LowState | null
  sportState: SportModeState | null
}

const Ctx = createContext<RobotApi | null>(null)
const TelemetryCtx = createContext<Telemetry>({ lowState: null, sportState: null })

export function useRobot(): RobotApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRobot must be used inside RobotProvider')
  return v
}

/** Live readings. Subscribing re-renders on every frame from the robot. */
export function useTelemetry(): Telemetry {
  return useContext(TelemetryCtx)
}

export function RobotProvider({ children }: { children: ReactNode }) {
  const conn = useOnce(() => new Go2Connection())

  // What the link is doing, and what the robot is complaining about.
  const linkState = useLinkState(conn)
  const { connState, connError, ip, stream, videoOn, audioOn, faults, setVideoOn, setAudioOn, clearFaults } = linkState

  // High-rate readings and the traffic log, flushed at a rate React survives.
  const feed = useTelemetryFeed(conn)
  const { lowState, sportState, traffic, log, stats, clearTraffic, resetRate, clearReadings } = feed

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
  const [motionMode, setMotionMode] = useState<MotionMode>('normal')
  const [reportedMode, setReportedMode] = useState<string | null>(null)

  const sensing = useSensing(conn, connState, motionMode, log)

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

  const lastConnect = useRef<ConnectOptions | null>(null)
  /**
   * Everything about whether a dropped link should come back lives behind this,
   * so the effect below reads as the one decision it makes rather than as four
   * flags being consulted in the right order.
   */
  const recovery = useOnce(() => new ReconnectPolicy<ConnectOptions>())
  const [canRetry, setCanRetry] = useState(false)

  /**
   * The parts of opening a link that are the same however it was asked for.
   *
   * Deps are the two functions actually called, not `linkState` and `feed`
   * themselves - those hook results used to be rebuilt every render, so this
   * callback's identity churned with them, and the reconnect effect below
   * (which depends on it) tore down and re-ran on every telemetry flush.
   */
  const beginConnect = useCallback(
    async (opts: ConnectOptions) => {
      lastConnect.current = opts
      setCanRetry(true)
      // connState arrives as 'connecting' immediately, which clears connError
      // on its own - the reset that used to sit here was doing it twice.
      clearFaults()
      resetRate()
      await conn.connect(opts)
    },
    [conn, clearFaults, resetRate],
  )

  const connect = useCallback(
    async (opts: ConnectOptions) => {
      // The operator asking is a fresh intent, so the policy starts over.
      recovery.opening(opts)
      await beginConnect(opts)
    },
    [beginConnect, recovery],
  )

  const retry = useCallback(() => {
    if (lastConnect.current) void connect(lastConnect.current).catch(() => undefined)
  }, [connect])

  const disconnect = useCallback(() => {
    recovery.abandoned()
    conn.disconnect()
    clearReadings()
    setReportedMode(null)
  }, [conn, recovery, clearReadings])

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

  /**
   * Roaming between access points on one network gives this machine a new local
   * address, which kills every ICE candidate pair the session was built on. The
   * robot has not gone anywhere and the credentials are still good, so the
   * console gets itself back rather than leaving a dead panel to be noticed.
   *
   * Recovery is a fresh session, not a renegotiation: signalling on this robot
   * is one-shot over HTTP, so there is nothing to renegotiate a dead peer
   * connection with. conn.connect() tears the old one down first, so this
   * cannot leave the robot holding a session with no client on the other end.
   */
  /**
   * Which drop this effect has already asked ReconnectPolicy about. Guards
   * against a stray re-render landing on the same loss and asking again -
   * afterLoss() itself says that is a caller bug, and asking twice for one
   * loss used to burn the whole five-step schedule inside a second. Reset
   * whenever the link leaves error/closed, so the *next* loss is still acted
   * on the moment it happens.
   */
  const actedOnLoss = useRef(false)

  useEffect(() => {
    if (connState !== 'error' && connState !== 'closed') {
      actedOnLoss.current = false
      if (connState === 'connected') recovery.established()
      return
    }
    if (actedOnLoss.current) return
    actedOnLoss.current = true

    const step = recovery.afterLoss()
    if (step.act === 'stand-down') return
    if (step.act === 'give-up') {
      log('Could not get the link back. Press Connect when the robot is ready')
      return
    }

    log(`Link lost - reconnecting in ${Math.round(step.after / 1000)}s (attempt ${step.attempt} of ${step.of})`)
    const t = setTimeout(() => {
      recovery.reopening()
      void beginConnect(step.details).catch(() => undefined)
    }, step.after)
    return () => clearTimeout(t)
  }, [connState, beginConnect, recovery, log])

  const setVideo = useCallback(
    (on: boolean) => {
      conn.setVideo(on)
      setVideoOn(on)
    },
    [conn, setVideoOn],
  )

  const setAudio = useCallback(
    (on: boolean) => {
      conn.setAudio(on)
      setAudioOn(on)
    },
    [conn, setAudioOn],
  )

  const sport = useCallback(
    (apiId: number, parameter?: unknown) => conn.request(TOPICS.SPORT_MOD, apiId, parameter),
    [conn],
  )

  /**
   * How an action stands against the service the robot is running. The policy -
   * borrow an id rather than refuse, and let the robot be the one to say no -
   * lives in lib/actionAvailability.ts, so a tile asks one question instead of
   * reassembling the answer from protocol detail.
   */
  const availabilityOf = useCallback((a: ActionSpec) => resolveAction(a, motionMode), [motionMode])

  const runAction = useCallback(
    (a: ActionSpec, toggleOn = true) => {
      const stands = resolveAction(a, motionMode)
      if (stands.apiId === null) {
        return Promise.reject(new Error(`${a.label} has no known command id`))
      }
      const parameter = sendsToggleData(a.kind) ? { data: toggleOn } : a.parameter
      return conn.request(TOPICS.SPORT_MOD, stands.apiId, parameter)
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

  // Clearing either list belongs to whichever hook holds it.

  // Each group is memoised on its own dependencies, so a change in one does not
  // rebuild the others. The top-level object then only changes when a group
  // does, which is what keeps a panel that reads `link` still while `motion`
  // is busy.
  const link = useMemo<LinkApi>(
    () => ({ stats, connect, retry: canRetry ? retry : null, disconnect }),
    [stats, connect, canRetry, retry, disconnect],
  )

  const motion = useMemo<MotionApi>(
    () => ({
      posing,
      setPosing: setPosingManually,
      mode: motionMode,
      reportedMode,
      setMode: setMotionMode,
      availabilityOf,
      sport,
      runAction,
      move,
      moveSticks,
      setEuler,
      stopMove,
      emergencyStop,
      refreshMode: refreshMotionMode,
      switchMode: switchMotionMode,
    }),
    [posing, setPosingManually, motionMode, reportedMode, availabilityOf, sport, runAction, move, moveSticks, setEuler, stopMove, emergencyStop, refreshMotionMode, switchMotionMode],
  )

  const media = useMemo<MediaApi>(
    () => ({ stream, videoOn, audioOn, setVideo, setAudio }),
    [stream, videoOn, audioOn, setVideo, setAudio],
  )

  const diagnostics = useMemo<DiagnosticsApi>(
    () => ({ traffic, errors: faults, clearTraffic, clearErrors: clearFaults }),
    [traffic, faults, clearTraffic, clearFaults],
  )

  const api = useMemo<RobotApi>(
    () => ({ conn, connState, connError, ip, log, link, motion, media, sensing, diagnostics }),
    [conn, connState, connError, ip, log, link, motion, media, sensing, diagnostics],
  )

  // Rebuilt on every frame from the robot, which is why it is its own value and
  // its own context rather than part of the one above.
  const telemetry = useMemo<Telemetry>(() => ({ lowState, sportState }), [lowState, sportState])

  return (
    <Ctx.Provider value={api}>
      <TelemetryCtx.Provider value={telemetry}>{children}</TelemetryCtx.Provider>
    </Ctx.Provider>
  )
}
