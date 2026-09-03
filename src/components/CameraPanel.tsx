import { useEffect, useRef, useState } from 'react'
import { useRobot, useTelemetry } from '../state/RobotContext'
import { MODE_NAMES } from '../lib/types'
import {
  CameraIcon, CameraOffIcon, SpeakerIcon, SpeakerOffIcon,
  PhotoIcon, FrameIcon, ExpandIcon,
} from './Icons'

/** What the central view shows before the camera is up: the connection's own state. */
function CameraStatus({ connected, starting }: { connected: boolean; starting: boolean }) {
  const { connState, connError, ip, link } = useRobot()

  if (connState === 'connecting' || connState === 'validating') {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <b>{connState === 'validating' ? 'Authenticating' : 'Connecting'}</b>
        {connState === 'validating' ? 'Exchanging keys with the robot.' : `Reaching ${ip || 'the robot'}…`}
        <button className="btn sm ghost mt-5" onClick={link.disconnect}>
          Cancel
        </button>
      </div>
    )
  }

  if (connState === 'error') {
    return (
      <div className="placeholder error">
        <b>Connection failed</b>
        <span className="reason">{connError ?? 'Unknown error'}</span>
        {link.retry && (
          <button className="btn sm mt-5" onClick={link.retry}>
            Try again
          </button>
        )}
      </div>
    )
  }

  if (connected && starting) {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <b>Starting camera</b>
        Waiting for the robot's video track.
      </div>
    )
  }

  if (connected) {
    return (
      <div className="placeholder">
        <b>Camera off</b>
        Turn it on below.
      </div>
    )
  }

  return (
    <div className="placeholder">
      <b>Not connected</b>
      Choose how to reach the robot on the left, then press Connect.
    </div>
  )
}

/** Live view plus the controls that belong to it. Sized by the surrounding split. */
export default function CameraPanel() {
  const { conn, media, connState, log } = useRobot()
  const { stream, videoOn, setVideo, audioOn, setAudio } = media
  const { sportState } = useTelemetry()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const connected = connState === 'connected'
  const showing = videoOn && !!stream

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  const saveFrame = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => blob && download(blob, 'png'))
  }

  const takePhoto = async () => {
    setCapturing(true)
    setPhotoError(null)
    try {
      download(await conn.capturePhoto(), 'jpg')
      log('Photo saved.')
    } catch (e) {
      setPhotoError((e as Error).message)
      log(`Photo failed: ${(e as Error).message}`)
    } finally {
      setCapturing(false)
    }
  }

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `go2-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const speed = sportState?.velocity
    ? Math.hypot(sportState.velocity[0] ?? 0, sportState.velocity[1] ?? 0)
    : null

  return (
    <>
      <div className="camera" ref={containerRef}>
        <video ref={videoRef} autoPlay playsInline muted={muted} style={{ display: showing ? 'block' : 'none' }} />

        {!showing && <CameraStatus connected={connected} starting={videoOn && !stream} />}

        {showing && (
          <div className="overlay">
            {sportState?.mode !== undefined && (
              <span className="chip">
                <b>{MODE_NAMES[sportState.mode] ?? `mode ${sportState.mode}`}</b>
              </span>
            )}
            {speed !== null && (
              <span className="chip">
                <b>{speed.toFixed(2)}</b> m/s
              </span>
            )}
          </div>
        )}
      </div>

      <div className="camera-bar">
        <button className={`btn sm${videoOn ? ' on' : ''}`} disabled={!connected} title={videoOn ? 'Stop the video stream' : 'Start the video stream'} onClick={() => setVideo(!videoOn)}>
          {videoOn ? <CameraIcon size={15} /> : <CameraOffIcon size={15} />}
          Camera
        </button>
        {/* Listening used to be two controls that were never useful apart: one
            asked the robot to send its microphone, the other unmuted it here,
            and either alone is silence. They are one switch. */}
        <button
          className={`btn sm${audioOn && !muted ? ' on' : ''}`}
          disabled={!connected}
          title={audioOn && !muted ? 'Stop listening to the robot' : 'Hear what the robot hears'}
          onClick={() => {
            const on = !(audioOn && !muted)
            setAudio(on)
            setMuted(!on)
          }}
        >
          {audioOn && !muted ? <SpeakerIcon size={15} /> : <SpeakerOffIcon size={15} />}
          Listen
        </button>

        <div style={{ flex: 1 }} />

        {photoError && (
          <span className="note warn" role="alert" style={{ margin: 0 }}>
            Photo failed: {photoError}
          </span>
        )}
        <button className="btn sm" disabled={!connected || capturing} onClick={takePhoto} title="Ask the camera for a still, separate from the video stream">
          <PhotoIcon size={15} />
          {capturing ? 'Taking…' : 'Photo'}
        </button>
        <button className="btn sm ghost" disabled={!showing} onClick={saveFrame} title="Save the current video frame">
          <FrameIcon size={15} />
        </button>
        <button
          className="btn sm ghost"
          disabled={!showing}
          title="Show the camera full screen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen()
            else void containerRef.current?.requestFullscreen()
          }}
        >
          <ExpandIcon size={15} />
        </button>
      </div>
    </>
  )
}
