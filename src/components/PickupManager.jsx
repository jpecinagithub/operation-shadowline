// Renders enemy ammo drops (floating ammo boxes) and handles walk-over pickup
// + expiry. Mounted once inside the Canvas in Game.jsx.
import { useRef, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import { pickups, collectPickup } from '../systems/pickups.js'
import { playerRef } from '../player/playerRef.js'
import { audio } from '../systems/AudioManager.js'

const COLLECT_R2 = 2.6 // squared XZ distance

function DropMesh({ p }) {
  const ref = useRef()
  const baseY = p.pos[1]
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const age = (performance.now() - p.spawnedAt) / 1000
    if (ref.current) {
      // blink during the last 5s before expiring
      ref.current.visible = age < p.ttl - 5 || Math.sin(t * 12) > -0.2
      ref.current.position.y = baseY + 0.3 + Math.sin(t * 2.4 + p.id.length) * 0.12
      ref.current.rotation.y = t * 1.4
    }
  })
  return (
    <group ref={ref} position={[p.pos[0], baseY + 0.3, p.pos[2]]}>
      {/* olive ammo box */}
      <mesh>
        <boxGeometry args={[0.44, 0.3, 0.32]} />
        <meshStandardMaterial color="#4a5230" emissive="#2a3316" emissiveIntensity={0.7} />
      </mesh>
      {/* brass cartridges on top */}
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[0.32, 0.18, 0.22]} />
        <meshStandardMaterial color="#c9a227" emissive="#7a5f14" emissiveIntensity={0.9} />
      </mesh>
    </group>
  )
}

export default function PickupManager() {
  useSyncExternalStore(pickups.subscribe, pickups.getVersion)
  const list = pickups.list

  useFrame(() => {
    const pp = playerRef.position
    const now = performance.now()
    // iterate over a copy: collectPickup mutates the list
    for (const p of [...list]) {
      if ((now - p.spawnedAt) / 1000 > p.ttl) {
        pickups.remove(p.id)
        continue
      }
      const dx = p.pos[0] - pp.x
      const dz = p.pos[2] - pp.z
      if (dx * dx + dz * dz < COLLECT_R2 && Math.abs(p.pos[1] - pp.y) < 2.5) {
        if (collectPickup(p)) {
          try {
            audio.pickup()
          } catch {}
        }
      }
    }
  })

  return (
    <group>
      {list.map((p) => (
        <DropMesh key={p.id} p={p} />
      ))}
    </group>
  )
}
