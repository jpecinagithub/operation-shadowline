// Tactical minimap: canvas 2D overlay (no react re-renders).
// Shows player position + facing, movement trail, live enemies and the
// current objective marker with distance. North-up (north = -Z at top).
import { useEffect, useRef } from 'react'
import { playerRef } from '../player/playerRef.js'
import { useGame } from '../systems/GameState.js'
import { enemyRegistry } from '../enemies/enemyRegistry.js'
import { MAP_BOUNDS, objectiveWorldPos } from '../systems/radar.js'

const SIZE = 190
const TRAIL_MAX = 60

export default function Minimap() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    const trail = []
    let lastTrailT = 0
    let enemies = []
    let lastEnemyT = 0
    let lastMission = null
    let raf = 0

    const draw = (t) => {
      raf = requestAnimationFrame(draw)
      const g = useGame.getState()
      if (g.status === 'dead' || g.status === 'complete') return
      if (g.mission !== lastMission) {
        lastMission = g.mission
        trail.length = 0
        enemies = []
      }
      const bounds = MAP_BOUNDS[g.mission] || MAP_BOUNDS.desert
      const px = playerRef.position.x
      const pz = playerRef.position.z
      const W = (x) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * SIZE
      const H = (z) => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * SIZE

      if (t - lastTrailT > 300) {
        lastTrailT = t
        const last = trail[trail.length - 1]
        if (!last || Math.hypot(px - last.x, pz - last.z) > 1.5) {
          trail.push({ x: px, z: pz })
          if (trail.length > TRAIL_MAX) trail.shift()
        }
      }
      if (t - lastEnemyT > 150) {
        lastEnemyT = t
        enemies = enemyRegistry.alive().map((e) => {
          const p = e.getPosition()
          return { x: p.x, z: p.z }
        })
      }

      ctx.clearRect(0, 0, SIZE, SIZE)
      // backdrop
      ctx.fillStyle = 'rgba(6, 9, 7, 0.72)'
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.save()
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2)
      ctx.clip()

      // movement trail
      if (trail.length > 1) {
        ctx.strokeStyle = 'rgba(216, 161, 61, 0.4)'
        ctx.lineWidth = 2
        ctx.beginPath()
        trail.forEach((q, i) => {
          const X = W(q.x)
          const Y = H(q.z)
          if (i === 0) ctx.moveTo(X, Y)
          else ctx.lineTo(X, Y)
        })
        ctx.stroke()
      }

      // objective marker
      const obj = g.objectives[g.objectiveIndex]
      const op = objectiveWorldPos(obj)
      let dist = null
      if (op) {
        const X = W(op.x)
        const Y = H(op.z)
        const pulse = 0.5 + 0.3 * Math.sin(t / 320)
        ctx.strokeStyle = `rgba(255, 215, 94, ${pulse})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(X, Y, 9 + 2 * Math.sin(t / 320), 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#ffd75e'
        ctx.save()
        ctx.translate(X, Y)
        ctx.rotate(Math.PI / 4)
        ctx.fillRect(-4.5, -4.5, 9, 9)
        ctx.restore()
        dist = Math.round(Math.hypot(op.x - px, op.z - pz))
      }

      // enemies
      const er = 3.2 + 0.7 * Math.sin(t / 260)
      ctx.fillStyle = '#ff5a4e'
      for (const e of enemies) {
        ctx.beginPath()
        ctx.arc(W(e.x), H(e.z), er, 0, Math.PI * 2)
        ctx.fill()
      }

      // player arrow (forward = (sin yaw, cos yaw) on the x/z plane)
      const ang = Math.atan2(Math.cos(playerRef.yaw), Math.sin(playerRef.yaw))
      ctx.save()
      ctx.translate(W(px), H(pz))
      ctx.rotate(ang)
      ctx.fillStyle = '#f2e8d0'
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(9, 0)
      ctx.lineTo(-5, -6)
      ctx.lineTo(-2.5, 0)
      ctx.lineTo(-5, 6)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      ctx.restore() // unclip
      // ring + north marker + distance readout
      ctx.strokeStyle = 'rgba(216, 161, 61, 0.65)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(232, 221, 199, 0.75)'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('N', SIZE / 2, 13)
      if (dist !== null) {
        ctx.fillStyle = 'rgba(255, 215, 94, 0.95)'
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText(`OBJ ${dist}m`, SIZE / 2, SIZE - 9)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="minimap-wrap">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
    </div>
  )
}
