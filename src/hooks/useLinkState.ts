import { useEffect, useState } from 'react'
import { parseFaultFrame, FAULT_LIMIT, type RobotFault } from '../lib/robotFaults'
import type { ConnState, Go2Connection } from '../lib/go2'

/**
 * What the link is doing, and what the robot is complaining about.
 *
 * Both come off the same connection as events, and both are about the link
 * rather than about the robot's motion or its readings, so they are one hook.
 * The camera coming up with the link lives here too: it is a consequence of
 * connecting, and putting it anywhere else means two places have to agree on
 * when a connection starts.
 */

export interface LinkState {
  connState: ConnState
  connError: string | null
  /** The address the robot answered on, once one is known. */
  ip: string
  stream: MediaStream | null
  videoOn: boolean
  audioOn: boolean
  faults: RobotFault[]
  setVideoOn: (on: boolean) => void
  setAudioOn: (on: boolean) => void
  clearFaults: () => void
  /** True while the link is up; the answer most panels actually want. */
  connected: boolean
}

export function useLinkState(conn: Go2Connection): LinkState {
  const [connState, setConnState] = useState<ConnState>('idle')
  const [connError, setConnError] = useState<string | null>(null)
  const [ip, setIp] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [videoOn, setVideoOn] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const [faults, setFaults] = useState<RobotFault[]>([])

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
        setVideoOn(true)
      }
      if (d.state === 'closed' || d.state === 'error') {
        setVideoOn(false)
        setAudioOn(false)
        // The tracks belong to a peer connection that no longer exists. Holding
        // the old stream leaves a frozen last frame looking like a live view.
        setStream(null)
      }
    }

    const onTrack = (e: Event) => {
      setStream((e as CustomEvent).detail.stream as MediaStream)
    }

    const onFault = (e: Event) => {
      const d = (e as CustomEvent).detail as { type: string; data: unknown }
      const parsed = parseFaultFrame(d.type, d.data)
      // Newest first: a burst during a fall is read from the top, and what
      // started it is what matters.
      if (parsed.length) setFaults((prev) => [...parsed, ...prev].slice(0, FAULT_LIMIT))
    }

    conn.addEventListener('state', onState)
    conn.addEventListener('track', onTrack)
    conn.addEventListener('robot-error', onFault)
    return () => {
      conn.removeEventListener('state', onState)
      conn.removeEventListener('track', onTrack)
      conn.removeEventListener('robot-error', onFault)
    }
  }, [conn])

  return {
    connState,
    connError,
    ip,
    stream,
    videoOn,
    audioOn,
    faults,
    setVideoOn,
    setAudioOn,
    clearFaults: () => setFaults([]),
    connected: connState === 'connected',
  }
}
