import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OBSTACLES_AVOID_API, SPORT_CMD_MCF, TOPICS, type MotionMode } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { sleep } from '../lib/sleep'
import { REASSERT_SCHEDULE_MS, shouldReassertOff } from '../lib/lidarSwitch'
import type { Go2Connection } from '../lib/go2'
import type { ConnState } from '../lib/go2'

/**
 * What the robot is allowed to sense: the head lidar, and the obstacle
 * avoidance assist that reads it.
 *
 * These are one module because they are not two independent switches. The
 * assist consumes the sensor, and the robot enforces that whether the console
 * agrees or not - which is why the rule has to live in one place that owns
 * both, rather than half in a panel and half in the context. Panels get two
 * toggles and no protocol.
 *
 * This module also owns the one subscription to rt/utlidar/lidar_state. A
 * second, ungated subscription used to live in the System panel - asking the
 * robot for lidar data at the same moment this hook was asking the lidar to
 * stop, which was a live cause of the sensor refusing to stay off.
 */

/** How long the lidar off waits for the avoidance disable to be acknowledged
 *  before going ahead anyway. Long enough for a reply on a healthy link, far
 *  short of the 8s an unanswered api call takes - and the operator has asked a
 *  moving part to stop, so it is not waiting on a reply that may never come. */
const AVOID_ACK_MS = 600

/** The firmware drops one of these routinely, so the switch is repeated. */
const SWITCH_REPEATS_MS = [0, 100, 200, 300, 400]

/** How often the reassert schedule is polled while the lidar is meant to be off. */
const REASSERT_POLL_MS = 250

export interface Sensing {
  /** Whether the operator wants the head lidar turning. */
  lidarOn: boolean
  /** True while an off request is still within its reassert window - the
   *  switch is trusted, but the sensor has not been given long enough to prove
   *  something else did not put it back. */
  settling: boolean
  /** Raw rt/utlidar/lidar_state, for the System panel's dump. Not otherwise
   *  trusted: unconfirmed on hardware, so nothing here gates behaviour on it. */
  lidarState: unknown
  /** Obstacle avoidance, or null while the robot has not said. */
  avoidance: boolean | null
  /** A paired change is on the wire; both toggles wait it out. */
  busy: boolean
  setLidar: (on: boolean) => void
  setAvoidance: (on: boolean) => void
  /** Ask the robot for the avoidance state again after a failed read. */
  recheckAvoidance: () => void
}

