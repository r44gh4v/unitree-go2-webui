import { useCallback, useEffect, useRef, useState } from 'react'
import { TOPICS } from '../lib/constants'
import { MessageRate } from '../lib/messageRate'
import { useOnce } from './useOnce'
import type { Go2Connection, TrafficEntry } from '../lib/go2'
import type { LowState, SportModeState } from '../lib/types'

/**
 * Turning a firehose into something React can render.
 *
 * The robot publishes lowstate and sportmodestate continuously, and the traffic
 * log can take a burst of hundreds of frames at once. Setting state per frame
 * would re-render the console hundreds of times a second and starve the drive
 * loop's timer of the main thread - the one thing that must keep its cadence.
 *
 * So frames land in refs and a slow timer flushes them. That is the whole idea,
 * and it is worth one module rather than three effects and four refs scattered
 * through the provider.
 */

/** How often accumulated frames are handed to React. */
const FLUSH_MS = 150

/** How much traffic is kept. Older entries fall off the top. */
const TRAFFIC_LIMIT = 500

export interface TelemetryFeed {
  lowState: LowState | null
  sportState: SportModeState | null
  traffic: TrafficEntry[]
  stats: { messages: number; bytes: number; topics: number; rate: number }
  clearTraffic: () => void
  /** Add a line to the traffic log from the console's own side. */
  log: (text: string) => void
  /** Forget the rate history, for a link that is starting over. */
  resetRate: () => void
  /** Drop the readings, so a dead link stops showing its last values. */
  clearReadings: () => void
}

export function useTelemetryFeed(conn: Go2Connection): TelemetryFeed {
  const [lowState, setLowState] = useState<LowState | null>(null)
  const [sportState, setSportState] = useState<SportModeState | null>(null)
  const [traffic, setTraffic] = useState<TrafficEntry[]>([])
  const [stats, setStats] = useState({ messages: 0, bytes: 0, topics: 0, rate: 0 })

  const pendingLow = useRef<LowState | null>(null)
  const pendingSport = useRef<SportModeState | null>(null)
  const pendingTraffic = useRef<TrafficEntry[]>([])
  const rate = useOnce(() => new MessageRate())

  /** Console-side lines share the robot's log, and its flush. */
  const log = useCallback((text: string) => {
    pendingTraffic.current.push({ dir: 'sys', text, ts: Date.now() })
  }, [])

  // Traffic is collected here rather than in the provider so everything that
  // feeds the flush below is in one place.
  useEffect(() => {
    const onTraffic = (e: Event) => {
      pendingTraffic.current.push((e as CustomEvent).detail as TrafficEntry)
    }
    conn.addEventListener('traffic', onTraffic)
    return () => conn.removeEventListener('traffic', onTraffic)
  }, [conn])

  // Core telemetry stays subscribed for the life of the app: these readings are
  // what the status panel and the pose reconciliation both run on.
  useEffect(() => {
    const unsubs = [
      conn.subscribe(TOPICS.LOW_STATE, (d) => (pendingLow.current = d as LowState)),
      conn.subscribe(TOPICS.LF_SPORT_MOD_STATE, (d) => (pendingSport.current = d as SportModeState)),
      conn.subscribe(TOPICS.SPORT_MOD_STATE, (d) => (pendingSport.current = d as SportModeState)),
    ]
    return () => unsubs.forEach((u) => u())
  }, [conn])

  useEffect(() => {
    const timer = setInterval(() => {
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
      setStats({ ...s, rate: Math.round(rate.sample(s.messages, performance.now())) })
    }, FLUSH_MS)
    return () => clearInterval(timer)
  }, [conn, rate])

  const clearTraffic = useCallback(() => setTraffic([]), [])
  const resetRate = useCallback(() => rate.reset(), [rate])

  const clearReadings = useCallback(() => {
    pendingLow.current = null
    pendingSport.current = null
    setLowState(null)
    setSportState(null)
  }, [])

  return { lowState, sportState, traffic, stats, clearTraffic, log, resetRate, clearReadings }
}
