// Grenades: G key throws a physics grenade (rapier dynamic ball). 3s fuse,
// then explosion FX + radial damage to enemies, damageables, and the player.
// Caps at 4 live grenades.
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { RigidBody, BallCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'
import { playerRef } from '../player/playerRef.js'
import { enemyRegistry } from '../enemies/enemyRegistry.js'
import { damageables } from '../systems/damageables.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'

const MAX_LIVE = 4
const FUSE_MS = 3000
const BLAST_ENEMY_R = 7
const BLAST_DMG_R = 6

const _dir = new THREE.Vector3()

export default function Grenades() {
  const camera = useThree((s) => s.camera)
  const [items, setItems] = useState([]) // {id, pos, vel, ang}
  const bodies = useRef(new Map()) // id -> RapierRigidBody
  const timers = useRef(new Map()) // id -> timeout
  const live = useRef(0)
  const seq = useRef(1)
  const camRef = useRef(camera)
  camRef.current = camera

  const detonateRef = useRef(null)
  detonateRef.current = (id) => {
    const body = bodies.current.get(id)
    timers.current.delete(id)
    const remove = () => {
      bodies.current.delete(id)
      live.current = Math.max(0, live.current - 1)
      setItems((prev) => prev.filter((it) => it.id !== id))
    }
    if (!body) {
      remove()
      return
    }
    let p
    try {
      p = body.translation()
    } catch {
      remove()
      return
    }
    const pos = new THREE.Vector3(p.x, p.y, p.z)
    fx.explosion(pos, 1.3)
    audio.explosion(1)
    useGame.getState().emit('explosion')

    // enemies: 130 falloff over 7m
    for (const e of enemyRegistry.alive()) {
      const ep = e.getCenter ? e.getCenter() : e.getPosition()
      const d = ep.distanceTo(pos)
      if (d < BLAST_ENEMY_R) {
        _dir.copy(ep).sub(pos)
        if (_dir.lengthSq() > 1e-6) _dir.normalize()
        else _dir.set(0, 1, 0)
        enemyRegistry.damage(e.id, 130 * (1 - d / BLAST_ENEMY_R), pos, _dir)
      }
    }
    // destructibles
    damageables.radial(pos, BLAST_DMG_R, 160)
    // player self-damage within 4m + shake within 15m
    const pd = playerRef.position.distanceTo(pos)
    if (pd < 4) useGame.getState().damagePlayer(55 * (1 - pd / 4))
    if (pd < 15) {
      playerRef.shake = Math.min(
        1,
        playerRef.shake + THREE.MathUtils.clamp(1.2 - pd * 0.08, 0, 0.8)
      )
    }
    remove()
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyG' || e.repeat) return
      const g = useGame.getState()
      if (g.status !== 'playing') return
      if (live.current >= MAX_LIVE) return
      if (!g.throwGrenade()) return
      const cam = camRef.current
      if (!cam) return
      cam.getWorldDirection(_dir)
      const id = seq.current++
      const pos = cam.position.clone().addScaledVector(_dir, 0.6).toArray()
      const vel = _dir.clone().multiplyScalar(15)
      vel.y += 4
      const ang = [
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
      ]
      live.current += 1
      setItems((prev) => [...prev, { id, pos, vel: vel.toArray(), ang }])
      timers.current.set(
        id,
        setTimeout(() => {
          if (detonateRef.current) detonateRef.current(id)
        }, FUSE_MS)
      )
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      timers.current.forEach((t) => clearTimeout(t))
      timers.current.clear()
    }
  }, [])

  return (
    <group>
      {items.map((it) => (
        <RigidBody
          key={it.id}
          ref={(r) => {
            if (r) bodies.current.set(it.id, r)
            else bodies.current.delete(it.id)
          }}
          type="dynamic"
          colliders={false}
          position={it.pos}
          linearVelocity={it.vel}
          angularVelocity={it.ang}
          restitution={0.45}
          friction={0.6}
          ccd
          canSleep={false}
        >
          <BallCollider args={[0.09]} />
          <mesh castShadow>
            <sphereGeometry args={[0.09, 14, 14]} />
            <meshStandardMaterial color="#1c1e22" roughness={0.45} metalness={0.5} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  )
}