export function useSensing(conn: Go2Connection, connState: ConnState, motionMode: MotionMode, log: (m: string) => void): Sensing {
  const connected = connState === 'connected'
  // The robot brings its lidar up with itself, so the switch starts on to
  // match. Starting off would show a stopped sensor that was in fact spinning.
  const [lidarOn, setLidarOn] = useState(true)
  const [settling, setSettling] = useState(false)
  const [lidarState, setLidarState] = useState<unknown>(null)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // Read inside callbacks that must not be rebuilt when the value changes.
  const lidarRef = useRef(lidarOn)
  lidarRef.current = lidarOn
  const motionModeRef = useRef(motionMode)
  motionModeRef.current = motionMode

  /**
   * The switch is driven here rather than from the lidar panel, because the
   * panel only exists while its tab is open - toggling it used to do nothing
   * at all unless that tab happened to be showing.
   *
   * On: the initial burst only, matching what the robot itself expects.
   * Off: the same burst, then a bounded reassert schedule (lib/lidarSwitch.ts)
   * in case the avoidance service - which restarts the lidar if its own
   * disable was not acknowledged in time - puts it back a few seconds later.
   * That silent restart is the cause of a long-standing bug where the lidar
   * refused to stay off; nothing before this re-sent OFF once the first burst
   * was done.
   */
  useEffect(() => {
    if (!connected) return
    let cancelled = false

    if (lidarOn) {
      // Voxel frames are large, so an on lidar needs the full-rate channel.
      conn.disableTrafficSaving(true).catch(() => undefined)
      for (const ms of SWITCH_REPEATS_MS) {
        setTimeout(() => {
          if (!cancelled) conn.publish(TOPICS.ULIDAR_SWITCH, 'ON')
        }, ms)
      }
      setSettling(false)
      return () => {
        cancelled = true
      }
    }

    for (const ms of SWITCH_REPEATS_MS) {
      setTimeout(() => {
        if (!cancelled) conn.publish(TOPICS.ULIDAR_SWITCH, 'OFF')
      }, ms)
    }

    // FreeAvoid is a sport mode, not a service switch, and it holds the lidar
    // the same way the avoidance service does - useSensing is the one place
    // that knows the lidar just went off, so it is the one place that can
    // drop it. Only on mcf: the legacy AI service also exposes FreeAvoid (its
    // sportmodestate reports mode 17 while it runs), but no reference source
    // corroborates a command id for it there, and sending a guessed id to a
    // live command channel is worse than leaving that service's FreeAvoid
    // running - the operator can still stop it from the Actions tab.
    if (motionModeRef.current === 'mcf') {
      conn.request(TOPICS.SPORT_MOD, SPORT_CMD_MCF.FreeAvoid, { data: false }).catch(() => undefined)
    }

    const startedAt = Date.now()
    let sentCount = 0
    setSettling(true)
    const reassertTimer = setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      if (shouldReassertOff({ desiredOff: true, elapsedMs, sentCount })) {
        conn.publish(TOPICS.ULIDAR_SWITCH, 'OFF')
        sentCount++
        return
      }
      if (sentCount >= REASSERT_SCHEDULE_MS.length) {
        setSettling(false)
        clearInterval(reassertTimer)
      }
    }, REASSERT_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(reassertTimer)
    }
  }, [lidarOn, connected, conn])

  // The one subscription to the lidar's own health topic. Gated on the switch
  // as well as the link: subscribing to a utlidar topic is a request for the
  // sensor, and asking for lidar data at the same moment the lidar is being
  // asked to stop is what used to keep it spinning.
  useEffect(() => {
    if (!connected || !lidarOn) {
      setLidarState(null)
      return
    }
    return conn.subscribe(TOPICS.ULIDAR_STATE, setLidarState)
  }, [connected, lidarOn, conn])

  const recheckAvoidance = useCallback(() => {
    void (async () => {
      try {
        const res = await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_GET)
        const a = unwrapResponse<{ enable: boolean }>(res)
        if (typeof a?.enable === 'boolean') setAvoidance(a.enable)
      } catch {
        /* stays unknown, and the toggle stays usable - setting the state is
           authoritative even when reading it back is not */
      }
    })()
  }, [conn])

  useEffect(() => {
    if (!connected) {
      setAvoidance(null)
      return
    }
    recheckAvoidance()
  }, [connected, recheckAvoidance])

  /**
   * Sent whatever we believe the current state to be. Measured on the robot:
   * the state query (api 1002) answers {"enable":false} while the service is
   * still holding the lidar up, so no reading of it can safely gate this.
   * Disabling an already-disabled assist costs nothing.
   */
  const pushAvoidance = useCallback(
    async (next: boolean) => {
      try {
        await conn.request(TOPICS.OBSTACLES_AVOID, OBSTACLES_AVOID_API.SWITCH_SET, { enable: next })
        setAvoidance(next)
        log(`Obstacle avoidance ${next ? 'on' : 'off'}`)
      } catch (e) {
        log(`Obstacle avoidance: ${(e as Error).message}`)
      }
    },
    [conn, log],
  )

  /**
   * Lidar off takes avoidance with it, and avoidance goes first. Left running,
   * the assist notices its sensor stopped and puts it back a couple of seconds
   * later - measured on the robot. The disable is on the wire before the
   * lidar off either way, which is the ordering that matters; waiting for its
   * reply is not, so the sensor stops on a short grace period whether the
   * assist answers or not. The reassert schedule above is the backstop for
   * whichever of avoidance or FreeAvoid still manages to restart it anyway.
   *
   * Turning the lidar back on does not restore avoidance. The toggle shows it
   * went off and the operator can put it back; restoring a collision assist
   * unasked is worse than leaving it visibly off.
   */
  const setLidar = useCallback(
    (next: boolean) => {
      void (async () => {
        setBusy(true)
        try {
          if (!next) await Promise.race([pushAvoidance(false), sleep(AVOID_ACK_MS)])
          setLidarOn(next)
        } finally {
          setBusy(false)
        }
      })()
    },
    [pushAvoidance],
  )

  /**
   * Avoidance on brings the lidar with it. An assist with no sensor is not
   * something the robot honours - it starts the lidar itself - so the console
   * turns it on where the operator can see it, rather than showing a stopped
   * lidar that is plainly spinning.
   */
  const setAvoidanceOn = useCallback(
    (next: boolean) => {
      void (async () => {
        setBusy(true)
        try {
          if (next && !lidarRef.current) {
            setLidarOn(true)
            log('Obstacle avoidance needs the lidar - starting it')
          }
          await pushAvoidance(next)
        } finally {
          setBusy(false)
        }
      })()
    },
    [pushAvoidance, log],
  )

  return useMemo(
    () => ({ lidarOn, settling, lidarState, avoidance, busy, setLidar, setAvoidance: setAvoidanceOn, recheckAvoidance }),
    [lidarOn, settling, lidarState, avoidance, busy, setLidar, setAvoidanceOn, recheckAvoidance],
  )
}
