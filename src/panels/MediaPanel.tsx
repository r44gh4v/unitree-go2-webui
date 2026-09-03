import { useCallback, useEffect, useRef, useState } from 'react'
import { useRobot } from '../state/RobotContext'
import { unwrapResponse } from '../lib/go2'
import { toRobotWav, uploadAudioFile, uploadMegaphone } from '../lib/audioUpload'
import { useMicRecorder } from '../hooks/useMicRecorder'
import { AUDIO_API, PLAY_MODES, TOPICS, VUI_API, VUI_COLORS, VUI_COLOR_HEX, type VuiColor } from '../lib/constants'
import { playbackLabel } from '../lib/audioPlayback'
import {
  LightIcon, SpeakerIcon, PlayIcon, PauseIcon, SkipBackIcon, SkipFwdIcon, RefreshIcon, UploadIcon, MegaphoneIcon, MicIcon, BoltIcon,
} from '../components/Icons'

interface AudioTrack {
  UNIQUE_ID: string
  CUSTOM_NAME: string
}

/** Brightness restored when the light is switched back on without a level set. */
const DEFAULT_BRIGHTNESS = 5

/** Head light, speaker, audio library, megaphone, and announcements. */
export default function MediaPanel() {
  const { conn, connState, log } = useRobot()
  const connected = connState === 'connected'

  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS)
  const [lightOn, setLightOn] = useState(true)
  const [volume, setVolume] = useState(5)
  const [color, setColor] = useState<VuiColor>('cyan')
  const [flash, setFlash] = useState(false)
  const [tracks, setTracks] = useState<AudioTrack[] | null>(null)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [playMode, setPlayMode] = useState<string>('no_cycle')
  const [playing, setPlaying] = useState<string | null>(null)
  const [megaphone, setMegaphone] = useState(false)
  const [upload, setUpload] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const megaphoneFileRef = useRef<HTMLInputElement>(null)
  const mic = useMicRecorder()
  const [talking, setTalking] = useState(false)

  const vui = (apiId: number, parameter?: unknown, label = 'VUI') =>
    conn.request(TOPICS.VUI, apiId, parameter).catch((e) => log(`${label}: ${(e as Error).message}`))

  const audio = (apiId: number, parameter: unknown = {}, label = 'Audio') =>
    conn.request(TOPICS.AUDIO_HUB_REQ, apiId, JSON.stringify(parameter)).catch((e) => {
      log(`${label}: ${(e as Error).message}`)
      return undefined
    })

  const loadTracks = useCallback(async () => {
    setLoadingTracks(true)
    try {
      const res = await conn.request(TOPICS.AUDIO_HUB_REQ, AUDIO_API.GET_AUDIO_LIST, JSON.stringify({}))
      const data = unwrapResponse<{ audio_list?: AudioTrack[] }>(res)
      setTracks(data?.audio_list ?? [])
    } catch (e) {
      log(`Audio list failed: ${(e as Error).message}`)
      setTracks([])
    } finally {
      setLoadingTracks(false)
    }
  }, [conn, log])

  // Read the robot's current settings once connected so the sliders start
  // truthful, and fetch the library rather than making someone press Load first.
  useEffect(() => {
    if (!connected) {
      setTracks(null)
      setPlaying(null)
      setMegaphone(false)
      return
    }
    let cancelled = false
    const read = async () => {
      try {
        const b = unwrapResponse<{ brightness: number }>(await conn.request(TOPICS.VUI, VUI_API.GET_BRIGHTNESS))
        if (!cancelled && typeof b?.brightness === 'number') {
          setBrightness(b.brightness || DEFAULT_BRIGHTNESS)
          setLightOn(b.brightness > 0)
        }
      } catch {
        /* older firmware may not answer */
      }
      try {
        const v = unwrapResponse<{ volume: number }>(await conn.request(TOPICS.VUI, VUI_API.GET_VOLUME))
        if (!cancelled && typeof v?.volume === 'number') setVolume(v.volume)
      } catch {
        /* ignore */
      }
      if (!cancelled) void loadTracks()
    }
    void read()
    return () => {
      cancelled = true
    }
  }, [connected, conn, loadTracks])

  // There is no request that reads back what is playing - the robot only pushes
  // this topic when a track starts, stops or advances, so the row stays empty
  // until it does rather than showing a guess.
  useEffect(() => {
    if (!connected) return
    return conn.subscribe(TOPICS.AUDIO_HUB_PLAY_STATE, (d) => {
      // undefined means the frame carried no usable report - keep what is shown.
      const label = playbackLabel(d)
      if (label !== undefined) setPlaying(label)
    })
  }, [connected, conn])

  /**
   * There is no lamp switch on this robot, so off is brightness zero. Off also
   * hands the colour back to the firmware, which is what the separate Release
   * button used to do - switching a light off should not leave the console
   * still holding its colour.
   */
  const toggleLight = (on: boolean) => {
    setLightOn(on)
    if (on) {
      void vui(VUI_API.SET_BRIGHTNESS, { brightness: brightness || DEFAULT_BRIGHTNESS }, 'Head light')
    } else {
      void vui(VUI_API.SET_BRIGHTNESS, { brightness: 0 }, 'Head light')
      void vui(VUI_API.RELEASE_COLOR, {}, 'Head light')
    }
  }

  const doUpload = async (file: File, asMegaphone: boolean) => {
    setUpload(`Converting ${file.name}…`)
    try {
      const wav = await toRobotWav(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      const onProgress = ({ sent, total }: { sent: number; total: number }) =>
        setUpload(`Sending ${Math.round((sent / Math.max(1, total)) * 100)}% - chunk ${sent} of ${total}`)
      if (asMegaphone) {
        await uploadMegaphone(conn, wav, onProgress)
        setUpload('Sent to the megaphone.')
      } else {
        await uploadAudioFile(conn, name, wav, onProgress)
        setUpload(`Uploaded "${name}".`)
        await loadTracks()
      }
    } catch (e) {
      setUpload(`Upload failed: ${(e as Error).message}`)
    }
  }

  /**
   * Hold to talk. The WebRTC audio channel is opened receive-only - the robot
   * sends us its microphone and there is no uplink - so speech reaches the
   * speaker as a finished WAV through the megaphone api rather than as a live
   * stream. It is a walkie-talkie, not a call: a phrase is heard after the
   * button is let go, not while it is held. Same cycle unitree_ui uses: enter
   * megaphone, record, upload, leave megaphone.
   *
   * All four steps are here, in order, because they are one sequence. Releasing
   * used to only stop the recorder, and an effect watching for the clip to
   * appear did the rest - the clip does not exist until the recorder assembles
   * it, so the send could not happen in the release handler without racing.
   * stop() resolves with the clip now, so the wait is expressed once and the
   * sequence reads as what it is.
   */
  const talkStart = async () => {
    if (talking) return
    setTalking(true)
    await audio(AUDIO_API.ENTER_MEGAPHONE, {}, 'Talk')
    await mic.start()
  }

  const talkEnd = async () => {
    if (!talking) return
    setTalking(false)
    try {
      const clip = await mic.stop()
      // Too short, or nothing recorded. The recorder has already said why.
      if (clip) await uploadMegaphone(conn, await toRobotWav(clip))
    } catch (e) {
      setUpload(`Talk failed: ${(e as Error).message}`)
    } finally {
      // Leaving megaphone mode matters more than the clip did: staying in it
      // holds the speaker open.
      await audio(AUDIO_API.EXIT_MEGAPHONE, {}, 'Talk')
      mic.discard()
    }
  }

  const hasTracks = !!tracks?.length

  return (
    <div className="section">
      <p className="eyebrow icon-eyebrow"><LightIcon size={14} /> Head light</p>

      <label className={`toggle${lightOn ? ' on' : ''}`} title="Switch the head light off by taking its brightness to zero">
        <span className="toggle-label">Light on</span>
        <input
          type="checkbox"
          checked={lightOn}
          disabled={!connected}
          onChange={(e) => toggleLight(e.target.checked)}
        />
        <span className="track" />
      </label>

      <div className="slider-row">
        <label htmlFor="bright">Brightness</label>
        <input
          id="bright"
          type="range"
          min={1}
          max={10}
          step={1}
          value={brightness}
          disabled={!connected || !lightOn}
          title="Head-light brightness, sent when you let go"
          onChange={(e) => setBrightness(Number(e.target.value))}
          onPointerUp={() => vui(VUI_API.SET_BRIGHTNESS, { brightness }, 'Brightness')}
          onKeyUp={() => vui(VUI_API.SET_BRIGHTNESS, { brightness }, 'Brightness')}
        />
        <span className="val">{brightness}/10</span>
      </div>

      {/* A swatch is the action: picking one sends it. The colour stays until
          another is picked or the light is handed back to the robot. */}
      <p className="note">Picking a colour sends it</p>
      <div className="swatches">
        {VUI_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' on' : ''}`}
            aria-label={`Set the light ${c}`}
            title={`Set the light ${c}`}
            disabled={!connected || !lightOn}
            style={{ background: VUI_COLOR_HEX[c] }}
            onClick={() => {
              setColor(c)
              void vui(
                VUI_API.SET_COLOR,
                flash ? { color: c, time: 999, flash_cycle: 1000 } : { color: c, time: 999 },
                'Light',
              )
            }}
          />
        ))}
      </div>

      <label className={`toggle${flash ? ' on' : ''} mb-4`} title="Blink the colour instead of holding it steady - applies to the next colour you pick">
        <span className="toggle-label">
          <BoltIcon size={14} />
          Blink instead of steady
        </span>
        <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} />
        <span className="track" />
      </label>

      <div className="divider" />
      <p className="eyebrow icon-eyebrow"><SpeakerIcon size={14} /> Speaker</p>

      <div className="slider-row">
        <label htmlFor="vol">Volume</label>
        <input
          id="vol"
          title="Speaker volume, sent when you let go"
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

      <div className="divider" />
      <p className="eyebrow">Stored sounds</p>

      <p className="note">{playing ? `Playing: ${playing}` : 'No playback reported yet.'}</p>

      <div className="btn-row mb-3">
        <button className="btn sm" disabled={!connected || loadingTracks} title="Fetch the list of sounds stored on the robot again" onClick={() => void loadTracks()}>
          <RefreshIcon size={14} />
          {loadingTracks ? 'Loading…' : 'Reload'}
        </button>
        <button className="btn sm" disabled={!connected || !hasTracks} title="Play the previous track" onClick={() => audio(AUDIO_API.SELECT_PREV_START_PLAY, {}, 'Previous')}>
          <SkipBackIcon size={14} />
        </button>
        <button className="btn sm" disabled={!connected || !hasTracks} title="Resume playback" onClick={() => audio(AUDIO_API.UNSUSPEND, {}, 'Resume')}>
          <PlayIcon size={13} />
        </button>
        <button className="btn sm" disabled={!connected || !hasTracks} title="Pause playback" onClick={() => audio(AUDIO_API.PAUSE, {}, 'Pause')}>
          <PauseIcon size={13} />
        </button>
        <button className="btn sm" disabled={!connected || !hasTracks} title="Play the next track" onClick={() => audio(AUDIO_API.SELECT_NEXT_START_PLAY, {}, 'Next')}>
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

      {hasTracks && (
        <div className="mb-3" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {tracks!.map((t) => (
            <button
              key={t.UNIQUE_ID}
              className="btn sm block mb-1"
              style={{ justifyContent: 'flex-start' }}
              disabled={!connected}
              title={`Play ${t.CUSTOM_NAME}`}
              onClick={() => audio(AUDIO_API.SELECT_START_PLAY, { unique_id: t.UNIQUE_ID }, 'Play')}
            >
              {t.CUSTOM_NAME}
            </button>
          ))}
        </div>
      )}
      {tracks && !hasTracks && <p className="note">No sounds stored on the robot</p>}

      <div className="divider" />
      <p className="eyebrow">Add a sound</p>
      <p className="note">
        Converted to 44.1 kHz mono WAV and sent over the data channel.
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
      <button className="btn block" disabled={!connected} title="Convert a file and add it to the robot's library" onClick={() => fileRef.current?.click()}>
        <UploadIcon size={15} />
        Choose an audio file
      </button>

      <div className="btn-row mt-2">
        {!mic.recording ? (
          <button
            className="btn sm block"
            disabled={!connected || !!mic.clip}
            title="Record a clip from your microphone"
            onClick={() => void mic.start()}
          >
            <MicIcon size={14} />
            Record from mic
          </button>
        ) : (
          <button className="btn sm block primary" title="Finish the recording" onClick={() => void mic.stop()}>
            <MicIcon size={14} />
            Stop · {mic.seconds.toFixed(1)}s
          </button>
        )}
      </div>
      {mic.clip && (
        <div className="btn-row mt-2">
          <button
            className="btn sm"
            disabled={!connected}
            title="Add the recording to the robot's library"
            onClick={async () => {
              await doUpload(mic.clip!, false)
              mic.discard()
            }}
          >
            Add to library
          </button>
          <button className="btn sm ghost" title="Throw the recording away" onClick={mic.discard}>
            Discard
          </button>
        </div>
      )}
      {mic.error && <p className="note warn">{mic.error}</p>}
      {upload && <p className="note">{upload}</p>}

      <div className="divider" />
      <p className="eyebrow">Talk through the robot</p>
      <p className="note">
        Hold to speak. The robot has no audio uplink, so your voice goes out when you let go rather than as you talk.
      </p>
      <button
        className={`btn block${talking ? ' on' : ''}`}
        disabled={!connected}
        title="Hold to record, release to play it through the robot"
        onPointerDown={() => void talkStart()}
        onPointerUp={() => void talkEnd()}
        onPointerLeave={() => void talkEnd()}
        onPointerCancel={() => void talkEnd()}
      >
        <MicIcon size={15} />
        {talking ? `Speaking - ${mic.seconds.toFixed(1)}s` : 'Hold to talk'}
      </button>

      <div className="divider" />
      <p className="eyebrow">Megaphone</p>
      <p className="note">
        Straight out of the speaker, not stored. Enter the mode first.
      </p>
      <div className="btn-row">
        <button
          className={`btn sm${megaphone ? ' on' : ''}`}
          disabled={!connected}
          title={megaphone ? 'Leave megaphone mode' : 'Route audio straight to the speaker without storing it'}
          onClick={async () => {
            // audio() resolves undefined on failure - only flip the mode when
            // the robot actually acknowledged the request.
            const res = await audio(megaphone ? AUDIO_API.EXIT_MEGAPHONE : AUDIO_API.ENTER_MEGAPHONE, {}, 'Megaphone')
            if (res !== undefined) setMegaphone(!megaphone)
          }}
        >
          <MegaphoneIcon size={14} />
          {megaphone ? 'Leave megaphone' : 'Enter megaphone'}
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
        <button className="btn sm" disabled={!connected || !megaphone} title="Play an audio file through the megaphone" onClick={() => megaphoneFileRef.current?.click()}>
          Send a clip
        </button>
        {mic.clip && (
          <button
            className="btn sm"
            disabled={!connected || !megaphone}
            title="Play the recording through the megaphone"
            onClick={async () => {
              await doUpload(mic.clip!, true)
              mic.discard()
            }}
          >
            Send the recording
          </button>
        )}
      </div>

    </div>
  )
}
