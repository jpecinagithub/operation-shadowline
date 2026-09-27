// Resupply crates: fixed per-mission positions (MISSIONS[x].ammoCrates).
// Press F nearby to refill all carried weapons' reserve + grenades.
// 8s per-crate cooldown. Solid (blocks movement via fixed rigid body).
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RigidBody } from '@react-three/rapier'
import { useGame } from '../systems/GameState.js'
import { MISSIONS } from '../missions/missionData.js'
import { interactables } from '../systems/interactables.js'
import { setLastPickupLabel } from '../systems/pickups.js'
import { audio } from '../systems/AudioManager.js'

const COOLDOWN_MS = 8000

let ammoTex = null
function getAmmoTexture() {
  if (ammoTex) return ammoTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const x = c.getContext('2d')
  x.fillStyle = '#4a5230'
  x.fillRect(0, 0, 256, 256)
  x.strokeStyle = '#2c3319'
  x.lineWidth = 14
  x.strokeRect(10, 10, 236, 236)
  x.fillStyle = '#d8c26a'
  x.font = 'bold 56px Arial'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText('AMMO', 128, 112)
  x.font = 'bold 30px Arial'
  x.fillText('5.56', 128, 168)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  ammoTex = t
  return t
}

function Crate({ pos }) {
  const tex = useMemo(() => getAmmoTexture(), [])
  const cool = useRef(0)

  useEffect(() => {
    const id = interactables.register({
      position: [pos[0], pos[1] + 1, pos[2]],
      radius: 3.2,
      prompt: 'Resupply ammo',
      onInteract: () => {
        const now = performance.now()
        if (now - cool.current < COOLDOWN_MS) return
        cool.current = now
        const g = useGame.getState()
        g.resupplyAll()
        setLastPickupLabel('RESUPPLIED')
        g.emit('pickup')
        try {
          audio.resupply()
        } catch {}
      },
    })
    return () => interactables.unregister(id)
  }, [pos])

  return (
    <RigidBody type="fixed" colliders="cuboid" position={[pos[0], pos[1] + 0.55, pos[2]]}>
      <mesh>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
    </RigidBody>
  )
}

export default function AmmoCrates() {
  const mission = useGame((s) => s.mission)
  const crates = (MISSIONS[mission] && MISSIONS[mission].ammoCrates) || []
  return (
    <group>
      {crates.map((c, i) => (
        <Crate key={`${mission}-${i}`} pos={c} />
      ))}
    </group>
  )
}
