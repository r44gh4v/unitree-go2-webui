import { useCallback, useEffect, useRef, useState } from 'react'
import { OBSTACLES_AVOID_API, TOPICS } from '../lib/constants'
import { unwrapResponse } from '../lib/go2'
import { sleep } from '../lib/sleep'
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
 */

/** How long the lidar off waits for the avoidance disable to be acknowledged
 *  before going ahead anyway. Long enough for a reply on a healthy link, far
 *  short of the 8s an unanswered api call takes - and the operator has asked a
 *  moving part to stop, so it is not waiting on a reply that may never come. */
const AVOID_ACK_MS = 600

/** The firmware drops one of these routinely, so the switch is repeated. */
const SWITCH_REPEATS_MS = [0, 100, 200, 300, 400]

export interface Sensing {
  /** Whether the head lidar is turning. */
  lidarOn: boolean
  /** Obstacle avoidance, or null while the robot has not said. */
  avoidance: boolean | null
  /** A paired change is on the wire; both toggles wait it out. */
  busy: boolean
  setLidar: (on: boolean) => void
  setAvoidance: (on: boolean) => void
  /** Ask the robot for the avoidance state again after a failed read. */
  recheckAvoidance: () => void
}

export function useSensing(conn: Go2Connection, connState: ConnState, log: (m: string) => void): Sensing {
  const connected = connState === 'connected'
  // The robot brings its lidar up with itself, so the switch starts on to
  // match. Starting off would show a stopped sensor that was in fact spinning.
  const [lidarOn, setLidarOn] = useState(true)
  const [avoidance, setAvoidance] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // Read inside callbacks that must not be rebuilt when the value changes.
  const lidarRef = useRef(lidarOn)
  lidarRef.current = lidarOn

  /**
   * The switch is driven here rather than from the lidar panel, because the
   * panel only exists while its tab is open - toggling it used to do nothing
   * at all unless that tab happened to be showing.
   *
   * Nothing here subscribes to a utlidar topic. Asking the robot for map data
   * is a request for the sensor, so a watchdog that listened for frames to
   * check the lidar had stopped was capable of starting it again.
   */
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    // Voxel frames are large, so an on lidar needs the full-rate channel.
    if (lidarOn) conn.disableTrafficSaving(true).catch(() => undefined)
    for (const ms of SWITCH_REPEATS_MS) {
      setTimeout(() => {
        if (!cancelled) conn.publish(TOPICS.ULIDAR_SWITCH, lidarOn ? 'ON' : 'OFF')
      }, ms)
    }
    return () => {
      cancelled = true
    }
  }, [lidarOn, connected, conn])

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
   * later - measured on the robot, and the cause of a long-standing bug where
   * the lidar refused to stay off.
   *
   * The disable is on the wire before the lidar off either way, which is the
   * ordering that matters; waiting for its reply is not, so the sensor stops on
   * a short grace period whether the assist answers or not.
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

  return { lidarOn, avoidance, busy, setLidar, setAvoidance: setAvoidanceOn, recheckAvoidance }
}
