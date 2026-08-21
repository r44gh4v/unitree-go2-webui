import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useRobot } from '../state/RobotContext'
import { TOPICS } from '../lib/constants'
import type { VoxelMesh } from '../lib/voxel'

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
  const [streaming, setStreaming] = useState(false)
  const [stats, setStats] = useState<{ faces: number; voxels: number; ts: number } | null>(null)

  // three.js scene, created once
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x2a1016)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
    const spherical = { radius: 6, theta: Math.PI / 4, phi: Math.PI / 3 }
    const target = new THREE.Vector3(0, 0, 0.3)

    const applyCamera = () => {
      camera.position.set(
        target.x + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta),
        target.y + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
        target.z + spherical.radius * Math.cos(spherical.phi),
      )
      camera.up.set(0, 0, 1)
      camera.lookAt(target)
    }
    applyCamera()

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.touchAction = 'none'

    // ground grid and origin marker so an empty scene still reads as 3D
    const grid = new THREE.GridHelper(20, 40, 0x6d3340, 0x43202a)
    grid.rotation.x = Math.PI / 2
    scene.add(grid)

    const robot = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xf99d90, wireframe: true }),
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
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const loop = () => {
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
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
    }
  }, [])

  // subscription lifecycle
  useEffect(() => {
    if (!streaming || !connected) return
    let cancelled = false

    const start = async () => {
      try {
        await conn.disableTrafficSaving(true)
      } catch {
        log('Traffic saving request went unanswered; lidar frames may be slow.')
      }
      if (cancelled) return
      // The firmware routinely drops the first switch-on packet, so send it a
      // few times at a short spacing (this is what the Go app does).
      for (let i = 0; i < 5 && !cancelled; i++) {
        conn.publish(TOPICS.ULIDAR_SWITCH, 'on')
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    void start()

    const unsub = conn.subscribe(TOPICS.ULIDAR_ARRAY, (data) => {
      const mesh = data as VoxelMesh
      if (!mesh?.positions || !meshRef.current) return
      const geom = meshRef.current.geometry
      geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geom.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3))
      geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geom.computeVertexNormals()
      geom.computeBoundingSphere()
      setStats({ faces: mesh.faceCount, voxels: mesh.voxelCount, ts: mesh.ts })
    })

    return () => {
      cancelled = true
      unsub()
      conn.publish(TOPICS.ULIDAR_SWITCH, 'off')
    }
  }, [streaming, connected, conn, log])

  return (
    <div className="section lidar-section">
      <p className="eyebrow">Lidar map</p>
      <p className="note">
        The head lidar builds an occupancy grid of the space around the robot. Streaming it uses real bandwidth, so it
        stays off until you ask for it.
      </p>

      <button
        className={`btn block${streaming ? ' primary' : ''}`}
        style={{ marginBottom: 10 }}
        disabled={!connected}
        title="Turn the head lidar on and stream its 3D occupancy map (uses bandwidth)"
        onClick={() => setStreaming((s) => !s)}
      >
        {streaming ? 'Stop lidar' : 'Start lidar'}
      </button>

      <div className="lidar-wrap">
        <div ref={mountRef} className="lidar-canvas" />
        {streaming && (
          <span className="lidar-overlay tl">
            {stats
              ? `${stats.voxels.toLocaleString()} voxels · ${stats.faces.toLocaleString()} faces · ${new Date(stats.ts).toLocaleTimeString()}`
              : 'Waiting for the first frame…'}
          </span>
        )}
        <span className="lidar-overlay br">Drag to orbit, scroll to zoom.</span>
      </div>
    </div>
  )
}
