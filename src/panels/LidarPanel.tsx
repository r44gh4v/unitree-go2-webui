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
  const { conn, connState, sensing, log } = useRobot()
  const { lidarOn, lidarState } = sensing
  const connected = connState === 'connected'
  // Read inside the deadline timeout below, which is set up once per lidar-on
  // period and must not restart every time a lidar_state frame arrives.
  const lidarStateRef = useRef(lidarState)
  lidarStateRef.current = lidarState
  const mountRef = useRef<HTMLDivElement>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const robotRef = useRef<THREE.Mesh | null>(null)
  const renderRef = useRef<(() => void) | null>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const topDownRef = useRef<(() => void) | null>(null)
  const clearMapRef = useRef<(() => void) | null>(null)
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
    robotRef.current = robot

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })

    // Without lighting every face carried the same flat colour whatever way
    // it pointed, which is what made the map read as a cloud rather than as
    // surfaces. A key light and a soft fill are enough to separate a wall
    // from the floor.
    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 6, 9)
    scene.add(key)
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
      // Everything the scene holds, not the three things that were top of
      // mind when this was written. The grid and the robot marker each own a
      // geometry and a material too, and this panel unmounts on every tab
      // switch - so what was missed here accumulated on the GPU for the life
      // of the session, invisibly, until the browser started refusing new
      // WebGL contexts.
      scene.traverse((obj) => {
        const holder = obj as Partial<THREE.Mesh>
        holder.geometry?.dispose()
        const mat = holder.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      meshRef.current = null
      robotRef.current = null
      renderRef.current = null
      resetRef.current = null
      topDownRef.current = null
    }
  }, [])

  // The map is built in the odometry frame, so the robot moves through it.
  // Without this the marker stayed at the origin and only the walls slid
  // past, which read as the map moving rather than the robot. Gated on the
  // switch for the same reason as the health topic below: rt/utlidar/* is
  // the sensor, and a stopped lidar has no odometry to publish anyway.
  useEffect(() => {
    if (!connected || !lidarOn) return
    return conn.subscribe(TOPICS.ROBOTODOM, (d) => {
      const m = robotRef.current
      if (!m) return
      const pose = (d as { pose?: { position?: Record<string, number>; orientation?: Record<string, number> } })?.pose ?? d
      const pos = (pose as { position?: Record<string, number> })?.position
      const q = (pose as { orientation?: Record<string, number> })?.orientation
      if (pos && typeof pos.x === 'number') {
        m.position.set(pos.x, pos.y ?? 0, (pos.z ?? 0) + 0.15)
      }
      if (q && typeof q.w === 'number') {
        m.quaternion.set(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w)
      }
      renderRef.current?.()
    })
  }, [connected, lidarOn, conn])

  // subscription lifecycle
  useEffect(() => {
    if (!lidarOn || !connected) return
    let cancelled = false
    let gotFrame = false

    setStatus('Waiting for the first frame…')

    const deadline = setTimeout(() => {
      if (cancelled || gotFrame) return
      setStatus(
        lidarStateRef.current
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
      // The switch itself is the context's job: leaving this tab must not stop
      // a lidar the operator deliberately left running.
      setStatus(null)
    }
  }, [lidarOn, connected, conn, log])

  const clearMap = useCallback(() => {
    const geom = meshRef.current?.geometry
    if (!geom) return
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    setStats(null)
    renderRef.current?.()
  }, [])
  clearMapRef.current = clearMap

  return (
    <div className="section lidar-section">
      <p className="eyebrow">Lidar map</p>
      <p className="note">Uses real bandwidth, so it stays off until asked</p>

      <div className="btn-row mb-4">
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
        <span className="lidar-overlay br">1 m grid | Drag to orbit, scroll to zoom</span>
      </div>
    </div>
  )
}
