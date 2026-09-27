// Weather — per-mission ambient weather. Reads mission from useGame.
// desert: drifting dust motes (THREE.Points) in a 60m box around the camera.
// arctic/urban: stubs for the Phase B agent — render nothing for now.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'

const MOTES = 250
const BOX = 60 // 60m box around camera (wraps at ±30)
const HALF = BOX / 2
const WIND_X = 2.4
const WIND_Z = 1.0
const MAX_H = 14

function DesertDust() {
  const pointsRef = useRef()

  const data = useMemo(() => {
    // offsets are relative to the camera; wrapped into [-HALF, HALF] each frame
    const offsets = new Float32Array(MOTES * 3)
    for (let i = 0; i < MOTES; i++) {
      offsets[i * 3] = (Math.random() - 0.5) * BOX
      offsets[i * 3 + 1] = Math.random() * MAX_H
      offsets[i * 3 + 2] = (Math.random() - 0.5) * BOX
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3))
    return { offsets, geo }
  }, [])

  useFrame((state, rawDt) => {
    const dt = rawDt > 0.05 ? 0.05 : rawDt
    const cam = state.camera.position
    const off = data.offsets
    const pos = data.geo.attributes.position.array
    const t = state.clock.elapsedTime
    for (let i = 0; i < MOTES; i++) {
      const i3 = i * 3
      let x = off[i3] + (WIND_X + Math.sin(t * 0.7 + i) * 0.6) * dt
      let z = off[i3 + 2] + (WIND_Z + Math.cos(t * 0.5 + i * 1.7) * 0.6) * dt
      let y = off[i3 + 1] + Math.sin(t * 0.9 + i * 2.3) * 0.35 * dt
      // wrap
      if (x > HALF) x -= BOX; else if (x < -HALF) x += BOX
      if (z > HALF) z -= BOX; else if (z < -HALF) z += BOX
      if (y > MAX_H) y -= MAX_H; else if (y < 0) y += MAX_H
      off[i3] = x
      off[i3 + 1] = y
      off[i3 + 2] = z
      pos[i3] = cam.x + x
      pos[i3 + 1] = y // height is world-absolute; camera flies near ground anyway
      pos[i3 + 2] = cam.z + z
    }
    data.geo.attributes.position.needsUpdate = true
  })

  return (
    <points ref={pointsRef} geometry={data.geo} frustumCulled={false}>
      <pointsMaterial
        color="#d8b98a"
        size={0.09}
        sizeAttenuation
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

// Phase B: arctic (snowfall) and urban (rain/ash) plug in here.
export default function Weather() {
  const mission = useGame((s) => s.mission)
  switch (mission) {
    case 'desert':
      return <DesertDust />
    case 'arctic':
      return null
    case 'urban':
      return null
    default:
      return null
  }
}
