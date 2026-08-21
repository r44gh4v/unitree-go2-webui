import { useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { MODE_NAMES } from '../lib/types'
import {
  CameraIcon, CameraOffIcon, MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon,
  PhotoIcon, FrameIcon, ExpandIcon,
} from './Icons'

/** What the central view shows before the camera is up: the connection's own state. */
function CameraStatus({ connected, starting }: { connected: boolean; starting: boolean }) {
  const { connState, connError, ip, disconnect, retry } = useRobot()

  if (connState === 'connecting' || connState === 'validating') {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <b>{connState === 'validating' ? 'Authenticating' : 'Connecting'}</b>
        {connState === 'validating' ? 'Exchanging keys with the robot.' : `Reaching ${ip || 'the robot'}…`}
        <button className="btn sm ghost" style={{ marginTop: 12 }} onClick={disconnect}>
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
        {retry && (
          <button className="btn sm" style={{ marginTop: 12 }} onClick={retry}>
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
  const { conn, stream, videoOn, setVideo, audioOn, setAudio, connState, sportState, log } = useRobot()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(true)
  const [capturing, setCapturing] = useState(false)

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
    try {
      download(await conn.capturePhoto(), 'jpg')
      log('Photo saved.')
    } catch (e) {
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
        <button className={`btn sm${videoOn ? ' on' : ''}`} disabled={!connected} title="Start or stop the robot's camera feed" onClick={() => setVideo(!videoOn)}>
          {videoOn ? <CameraIcon size={15} /> : <CameraOffIcon size={15} />}
          Camera
        </button>
        <button className={`btn sm${audioOn ? ' on' : ''}`} disabled={!connected} title="Start or stop the robot's microphone" onClick={() => setAudio(!audioOn)}>
          {audioOn ? <MicIcon size={15} /> : <MicOffIcon size={15} />}
          Mic
        </button>
        <button className="btn sm ghost" disabled={!audioOn} title="Mute or unmute the robot audio in your browser" onClick={() => setMuted((m) => !m)}>
          {muted ? <SpeakerOffIcon size={15} /> : <SpeakerIcon size={15} />}
        </button>

        <div style={{ flex: 1 }} />

        <button className="btn sm" disabled={!connected || capturing} onClick={takePhoto} title="Full-resolution still from the camera">
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
