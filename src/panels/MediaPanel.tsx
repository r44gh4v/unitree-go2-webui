import { useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { unwrapResponse } from '../lib/go2'
import { toRobotWav, uploadAudioFile, uploadMegaphone } from '../lib/audioUpload'
import { useMicRecorder } from '../hooks/useMicRecorder'
import { AUDIO_API, PLAY_MODES, TOPICS, VUI_API, VUI_COLORS, VUI_COLOR_HEX, type VuiColor } from '../lib/constants'
import {
  LightIcon, SpeakerIcon, PlayIcon, PauseIcon, SkipBackIcon, SkipFwdIcon, RefreshIcon, UploadIcon, MegaphoneIcon, MicIcon, BoltIcon,
} from '../components/Icons'

interface AudioTrack {
  UNIQUE_ID: string
  CUSTOM_NAME: string
}

/** Head light, speaker, audio library, megaphone, and announcements. */
export default function MediaPanel() {
  const { conn, connState, log } = useRobot()
  const connected = connState === 'connected'

  const [brightness, setBrightness] = useState(5)
  const [volume, setVolume] = useState(5)
  const [color, setColor] = useState<VuiColor>('cyan')
  const [colorSeconds, setColorSeconds] = useState(5)
  const [flash, setFlash] = useState(false)
  const [tracks, setTracks] = useState<AudioTrack[] | null>(null)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [playMode, setPlayMode] = useState<string>('no_cycle')
  const [megaphone, setMegaphone] = useState(false)
  const [upload, setUpload] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const megaphoneFileRef = useRef<HTMLInputElement>(null)
  const mic = useMicRecorder()

  const vui = (apiId: number, parameter?: unknown, label = 'VUI') =>
    conn.request(TOPICS.VUI, apiId, parameter).catch((e) => log(`${label}: ${(e as Error).message}`))

  const audio = (apiId: number, parameter: unknown = {}, label = 'Audio') =>
    conn.request(TOPICS.AUDIO_HUB_REQ, apiId, JSON.stringify(parameter)).catch((e) => {
      log(`${label}: ${(e as Error).message}`)
      return undefined
    })

  // Read the robot's current settings once connected so the sliders start truthful.
  useEffect(() => {
    if (!connected) {
      setTracks(null)
      return
    }
    let cancelled = false
    const read = async () => {
      try {
        const b = unwrapResponse<{ brightness: number }>(await conn.request(TOPICS.VUI, VUI_API.GET_BRIGHTNESS))
        if (!cancelled && typeof b?.brightness === 'number') setBrightness(b.brightness)
      } catch {
        /* older firmware may not answer */
      }
      try {
        const v = unwrapResponse<{ volume: number }>(await conn.request(TOPICS.VUI, VUI_API.GET_VOLUME))
        if (!cancelled && typeof v?.volume === 'number') setVolume(v.volume)
      } catch {
        /* ignore */
      }
    }
    void read()
    return () => {
      cancelled = true
    }
  }, [connected, conn])

  const loadTracks = async () => {
    setLoadingTracks(true)
    try {
      const res = await conn.request(TOPICS.AUDIO_HUB_REQ, AUDIO_API.GET_AUDIO_LIST, JSON.stringify({}))
      const data = unwrapResponse<{ audio_list?: AudioTrack[] }>(res)
      setTracks(data?.audio_list ?? [])
      if (!data?.audio_list?.length) log('The robot reports no stored audio files.')
    } catch (e) {
      log(`Audio list failed: ${(e as Error).message}`)
      setTracks([])
    } finally {
      setLoadingTracks(false)
    }
  }

  const doUpload = async (file: File, asMegaphone: boolean) => {
    setUpload(`Converting ${file.name}…`)
    try {
      const wav = await toRobotWav(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      const onProgress = ({ sent, total }: { sent: number; total: number }) =>
        setUpload(`Sending ${sent} of ${total} chunks…`)
      if (asMegaphone) {
        await uploadMegaphone(conn, wav, onProgress)
        setUpload('Sent to the megaphone.')
      } else {
        await uploadAudioFile(conn, name, wav, onProgress)
        setUpload(`Uploaded "${name}". Reload the list to play it.`)
      }
    } catch (e) {
      setUpload(`Upload failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="section">
      <p className="eyebrow icon-eyebrow"><LightIcon size={14} /> Head light</p>

      <div className="slider-row">
        <label htmlFor="bright">Brightness</label>
        <input
          id="bright"
          type="range"
          min={0}
          max={10}
          step={1}
          value={brightness}
          disabled={!connected}
          title="Head-light brightness, sent when you release"
          onChange={(e) => setBrightness(Number(e.target.value))}
          onPointerUp={() => vui(VUI_API.SET_BRIGHTNESS, { brightness }, 'Brightness')}
          onKeyUp={() => vui(VUI_API.SET_BRIGHTNESS, { brightness }, 'Brightness')}
        />
        <span className="val">{brightness}/10</span>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
        {VUI_COLORS.map((c) => (
          <button
            key={c}
            aria-label={c}
            title={c}
            onClick={() => setColor(c)}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: VUI_COLOR_HEX[c],
              border: color === c ? '2px solid var(--accent)' : '1px solid var(--line-strong)',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>

      <div className="slider-row">
        <label htmlFor="secs">Hold for</label>
        <input id="secs" type="range" min={1} max={30} step={1} value={colorSeconds} title="How long the colour stays before returning to normal" onChange={(e) => setColorSeconds(Number(e.target.value))} />
        <span className="val">{colorSeconds}s</span>
      </div>

      <label className={`toggle${flash ? ' on' : ''}`} style={{ marginBottom: 10 }} title="Blink the light instead of a steady colour">
        <span className="toggle-label">
          <BoltIcon size={14} />
          Flash once a second
        </span>
        <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
        <span className="track" />
      </label>

      <button
        className="btn block"
        disabled={!connected}
        title="Send the chosen colour and duration to the head light"
        onClick={() =>
          vui(
            VUI_API.SET_COLOR,
            flash ? { color, time: colorSeconds, flash_cycle: 1000 } : { color, time: colorSeconds },
            'Set colour',
          )
        }
      >
        <LightIcon size={15} />
        Set light to {color}
      </button>

      <div className="divider" />
      <p className="eyebrow icon-eyebrow"><SpeakerIcon size={14} /> Speaker</p>

      <div className="slider-row">
        <label htmlFor="vol">Volume</label>
        <input
          id="vol"
          title="Speaker volume, sent when you release"
          type="range"
          min={0}
          max={10}
          step={1}
          value={volume}
          disabled={!connected}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => vui(VUI_API.SET_VOLUME, { volume }, 'Volume')}
          onKeyUp={() => vui(VUI_API.SET_VOLUME, { volume }, 'Volume')}
        />
        <span className="val">{volume}/10</span>
      </div>

      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className="btn sm" disabled={!connected || loadingTracks} title="Fetch the list of sounds stored on the robot" onClick={loadTracks}>
          <RefreshIcon size={14} />
          {loadingTracks ? 'Loading…' : 'Load'}
        </button>
        <button className="btn sm" disabled={!connected} title="Previous track" onClick={() => audio(AUDIO_API.SELECT_PREV_START_PLAY, {}, 'Previous')}>
          <SkipBackIcon size={14} />
        </button>
        <button className="btn sm" disabled={!connected} title="Resume playback" onClick={() => audio(AUDIO_API.UNSUSPEND, {}, 'Resume')}>
          <PlayIcon size={13} />
        </button>
        <button className="btn sm" disabled={!connected} title="Pause playback" onClick={() => audio(AUDIO_API.PAUSE, {}, 'Pause')}>
          <PauseIcon size={13} />
        </button>
        <button className="btn sm" disabled={!connected} title="Next track" onClick={() => audio(AUDIO_API.SELECT_NEXT_START_PLAY, {}, 'Next')}>
          <SkipFwdIcon size={14} />
        </button>
      </div>

      <div className="field">
        <label htmlFor="pm">Repeat</label>
        <select
          id="pm"
          className="input"
          title="Whether the robot repeats one track, all tracks, or plays once"
          value={playMode}
          disabled={!connected}
          onChange={(e) => {
            setPlayMode(e.target.value)
            void audio(AUDIO_API.SET_PLAY_MODE, { play_mode: e.target.value }, 'Play mode')
          }}
        >
          {PLAY_MODES.map((m) => (
            <option key={m} value={m}>
              {m === 'single_cycle' ? 'Repeat one' : m === 'list_loop' ? 'Repeat all' : 'Play once'}
            </option>
          ))}
        </select>
      </div>

      {tracks && tracks.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
          {tracks.map((t) => (
            <button
              key={t.UNIQUE_ID}
              className="btn sm block"
              style={{ justifyContent: 'flex-start', marginBottom: 4 }}
              disabled={!connected}
              onClick={() => audio(AUDIO_API.SELECT_START_PLAY, { unique_id: t.UNIQUE_ID }, 'Play')}
            >
              {t.CUSTOM_NAME}
            </button>
          ))}
        </div>
      )}
      {tracks && tracks.length === 0 && <p className="note">No audio files stored on the robot.</p>}

      <div className="divider" />
      <p className="eyebrow">Add a sound</p>
      <p className="note">
        Pick any audio file. It is converted to the 44.1 kHz mono WAV the robot expects and sent over the data
        channel, so a long track takes a while.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void doUpload(f, false)
          e.target.value = ''
        }}
      />
      <button className="btn block" disabled={!connected} title="Convert a file to the robot format and upload it to its library" onClick={() => fileRef.current?.click()}>
        <UploadIcon size={15} />
        Choose an audio file
      </button>

      <div className="btn-row" style={{ marginTop: 6 }}>
        {!mic.recording ? (
          <button
            className="btn sm block"
            disabled={!connected || !!mic.clip}
            title="Record a clip from your microphone to send to the robot"
            onClick={() => void mic.start()}
          >
            <MicIcon size={14} />
            Record from mic
          </button>
        ) : (
          <button className="btn sm block primary" title="Stop recording" onClick={mic.stop}>
            <MicIcon size={14} />
            Stop · {mic.seconds.toFixed(1)}s
          </button>
        )}
      </div>
      {mic.clip && (
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className="btn sm"
            disabled={!connected}
            title="Add the recording to the robot's audio library"
            onClick={async () => {
              await doUpload(mic.clip!, false)
              mic.discard()
            }}
          >
            Add to library
          </button>
          <button
            className="btn sm"
            disabled={!connected || !megaphone}
            title={megaphone ? 'Play the recording through the megaphone' : 'Enter megaphone mode first (below)'}
            onClick={async () => {
              await doUpload(mic.clip!, true)
              mic.discard()
            }}
          >
            To megaphone
          </button>
          <button className="btn sm ghost" title="Throw the recording away" onClick={mic.discard}>
            Discard
          </button>
        </div>
      )}
      {mic.error && <p className="note warn">{mic.error}</p>}
      {upload && <p className="note">{upload}</p>}

      <div className="divider" />
      <p className="eyebrow">Megaphone</p>
      <p className="note">
        Megaphone mode plays audio straight out of the speaker without storing it. Enter the mode, then send a clip.
      </p>
      <div className="btn-row">
        <button
          className={`btn sm${megaphone ? ' primary' : ''}`}
          disabled={!connected}
          title="Route live audio straight to the speaker without storing it"
          onClick={async () => {
            // audio() resolves undefined on failure - only flip the mode when
            // the robot actually acknowledged the request.
            const res = await audio(megaphone ? AUDIO_API.EXIT_MEGAPHONE : AUDIO_API.ENTER_MEGAPHONE, {}, 'Megaphone')
            if (res !== undefined) setMegaphone(!megaphone)
          }}
        >
          <MegaphoneIcon size={14} />
          {megaphone ? 'Exit megaphone' : 'Enter megaphone'}
        </button>
        <input
          ref={megaphoneFileRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void doUpload(f, true)
            e.target.value = ''
          }}
        />
        <button className="btn sm" disabled={!connected || !megaphone} title="Play a clip through the megaphone" onClick={() => megaphoneFileRef.current?.click()}>
          Send a clip
        </button>
      </div>

      <div className="divider" />
      <p className="eyebrow">Built-in announcements</p>
      <div className="btn-grid">
        <button className="btn" disabled={!connected} title="Play the built-in 'avoidance on' announcement" onClick={() => audio(AUDIO_API.PLAY_START_OBSTACLE_AVOIDANCE, {}, 'Announcement')}>
          Avoidance on
        </button>
        <button className="btn" disabled={!connected} title="Play the built-in 'avoidance off' announcement" onClick={() => audio(AUDIO_API.PLAY_EXIT_OBSTACLE_AVOIDANCE, {}, 'Announcement')}>
          Avoidance off
        </button>
        <button className="btn" disabled={!connected} title="Play the built-in 'follow on' announcement" onClick={() => audio(AUDIO_API.PLAY_START_COMPANION_MODE, {}, 'Announcement')}>
          Follow on
        </button>
        <button className="btn" disabled={!connected} title="Play the built-in 'follow off' announcement" onClick={() => audio(AUDIO_API.PLAY_EXIT_COMPANION_MODE, {}, 'Announcement')}>
          Follow off
        </button>
      </div>

    </div>
  )
}
