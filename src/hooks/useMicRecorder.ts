import { useCallback, useEffect, useRef, useState } from 'react'

// Records a short clip from the browser microphone. The captured Blob is handed
// back as a File so it can go straight through the same conversion and upload
// path as a chosen audio file (toRobotWav decodes whatever MediaRecorder emits).
//
// Durations follow the robot's own recorder: at least half a second, and capped
// at a minute so a forgotten recording cannot grow without bound.
const MAX_MS = 60_000
const MIN_MS = 500

export interface MicRecorder {
  recording: boolean
  /** elapsed seconds while recording */
  seconds: number
  /** the finished clip, waiting to be used or discarded */
  clip: File | null
  error: string | null
  start: () => Promise<void>
  /**
   * Stop, and resolve with the clip once the recorder has assembled it.
   *
   * The clip does not exist when stop() is called - MediaRecorder assembles it
   * on its own onstop, afterwards. A caller that needs the recording therefore
   * had to watch for it appearing in state, which meant coordinating a flag
   * with a render. Awaiting it here is the same wait, said once.
   *
   * Resolves null when there was nothing to record or the clip was too short.
   */
  stop: () => Promise<File | null>
  discard: () => void
}

export function useMicRecorder(): MicRecorder {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [clip, setClip] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const startedAt = useRef(0)
  /** Whoever is awaiting stop(), resolved from the recorder's own onstop. */
  const awaiting = useRef<((clip: File | null) => void) | null>(null)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Hand a waiting caller its answer, once. */
  const settle = useCallback((clip: File | null) => {
    const resolve = awaiting.current
    awaiting.current = null
    resolve?.(clip)
  }, [])

  const teardown = useCallback(() => {
    if (tick.current) clearInterval(tick.current)
    if (cap.current) clearTimeout(cap.current)
    tick.current = null
    cap.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setRecording(false)
    // An unmount mid-recording must not leave a caller awaiting a clip that is
    // never coming.
    settle(null)
  }, [settle])

  const stop = useCallback((): Promise<File | null> => {
    const mr = rec.current
    if (!mr || mr.state === 'inactive') return Promise.resolve(null)
    // Stopping fires the recorder's onstop, which assembles the clip and
    // resolves this.
    return new Promise((resolve) => {
      awaiting.current = resolve
      mr.stop()
    })
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setClip(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio.')
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      chunks.current = []
      const mr = new MediaRecorder(s)
      rec.current = mr
      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data)
      }
      mr.onstop = () => {
        const elapsed = performance.now() - startedAt.current
        const type = mr.mimeType || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        teardown()
        if (elapsed < MIN_MS) {
          setError('Too short - hold it for at least half a second.')
          settle(null)
          return
        }
        const ext = (type.split('/')[1] || 'webm').split(';')[0]
        const file = new File([blob], `recording.${ext}`, { type: blob.type })
        setClip(file)
        settle(file)
      }
      mr.start()
      startedAt.current = performance.now()
      setSeconds(0)
      setRecording(true)
      tick.current = setInterval(() => setSeconds((performance.now() - startedAt.current) / 1000), 200)
      cap.current = setTimeout(() => void stop(), MAX_MS)
    } catch (e) {
      setError((e as Error).message || 'Microphone unavailable.')
      teardown()
    }
  }, [stop, teardown, settle])

  const discard = useCallback(() => {
    setClip(null)
    setError(null)
  }, [])

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => teardown, [teardown])

  return { recording, seconds, clip, error, start, stop, discard }
}
