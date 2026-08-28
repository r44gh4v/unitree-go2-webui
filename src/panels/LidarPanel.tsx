import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useRobot } from '../state/RobotContext'
import { TOPICS } from '../lib/constants'
import type { VoxelMesh } from '../lib/voxel'

/** How long the robot gets to produce a first frame before we say something. */
const FIRST_FRAME_MS = 8000

/** Scene colours, taken from the interface palette so the view is part of it. */
const SCENE = {
  background: 0xf7e4d6,
  grid: 0xe3bfab,
  gridEdge: 0xd8ab93,
  robot: 0x9e122c,
}

const START_VIEW = { radius: 6, theta: Math.PI / 4, phi: Math.PI / 3 }

/**
 * Live voxel map from the head lidar, drawn as a height-coloured surface mesh
 * (only the faces of solid voxels that face empty space, so it reads as a real
 * surface, not a cloud of dots). Drag to orbit, scroll to zoom.
 */
export default function LidarPanel() {
  const { conn, connState, log } = useRobot()
  const connected = connState === 'connected'
  const mountRef = useRef<HTMLDivElement>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const renderRef = useRef<(() => void) | null>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const topDownRef = useRef<(() => void) | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [stats, setStats] = useState<{ faces: number; voxels: number; ts: number } | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // three.js scene, created once
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(SCENE.background)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
    const spherical = { ...START_VIEW }
    const target = new THREE.Vector3(0, 0, 0.3)

    // The scene is static between lidar frames and between drags, so it is
    // drawn on demand. The old version ran requestAnimationFrame forever, which
    // kept a GPU and a CPU core busy on a tab showing nothing.
    let queued = false
    const draw = () => {
      queued = false
      renderer.render(scene, camera)
    }
    const requestRender = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(draw)
    }
    renderRef.current = requestRender

    const applyCamera = () => {
      camera.position.set(
        target.x + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta),
        target.y + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
        target.z + spherical.radius * Math.cos(spherical.phi),
      )
      camera.up.set(0, 0, 1)
      camera.lookAt(target)
      requestRender()
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'none'

    applyCamera()

    resetRef.current = () => {
      Object.assign(spherical, START_VIEW)
      applyCamera()
    }
    topDownRef.current = () => {
      spherical.phi = 0.16
      spherical.theta = Math.PI / 2
      applyCamera()
    }

    // Ground grid at one metre per division, so the view carries its own scale.
    const grid = new THREE.GridHelper(20, 20, SCENE.gridEdge, SCENE.grid)
    grid.rotation.x = Math.PI / 2
    scene.add(grid)

    const robot = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.25),
      new THREE.MeshBasicMaterial({ color: SCENE.robot, wireframe: true }),
    )
    robot.position.set(0, 0, 0.15)
    scene.add(robot)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const voxelMesh = new THREE.Mesh(geometry, material)
    voxelMesh.frustumCulled = false
    scene.add(voxelMesh)
    meshRef.current = voxelMesh

    // orbit interaction
    let dragging = false
    let lastX = 0
    let lastY = 0
    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      renderer.domElement.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      spherical.theta -= (e.clientX - lastX) * 0.008
      spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi - (e.clientY - lastY) * 0.008))
      lastX = e.clientX
      lastY = e.clientY
      applyCamera()
    }
    const onUp = () => {
      dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      spherical.radius = Math.max(1, Math.min(40, spherical.radius * (1 + Math.sign(e.deltaY) * 0.12)))
      applyCamera()
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointercancel', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      requestRender()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    return () => {
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointercancel', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      voxelMesh.geometry.dispose()
      material.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      meshRef.current = null
      renderRef.current = null
      resetRef.current = null
      topDownRef.current = null
    }
  }, [])

  // Lidar health, so a stream that never starts can say why.
  const lidarState = useRef<unknown>(null)
  useEffect(() => {
    if (!connected) return
    return conn.subscribe(TOPICS.ULIDAR_STATE, (d) => (lidarState.current = d))
  }, [connected, conn])

  // subscription lifecycle
  useEffect(() => {
    if (!streaming || !connected) return
    let cancelled = false
    let gotFrame = false

    setStatus('Asking for full bandwidth…')

    const start = async () => {
      try {
        await conn.disableTrafficSaving(true)
      } catch {
        // A refusal and a success look the same on this call - it resolves on
        // any reply and reads no status code - so only silence is reportable.
        log('The robot did not confirm full bandwidth; lidar frames may be slow.')
      }
      if (cancelled) return
      setStatus('Switching the lidar on…')
      // The firmware routinely drops the first switch-on packet, so send it a
      // few times at a short spacing (this is what the Go app does).
      for (let i = 0; i < 5 && !cancelled; i++) {
        conn.publish(TOPICS.ULIDAR_SWITCH, 'on')
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!cancelled) setStatus('Waiting for the first frame…')
    }
    void start()

    const deadline = setTimeout(() => {
      if (cancelled || gotFrame) return
      setStatus(
        lidarState.current
          ? 'No frames yet, though the lidar is reporting. Try full bandwidth in the System tab.'
          : 'No frames and no lidar report. The lidar service may be stopped - check Services in the System tab.',
      )
    }, FIRST_FRAME_MS)

    const unsub = conn.subscribe(TOPICS.ULIDAR_ARRAY, (data) => {
      const mesh = data as VoxelMesh
      if (!mesh?.positions || !meshRef.current) return
      gotFrame = true
      setStatus(null)
      const geom = meshRef.current.geometry
      geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geom.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
      geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geom.computeVertexNormals()
      geom.computeBoundingSphere()
      setStats({ faces: mesh.faceCount, voxels: mesh.voxelCount, ts: mesh.ts })
      renderRef.current?.()
    })

    return () => {
      cancelled = true
      clearTimeout(deadline)
      unsub()
      conn.publish(TOPICS.ULIDAR_SWITCH, 'off')
      setStatus(null)
    }
  }, [streaming, connected, conn, log])

  // A dropped link leaves the switch on with nothing behind it.
  useEffect(() => {
    if (!connected) setStreaming(false)
  }, [connected])

  const clearMap = useCallback(() => {
    const geom = meshRef.current?.geometry
    if (!geom) return
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    setStats(null)
    renderRef.current?.()
  }, [])

  return (
    <div className="section lidar-section">
      <p className="eyebrow">Lidar map</p>
      <p className="note">
        Uses real bandwidth, so it stays off until asked.
      </p>

      <button
        className={`btn block${streaming ? ' on' : ''}`}
        style={{ marginBottom: 8 }}
        disabled={!connected}
        title="Turn the head lidar on and stream its 3D occupancy map"
        onClick={() => setStreaming((s) => !s)}
      >
        {streaming ? 'Stop lidar' : 'Start lidar'}
      </button>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn sm" title="Back to the starting angle" onClick={() => resetRef.current?.()}>
          Reset view
        </button>
        <button className="btn sm" title="Look straight down" onClick={() => topDownRef.current?.()}>
          Top down
        </button>
        <button className="btn sm ghost" title="Throw away the map drawn so far" onClick={clearMap}>
          Clear map
        </button>
      </div>

      {status && <p className="note warn">{status}</p>}

      <div className="lidar-wrap">
        <div ref={mountRef} className="lidar-canvas" />
        {stats && (
          <span className="lidar-overlay tl">
            {stats.voxels.toLocaleString()} voxels · {stats.faces.toLocaleString()} faces ·{' '}
            {new Date(stats.ts).toLocaleTimeString()}
          </span>
        )}
        <span className="lidar-overlay br">1 m grid. Drag to orbit, scroll to zoom.</span>
      </div>
    </div>
  )
}
