// OPERATION SHADOWLINE — Arctic Outpost map. 100% original procedural content.
// Night raid on a secret arctic base (~130m, z +68 south spawn .. -62 data center).
// All geometry procedural, flat Lambert materials, no external assets.
// South -> north: snowfield, outer fence (z=40, breached at |x|<3), gate corridor,
// inner wall + main gate (z=25, gap |x|<2.5), yard with sweeping searchlight,
// hangar 1 (ENTERABLE, z~5), hangar 2 (z~-15), fuel depot east (z~-8),
// data center north (z~-45, enterable, server terminal), extraction pads back
// at the south spawn (shown during the final objective).
// NOTE: MissionManager.jsx imports { arcticMapRefs } from this file, and this file
// imports { missionEvents, spawnApi } from MissionManager.jsx. The cycle is safe:
// neither module touches the other's bindings during top-level evaluation
// (only inside components/effects).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { damageables } from '../systems/damageables.js'
import { interactables } from '../systems/interactables.js'
import { useGame } from '../systems/GameState.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'
import { playerRef } from '../player/playerRef.js'
import { missionEvents, spawnApi } from '../missions/MissionManager.jsx'

// Shared with MissionManager: damageable/interactable ids + shared coordinates.
export const arcticMapRefs = {
  depotId: null, // damageable fuel tank (hp 60); mission logic detonates via damageables.damage(id, 999)
  terminalId: null, // 'Download intel [F]' interactable
  terminalPos: [2.5, 1.2, -49.5], // server terminal desk inside the data center
  terminalInteractPos: [2.5, 1.0, -48.2],
  depotPos: [26, 2.0, -6], // damageable tank center
  // CINEMATIC #2 trigger zone: while objectiveIndex === 6 (alarm), when the player
  // enters this rect the mission logic calls damageables.damage(depotId, 999).
  depotTriggerZone: { x0: -16, x1: 16, z0: -5, z1: 12 },
  extractionPads: [[-2.5, 56], [2.5, 56]],
  alarmFired: false,
}

// ---------------- cached geometry / materials (module level) ----------------
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  beam: new THREE.CylinderGeometry(0.3, 2.6, 1, 12, 1, true),
  plane: new THREE.PlaneGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
}
const lam = (color, emissive = 0x000000, ei = 1) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: ei })
const MATS = {
  snow: lam(0xd7e2f2),
  snowDark: lam(0xb4c2dc),
  snowDrift: lam(0xe9f0fc),
  ice: lam(0xa9c2e4),
  rock: lam(0x6b6f78),
  trunk: lam(0x4a3a28),
  pine: lam(0x33503f),
  wood: lam(0x6e5638),
  woodDark: lam(0x4a3826),
  concrete: lam(0x8d939c),
  concreteDark: lam(0x5f646b),
  metal: lam(0x707880),
  metalDark: lam(0x4a5058),
  darkMetal: lam(0x33363b),
  rust: lam(0x8a3b22),
  olive: lam(0x4a5238),
  oliveDark: lam(0x3a422c),
  canvas: lam(0x8a8a72),
  tire: lam(0x1e1e1e),
  sandbag: lam(0x9a8f7a),
  crate: lam(0x7a6238),
  crateDark: lam(0x5d4a2a),
  tankWhite: lam(0xb9c0c9),
  charred: lam(0x1a1512),
  glassDark: lam(0x10161f),
  windowGlow: lam(0xd8c9a8, 0xffc37a, 1.2),
  stripLight: lam(0xf0f4ff, 0xd8e8ff, 1.6),
  screenBlue: lam(0x0a1a2a, 0x2a9adf, 1.3),
  glowGreen: lam(0x39ff6a, 0x39ff6a, 1.6),
  beaconRed: lam(0x550000, 0xff2222, 3),
  beam: new THREE.MeshLambertMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0.1,
    emissive: 0x9fc8ff, emissiveIntensity: 0.5,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  fenceMesh: new THREE.MeshLambertMaterial({
    color: 0x8a99ad, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
  }),
}

// ---------------- tiny helpers ----------------
// P: plain visual mesh (no collider), scaled unit geometry.
function P({ p, s, m, ry = 0, rx = 0, rz = 0, cast = true, recv = true, geo = GEO.box }) {
  return (
    <mesh geometry={geo} material={m} position={p} scale={s} rotation={[rx, ry, rz]}
      castShadow={cast} receiveShadow={recv} />
  )
}
// Solid: fixed rigid body + matching cuboid collider + box mesh. Collider matches visuals.
function Solid({ p, s, m, ry = 0, cast = true }) {
  return (
    <RigidBody type="fixed" colliders={false} position={p} rotation={[0, ry, 0]}>
      <CuboidCollider args={[s[0] / 2, s[1] / 2, s[2] / 2]} />
      <mesh geometry={GEO.box} material={m} scale={s} castShadow={cast} receiveShadow />
    </RigidBody>
  )
}
// SolidCyl: same idea for cylinders (barrels, tanks).
function SolidCyl({ p, r, h, m }) {
  return (
    <RigidBody type="fixed" colliders={false} position={p}>
      <CylinderCollider args={[h / 2, r]} />
      <mesh geometry={GEO.cyl} material={m} scale={[r * 2, h, r * 2]} castShadow receiveShadow />
    </RigidBody>
  )
}
// AimSpot: spotlight with a scene-attached target (no shadows — cheap).
function AimSpot({ from, tx, tz, ...props }) {
  const light = useRef()
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const t = new THREE.Object3D()
    t.position.set(tx, 0, tz)
    scene.add(t)
    if (light.current) light.current.target = t
    return () => { scene.remove(t) }
  }, [scene, tx, tz])
  return <spotLight ref={light} position={from} {...props} />
}

// ---------------- ground ----------------
const SNOW_PATCHES = [
  { p: [-30, 0.012, 50], s: [28, 22], m: 'snowDark' },
  { p: [32, 0.012, 30], s: [26, 26], m: 'snowDark' },
  { p: [-28, 0.012, 0], s: [24, 24], m: 'snowDark' },
  { p: [28, 0.012, -20], s: [26, 22], m: 'snowDark' },
  { p: [-20, 0.012, -42], s: [30, 20], m: 'snowDark' },
  { p: [10, 0.016, 18], s: [20, 18], m: 'snowDrift' },
  { p: [-12, 0.016, -28], s: [18, 16], m: 'snowDrift' },
]
function Ground() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[0, -0.5, 3]}>
        <CuboidCollider args={[70, 0.5, 95]} />
      </RigidBody>
      <mesh geometry={GEO.plane} material={MATS.snow} rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 3]} scale={[140, 190, 1]} receiveShadow />
      {SNOW_PATCHES.map((pt, i) => (
        <mesh key={i} geometry={GEO.plane} material={MATS[pt.m]} rotation={[-Math.PI / 2, 0, 0]}
          position={pt.p} scale={[pt.s[0], pt.s[1], 1]} receiveShadow />
      ))}
      {/* ice road: gate -> yard -> data center */}
      <mesh geometry={GEO.plane} material={MATS.ice} rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.015, 5]} scale={[7, 112, 1]} receiveShadow />
    </group>
  )
}

// Invisible walls keeping the player inside the play area.
function Bounds() {
  const walls = [
    { p: [0, 3, 68], s: [116, 6, 2] },
    { p: [0, 3, -62], s: [116, 6, 2] },
    { p: [-57, 3, 3], s: [2, 6, 134] },
    { p: [57, 3, 3], s: [2, 6, 134] },
  ]
  return (
    <group>
      {walls.map((w, i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={w.p}>
          <CuboidCollider args={[w.s[0] / 2, w.s[1] / 2, w.s[2] / 2]} />
        </RigidBody>
      ))}
    </group>
  )
}

// ---------------- outer fence (z=40, breached at |x|<3) ----------------
const FENCE_Z = 40
const FENCE_POSTS = []
for (let x = -55; x <= 55; x += 5) {
  if (Math.abs(x) < 4) continue // breach gap
  FENCE_POSTS.push(x)
}
function FenceSegment({ x0, x1 }) {
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  return (
    <RigidBody type="fixed" colliders={false} position={[cx, 0, FENCE_Z]}>
      <CuboidCollider args={[len / 2, 1.1, 0.15]} position={[0, 1.1, 0]} />
      <mesh geometry={GEO.plane} material={MATS.fenceMesh} scale={[len, 1.7, 1]} position={[0, 1.15, 0]} />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[len, 0.08, 0.08]} position={[0, 1.95, 0]} />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[len, 0.08, 0.08]} position={[0, 0.35, 0]} />
    </RigidBody>
  )
}
function PerimeterFence() {
  return (
    <group>
      <FenceSegment x0={-56.5} x1={-3} />
      <FenceSegment x0={3} x1={56.5} />
      {FENCE_POSTS.map((x) => (
        <P key={x} p={[x, 1.05, FENCE_Z]} s={[0.18, 2.1, 0.18]} m={MATS.woodDark} cast={false} />
      ))}
      {/* breached section: tilted posts + fallen mesh */}
      <P p={[-3.4, 0.9, FENCE_Z]} s={[0.18, 2.1, 0.18]} m={MATS.woodDark} rz={0.5} cast={false} />
      <P p={[3.4, 0.9, FENCE_Z]} s={[0.18, 2.1, 0.18]} m={MATS.woodDark} rz={-0.55} cast={false} />
      <mesh geometry={GEO.plane} material={MATS.fenceMesh} scale={[6.5, 1.7, 1]}
        position={[0, 0.25, FENCE_Z + 1.2]} rotation={[-Math.PI / 2 + 0.25, 0, 0.15]} />
      <P p={[-6, 1.2, FENCE_Z - 0.3]} s={[0.9, 0.6, 0.06]} m={MATS.rust} cast={false} />
    </group>
  )
}

// ---------------- inner wall + main gate (z=25, gap |x|<2.5) ----------------
const GATE_Z = 25
function InnerWall() {
  return (
    <group>
      <Solid p={[-29.5, 1.5, GATE_Z]} s={[54, 3, 0.6]} m={MATS.concrete} />
      <Solid p={[29.5, 1.5, GATE_Z]} s={[54, 3, 0.6]} m={MATS.concrete} />
      <P p={[-29.5, 3.15, GATE_Z]} s={[54.4, 0.3, 0.9]} m={MATS.concreteDark} cast={false} />
      <P p={[29.5, 3.15, GATE_Z]} s={[54.4, 0.3, 0.9]} m={MATS.concreteDark} cast={false} />
      {/* gate posts + swung-open gate doors */}
      <Solid p={[-2.9, 2, GATE_Z]} s={[0.8, 4, 0.8]} m={MATS.concreteDark} />
      <Solid p={[2.9, 2, GATE_Z]} s={[0.8, 4, 0.8]} m={MATS.concreteDark} />
      <P p={[-4.6, 1.4, GATE_Z + 1.6]} s={[3.4, 2.8, 0.15]} m={MATS.darkMetal} ry={0.7} />
      <P p={[4.6, 1.4, GATE_Z + 1.6]} s={[3.4, 2.8, 0.15]} m={MATS.darkMetal} ry={-0.7} />
      {/* gatehouse built into the wall */}
      <Solid p={[-8, 1.75, GATE_Z]} s={[8, 3.5, 6]} m={MATS.concrete} />
      <P p={[-8, 3.7, GATE_Z]} s={[8.6, 0.4, 6.6]} m={MATS.concreteDark} />
      <mesh geometry={GEO.plane} material={MATS.windowGlow} scale={[2.2, 1]} position={[-8, 2.1, GATE_Z + 3.02]} />
      <P p={[-8, 1.3, GATE_Z - 3.02]} s={[1.1, 2.4, 0.1]} m={MATS.woodDark} cast={false} />
    </group>
  )
}

// ---------------- watchtowers (decorative; 2 hold snipers) ----------------
function WatchTower({ x, z }) {
  const legs = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CuboidCollider args={[1.7, 3.2, 1.7]} position={[0, 3.2, 0]} />
      {legs.map(([lx, lz], i) => (
        <mesh key={i} geometry={GEO.box} material={MATS.woodDark} scale={[0.28, 6.4, 0.28]}
          position={[lx, 3.2, lz]} castShadow />
      ))}
      <mesh geometry={GEO.box} material={MATS.wood} scale={[3.4, 0.3, 3.4]}
        position={[0, 6.3, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={MATS.woodDark} scale={[3.4, 0.12, 0.12]} position={[0, 7.1, 1.64]} />
      <mesh geometry={GEO.box} material={MATS.woodDark} scale={[3.4, 0.12, 0.12]} position={[0, 7.1, -1.64]} />
      <mesh geometry={GEO.box} material={MATS.woodDark} scale={[0.12, 0.12, 3.4]} position={[1.64, 7.1, 0]} />
      <mesh geometry={GEO.box} material={MATS.woodDark} scale={[0.12, 0.12, 3.4]} position={[-1.64, 7.1, 0]} />
      {[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([lx, lz], i) => (
        <mesh key={`r${i}`} geometry={GEO.box} material={MATS.woodDark} scale={[0.16, 1.6, 0.16]}
          position={[lx, 7.2, lz]} castShadow />
      ))}
      <mesh geometry={GEO.box} material={MATS.canvas} scale={[3.8, 0.15, 3.8]} position={[0, 8.1, 0]} castShadow />
      <mesh geometry={GEO.box} material={MATS.woodDark} scale={[0.7, 6.2, 0.1]} position={[0, 3.1, 1.75]} />
    </RigidBody>
  )
}

// ---------------- hangar 1 (ENTERABLE, x in [-22,-2], z in [-3,13]) ----------------
// Interior walkable zone: x in [-21.7,-2.3], z in [-2.7,12.7].
// Door on the east wall (x=-2), z in [2,8].
function Hangar1() {
  return (
    <group>
      <Solid p={[-22, 3.5, 5]} s={[0.6, 7, 16]} m={MATS.metal} />
      <Solid p={[-12, 3.5, -3]} s={[20.6, 7, 0.6]} m={MATS.metal} />
      <Solid p={[-12, 3.5, 13]} s={[20.6, 7, 0.6]} m={MATS.metal} />
      <Solid p={[-2, 3.5, -0.5]} s={[0.6, 7, 5]} m={MATS.metal} />
      <Solid p={[-2, 3.5, 10.5]} s={[0.6, 7, 5]} m={MATS.metal} />
      <Solid p={[-2, 6, 5]} s={[0.6, 2, 6]} m={MATS.metal} />
      <Solid p={[-12, 7.25, 5]} s={[20.6, 0.5, 16.6]} m={MATS.metalDark} />
      <P p={[-2, 5.2, 2]} s={[0.8, 0.4, 0.4]} m={MATS.rust} cast={false} />
      <P p={[-2, 5.2, 8]} s={[0.8, 0.4, 0.4]} m={MATS.rust} cast={false} />
      {/* interior props */}
      <Solid p={[-20, 0.5, 11]} s={[1, 1, 1]} m={MATS.crate} />
      <Solid p={[-18.8, 0.5, 11]} s={[1, 1, 1]} m={MATS.crateDark} />
      <Solid p={[-19.4, 1.5, 11]} s={[1, 1, 1]} m={MATS.crate} />
      <Solid p={[-6, 0.5, -1.5]} s={[1, 1, 1]} m={MATS.crate} />
      <Solid p={[-16, 0.45, -2]} s={[3, 0.9, 1.2]} m={MATS.wood} />
      <SolidCyl p={[-18, 0.45, 2]} r={0.35} h={0.9} m={MATS.rust} />
      <SolidCyl p={[-17, 0.45, 2.6]} r={0.35} h={0.9} m={MATS.metal} />
      {/* interior light strip */}
      <pointLight color="#ffe2b8" intensity={10} distance={24} decay={1.8} position={[-12, 5.8, 5]} />
      <P p={[-12, 6.6, 5]} s={[2.2, 0.15, 0.4]} m={MATS.stripLight} cast={false} />
    </group>
  )
}

// ---------------- hangar 2 (decorative, x in [6,22], z in [-21,-9]) ----------------
function Hangar2() {
  return (
    <group>
      <Solid p={[14, 3, -21]} s={[16.6, 6, 0.6]} m={MATS.metalDark} />
      <Solid p={[14, 3, -9]} s={[16.6, 6, 0.6]} m={MATS.metalDark} />
      <Solid p={[22, 3, -15]} s={[0.6, 6, 12.6]} m={MATS.metalDark} />
      <Solid p={[6, 3, -15]} s={[0.6, 6, 12.6]} m={MATS.metalDark} />
      <Solid p={[14, 6.25, -15]} s={[16.6, 0.5, 12.6]} m={MATS.metal} />
      <P p={[5.65, 2.5, -17.5]} s={[0.15, 5, 4.8]} m={MATS.rust} cast={false} />
      <P p={[5.65, 2.5, -12.5]} s={[0.15, 5, 4.8]} m={MATS.metal} cast={false} />
      <Solid p={[3, 0.5, -8]} s={[1, 1, 1]} m={MATS.crate} />
      <Solid p={[3, 0.5, -6.8]} s={[1, 1, 1]} m={MATS.crateDark} />
      <Solid p={[24, 0.5, -12]} s={[1, 1, 1]} m={MATS.crate} />
    </group>
  )
}

// ---------------- fuel depot (east, z~-8) ----------------
const DEPOT = { x: 26, y: 2, z: -6 } // damageable tank center
// CINEMATIC #2 target: mission logic detonates it via
// damageables.damage(arcticMapRefs.depotId, 999) when the player crosses the
// depotTriggerZone during objective 6. onDeath does the big explosion + shake
// and leaves a burning wreck that keeps puffing smoke.
function FuelTankCine() {
  const [burnt, setBurnt] = useState(false)
  const smokeT = useRef(0)
  useEffect(() => {
    const id = damageables.register({
      position: [DEPOT.x, DEPOT.y, DEPOT.z], radius: 2.8, hp: 60,
      onDeath: () => {
        fx.explosion(new THREE.Vector3(DEPOT.x, DEPOT.y + 0.5, DEPOT.z), 3.5)
        fx.smoke(new THREE.Vector3(DEPOT.x, DEPOT.y + 2, DEPOT.z), 2.5, 12)
        audio.explosion(1.5)
        playerRef.shake = 1
        setBurnt(true)
        missionEvents.emit('depotDestroyed')
      },
    })
    arcticMapRefs.depotId = id
    return () => {
      damageables.unregister(id)
      if (arcticMapRefs.depotId === id) arcticMapRefs.depotId = null
    }
  }, [])
  useFrame((_, dt) => {
    if (!burnt) return
    smokeT.current += dt
    if (smokeT.current > 0.5) {
      smokeT.current = 0
      fx.smoke(
        new THREE.Vector3(
          DEPOT.x + (Math.random() - 0.5) * 2.5, DEPOT.y + 1.5,
          DEPOT.z + (Math.random() - 0.5) * 2.5
        ), 1.3, 4
      )
    }
  })
  const m = burnt ? MATS.charred : MATS.tankWhite
  return (
    <RigidBody type="fixed" colliders={false} position={[DEPOT.x, 0, DEPOT.z]}>
      <CylinderCollider args={[2, 2]} position={[0, 2, 0]} />
      <mesh geometry={GEO.cyl} material={m} scale={[4, 4, 4]} position={[0, 2, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.sphere} material={m} scale={[2, 1, 2]} position={[0, 4, 0]} castShadow />
      <mesh geometry={GEO.box} material={burnt ? MATS.charred : MATS.rust}
        scale={[0.5, 1.2, 0.5]} position={[2.2, 0.6, 0]} castShadow />
    </RigidBody>
  )
}
function FuelTankStatic({ x, z, r, h, m }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CylinderCollider args={[h / 2, r]} position={[0, h / 2, 0]} />
      <mesh geometry={GEO.cyl} material={m} scale={[r * 2, h, r * 2]} position={[0, h / 2, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.sphere} material={m} scale={[r, r * 0.5, r]} position={[0, h, 0]} castShadow />
    </RigidBody>
  )
}
function FuelDepot() {
  return (
    <group>
      <FuelTankCine />
      <FuelTankStatic x={30.5} z={-10} r={1.75} h={3.5} m={MATS.tankWhite} />
      <FuelTankStatic x={26.5} z={-14.5} r={1.5} h={3} m={MATS.rust} />
      {/* connecting pipes */}
      <P p={[28.2, 0.5, -8]} s={[0.25, 0.25, 4.5]} m={MATS.darkMetal} cast={false} />
      <P p={[28.5, 0.5, -12.2]} s={[4.2, 0.25, 0.25]} m={MATS.darkMetal} cast={false} />
      {/* pump shed */}
      <Solid p={[32.5, 1, -6]} s={[2.4, 2, 2.4]} m={MATS.metalDark} />
      <P p={[32.5, 2.15, -6]} s={[2.8, 0.3, 2.8]} m={MATS.metal} cast={false} />
      <SolidCyl p={[23.5, 0.45, -9]} r={0.35} h={0.9} m={MATS.rust} />
      <SolidCyl p={[24.5, 0.45, -9.4]} r={0.35} h={0.9} m={MATS.metal} />
    </group>
  )
}

// ---------------- data center (north, x in [-6,6], z in [-51,-39]) ----------------
// Door on the south wall (z=-39), x in [-1.5,1.5].
// Server terminal desk at [2.5, 1.2, -49.5]; interact at [2.5, 1.0, -48.2].
function Terminal() {
  const bulbMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x001a00, emissive: 0x2aff5a, emissiveIntensity: 1.4 }),
    []
  )
  useEffect(() => {
    const id = interactables.register({
      position: [2.5, 1.0, -48.2],
      radius: 2.6,
      prompt: 'Download intel [F]',
      // Only downloadable during the 'download' objective — interacting early would soft-lock the flow.
      onInteract: () => {
        if (useGame.getState().objectiveIndex === 5) missionEvents.emit('downloadStart')
      },
    })
    arcticMapRefs.terminalId = id
    return () => {
      interactables.unregister(id)
      if (arcticMapRefs.terminalId === id) arcticMapRefs.terminalId = null
    }
  }, [])
  useFrame(({ clock }) => {
    bulbMat.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 5) * 0.6
  })
  return (
    <mesh geometry={GEO.sphere} material={bulbMat} scale={[0.12, 0.12, 0.12]} position={[2.5, 2.15, -49.5]} />
  )
}
function DataCenter() {
  return (
    <group>
      <Solid p={[0, 2, -51]} s={[12.6, 4, 0.6]} m={MATS.concrete} />
      <Solid p={[-3.75, 2, -39]} s={[4.5, 4, 0.6]} m={MATS.concrete} />
      <Solid p={[3.75, 2, -39]} s={[4.5, 4, 0.6]} m={MATS.concrete} />
      <Solid p={[0, 3.5, -39]} s={[3.6, 1, 0.6]} m={MATS.concreteDark} />
      <Solid p={[-6, 2, -45]} s={[0.6, 4, 12.6]} m={MATS.concrete} />
      <Solid p={[6, 2, -45]} s={[0.6, 4, 12.6]} m={MATS.concrete} />
      <Solid p={[0, 4.25, -45]} s={[13, 0.5, 13]} m={MATS.concreteDark} />
      {/* server racks along the west wall */}
      {[-48.5, -45.5, -42.5].map((z) => (
        <group key={z}>
          <Solid p={[-5, 1.1, z]} s={[1.4, 2.2, 2]} m={MATS.darkMetal} />
          <P p={[-4.28, 1.5, z]} s={[0.06, 1.2, 1.6]} m={MATS.screenBlue} ry={Math.PI / 2} cast={false} />
        </group>
      ))}
      {/* terminal desk against the north wall */}
      <Solid p={[2.5, 0.5, -49.5]} s={[2.6, 1, 0.9]} m={MATS.metal} />
      <P p={[2.5, 1.45, -49.75]} s={[1.8, 1, 0.08]} m={MATS.darkMetal} />
      <mesh geometry={GEO.plane} material={MATS.screenBlue} scale={[1.6, 0.8]} position={[2.5, 1.45, -49.7]} />
      <P p={[2.5, 0.75, -49]} s={[1.2, 0.06, 0.4]} m={MATS.darkMetal} cast={false} />
      <pointLight color="#bfe0ff" intensity={6} distance={20} decay={1.8} position={[0, 3.2, -45]} />
      <Terminal />
    </group>
  )
}

// ---------------- vehicles (static) ----------------
function Truck({ x, z, ry = 0 }) {
  const wheels = []
  for (const wx of [1.05, -1.05]) for (const wz of [1.9, 0.2, -1.7]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[1.3, 1.35, 3.1]} position={[0, 1.35, 0]} />
      <mesh geometry={GEO.box} material={MATS.olive} scale={[2.4, 1.5, 1.7]} position={[0, 1.35, 2.1]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={MATS.glassDark} scale={[2.0, 0.6, 0.1]} position={[0, 1.7, 2.98]} />
      <mesh geometry={GEO.box} material={MATS.oliveDark} scale={[2.5, 1.1, 3.6]} position={[0, 1.15, -0.9]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={MATS.canvas} scale={[2.5, 0.9, 3.6]} position={[0, 2.1, -0.9]} castShadow />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[1.0, 0.35, 1.0]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.5, wz]} castShadow />
      ))}
    </RigidBody>
  )
}
function Jeep({ x, z, ry = 0 }) {
  const wheels = []
  for (const wx of [0.85, -0.85]) for (const wz of [1.2, -1.2]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[1.0, 0.85, 2.0]} position={[0, 0.85, 0]} />
      <mesh geometry={GEO.box} material={MATS.olive} scale={[1.9, 0.7, 3.6]} position={[0, 0.75, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={MATS.olive} scale={[1.7, 0.6, 1.4]} position={[0, 1.35, -0.3]} castShadow />
      <mesh geometry={GEO.box} material={MATS.glassDark} scale={[1.5, 0.45, 0.08]} position={[0, 1.3, 0.45]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[0.72, 0.3, 0.72]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.36, wz]} castShadow />
      ))}
    </RigidBody>
  )
}

// ---------------- sandbags ----------------
function SandbagRow({ x, z, ry = 0, len = 5.2 }) {
  const n = Math.floor(len / 1.2)
  const bags = []
  for (let l = 0; l < 2; l++)
    for (let i = 0; i < n; i++)
      bags.push([(i - (n - 1) / 2) * 1.2 + (l ? 0.6 : 0), 0.25 + l * 0.48, 0])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[len / 2, 0.65, 0.4]} position={[0, 0.6, 0]} />
      {bags.map(([bx, by, bz], i) => (
        <mesh key={i} geometry={GEO.box} material={MATS.sandbag} scale={[1.15, 0.5, 0.7]}
          position={[bx, by, bz]} castShadow receiveShadow />
      ))}
    </RigidBody>
  )
}

// ---------------- antennas ----------------
function Antenna({ x, z }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CuboidCollider args={[0.3, 8, 0.3]} position={[0, 8, 0]} />
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.3, 16, 0.3]} position={[0, 8, 0]} castShadow />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[2.4, 0.12, 0.12]} position={[0, 11, 0]} />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[1.8, 0.12, 0.12]} position={[0, 13.5, 0]} />
      <mesh geometry={GEO.box} material={MATS.concrete} scale={[1.4, 0.8, 1.4]} position={[0, 0.4, 0]} castShadow />
    </RigidBody>
  )
}
function TipBlinkers() {
  const mat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x220000, emissive: 0xff3333, emissiveIntensity: 1 }),
    []
  )
  useFrame(({ clock }) => {
    mat.emissiveIntensity = 0.3 + (Math.sin(clock.elapsedTime * 2.2) * 0.5 + 0.5) * 2.2
  })
  return (
    <group>
      {[[18, 16.2, 24], [-18, 16.2, -30], [8, 16.2, -40]].map(([x, y, z], i) => (
        <mesh key={i} geometry={GEO.sphere} material={mat} scale={[0.18, 0.18, 0.18]} position={[x, y, z]} />
      ))}
    </group>
  )
}

// ---------------- snowfield props ----------------
const PINES = [
  [-14, 62, 1.1], [-24, 58, 0.9], [16, 63, 1.2], [28, 60, 1], [-38, 62, 1.3], [40, 64, 0.9],
  [-48, 52, 1], [48, 54, 1.1], [-52, 44, 0.9], [52, 40, 1],
  [-46, 30, 1.1], [46, 28, 0.9], [-50, 14, 1], [50, 10, 1.2],
  [-44, -6, 0.9], [44, -30, 1], [-40, -44, 1.1], [36, -48, 1],
  [-24, -54, 0.9], [20, -56, 1.1], [-8, 64, 1], [8, 66, 0.9],
]
const ROCKS = [
  [-20, 55, 1.6], [22, 57, 2], [-34, 48, 1.2], [36, 46, 1.5],
  [-42, 22, 1.8], [42, 18, 1.3], [-38, -12, 1.4], [40, -38, 1.7],
  [-30, -50, 1.2], [30, -52, 1.5], [14, 62, 1.1], [-12, -58, 1.3],
]
const DRIFTS = [
  [-10, 52, 6, 2.4], [10, 54, 7, 2.8], [-26, 44, 5, 2], [26, 42, 6, 2.2],
  [0, 44, 8, 2], [-16, 34, 5, 1.8], [16, 32, 6, 2],
  [-34, 8, 7, 2.4], [34, -6, 6, 2], [-24, -20, 5, 1.8], [12, -34, 6, 2],
  [-14, -48, 5, 1.6],
]
const CRATES = [
  [-7, 0.5, 33, 1], [-5.8, 0.5, 33, 1],
  [7, 0.5, 32, 1], [8.2, 0.5, 32, 1],
  [-8, 0.5, 15, 1], [-8, 0.5, 13.8, 1], [-8, 1.5, 14.4, 1],
  [8, 0.5, 11, 1], [9.2, 0.5, 11, 1],
  [0, 0.5, 5, 1], [-1.2, 0.5, 5, 1],
  [24, 0.5, -2, 1], [25.2, 0.5, -2, 1],
  [29, 0.5, -13, 1],
  [-4, 0.5, -36, 1], [-2.8, 0.5, -36, 1],
  [5, 0.5, -44, 1],
  [-26, 0.5, 1.5, 1],
  [26, 0.5, -18.5, 1],
]
const BARRELS = [
  [-9, 31], [9, 30], [-5, 27.5], [5, 27.8],
  [-12, 18], [12, 14], [22, -6], [30, -8],
  [-8, -34], [8, -40], [28, -12],
]
function Props() {
  return (
    <group>
      {PINES.map(([x, z, s], i) => (
        <RigidBody key={`p${i}`} type="fixed" colliders={false} position={[x, 0, z]}>
          <CylinderCollider args={[1.5 * s, 0.22 * s]} position={[0, 1.5 * s, 0]} />
          <mesh geometry={GEO.cyl} material={MATS.trunk} scale={[0.3 * s, 1.2 * s, 0.3 * s]}
            position={[0, 0.6 * s, 0]} castShadow />
          <mesh geometry={GEO.cone} material={MATS.pine} scale={[1.6 * s, 3.2 * s, 1.6 * s]}
            position={[0, 2.6 * s, 0]} castShadow />
          <mesh geometry={GEO.cone} material={MATS.snow} scale={[1.0 * s, 1.2 * s, 1.0 * s]}
            position={[0, 3.7 * s, 0]} castShadow />
        </RigidBody>
      ))}
      {ROCKS.map(([x, z, s], i) => (
        <RigidBody key={`r${i}`} type="fixed" colliders={false} position={[x, 0, z]}>
          <CuboidCollider args={[s * 0.8, s * 0.5, s * 0.8]} position={[0, s * 0.4, 0]} />
          <mesh geometry={GEO.sphere} material={MATS.rock} scale={[s, s * 0.7, s]}
            position={[0, s * 0.35, 0]} castShadow receiveShadow />
        </RigidBody>
      ))}
      {DRIFTS.map(([x, z, w, d], i) => (
        <mesh key={`d${i}`} geometry={GEO.sphere} material={MATS.snowDrift}
          scale={[w, 1.0, d]} position={[x, 0, z]} receiveShadow />
      ))}
      {CRATES.map(([x, y, z, s], i) => (
        <Solid key={`c${i}`} p={[x, y, z]} s={[s, s, s]} m={i % 2 ? MATS.crateDark : MATS.crate} />
      ))}
      {BARRELS.map(([x, z], i) => (
        <SolidCyl key={`b${i}`} p={[x, 0.45, z]} r={0.35} h={0.9}
          m={i % 2 ? MATS.metal : MATS.rust} />
      ))}
      <SandbagRow x={-4} z={26.5} ry={0.2} />
      <SandbagRow x={4} z={26.5} ry={-0.15} />
      <SandbagRow x={24} z={-4} ry={0.4} len={4} />
    </group>
  )
}

// ---------------- lighting / alarm ----------------
// Searchlight: sweeping beam in the central yard. Decorative, pre-alarm only.
const _up = new THREE.Vector3(0, 1, 0)
const _s1 = new THREE.Vector3()
function TrackingSpot({ from, tgt, ...props }) {
  const light = useRef()
  useEffect(() => {
    if (light.current) light.current.target = tgt
  }, [tgt])
  return <spotLight ref={light} position={from} {...props} />
}
function Searchlight({ alarm }) {
  const cone = useRef()
  const tgt = useMemo(() => new THREE.Object3D(), [])
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.add(tgt)
    return () => { scene.remove(tgt) }
  }, [scene, tgt])
  useFrame(({ clock }) => {
    if (alarm) return
    const t = clock.elapsedTime
    const gx = 14 + Math.sin(t * 0.45) * 20
    const gz = 16 + Math.cos(t * 0.31) * 16
    tgt.position.set(gx, 0, gz)
    const c = cone.current
    if (c) {
      _s1.set(14 - gx, 8.2, 16 - gz) // head - ground
      const len = _s1.length()
      c.position.set((14 + gx) / 2, 8.2 / 2, (16 + gz) / 2)
      c.quaternion.setFromUnitVectors(_up, _s1.normalize())
      c.scale.set(1.4, len, 1.4)
    }
  })
  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[14, 0, 16]}>
        <CuboidCollider args={[0.25, 4.1, 0.25]} position={[0, 4.1, 0]} />
        <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.35, 8.2, 0.35]} position={[0, 4.1, 0]} castShadow />
        <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[1.2, 0.5, 1.2]} position={[0, 8.2, 0]} castShadow />
        <mesh geometry={GEO.box} material={MATS.stripLight} scale={[0.5, 0.3, 0.5]} position={[0, 7.9, 0]} />
      </RigidBody>
      <TrackingSpot from={[14, 8.2, 16]} tgt={tgt} angle={0.16} penumbra={0.5}
        intensity={alarm ? 0 : 130} distance={70} color="#cfe4ff" decay={1.2} />
      <mesh ref={cone} geometry={GEO.beam} material={MATS.beam}
        position={[14, 4.1, 24]} scale={[1.4, 18, 1.4]} visible={!alarm} />
    </group>
  )
}
// White floodlight poles — no shadows (cheap). Killed by the alarm.
const FLOODS = [
  { x: -18, z: 8, tx: -8, tz: 6 },
  { x: 18, z: 4, tx: 10, tz: -2 },
  { x: -10, z: -24, tx: -6, tz: -16 },
  { x: 22, z: -20, tx: 25, tz: -10 },
]
function Floodlights({ alarm }) {
  const headMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0xdfe8ff, emissive: 0xcfe0ff, emissiveIntensity: 2.2 }),
    []
  )
  useEffect(() => {
    headMat.emissiveIntensity = alarm ? 0.03 : 2.2
  }, [alarm, headMat])
  return (
    <group>
      {FLOODS.map((f, i) => (
        <group key={i}>
          <RigidBody type="fixed" colliders={false} position={[f.x, 0, f.z]}>
            <CuboidCollider args={[0.2, 3.5, 0.2]} position={[0, 3.5, 0]} />
            <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.22, 7, 0.22]} position={[0, 3.5, 0]} castShadow />
            <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[1.4, 0.15, 0.3]} position={[0, 6.9, 0]} />
            <mesh geometry={GEO.box} material={headMat} scale={[0.5, 0.3, 0.35]} position={[-0.45, 6.7, 0]} />
            <mesh geometry={GEO.box} material={headMat} scale={[0.5, 0.3, 0.35]} position={[0.45, 6.7, 0]} />
          </RigidBody>
          <AimSpot from={[f.x, 6.8, f.z]} tx={f.tx} tz={f.tz}
            angle={0.55} penumbra={0.7} intensity={alarm ? 0 : 55}
            distance={42} color="#d8e8ff" decay={1.7} />
        </group>
      ))}
    </group>
  )
}
// Red emergency lights: dim until 'alarmOn', then full blast.
const REDS = [
  [-1.6, 6.2, 5],   // hangar 1 east wall
  [5.6, 5.7, -15],  // hangar 2 west wall
  [0, 4.6, -38.6],  // data center above the door
  [-8, 4.1, 28.3],  // gatehouse north face
  [22, 5.2, -2],    // depot pole
  [14, 8.7, 16],    // searchlight mast
]
function RedLights({ alarm }) {
  const mat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 0.35 }),
    []
  )
  useEffect(() => {
    mat.emissiveIntensity = alarm ? 3.2 : 0.35
  }, [alarm, mat])
  return (
    <group>
      {REDS.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.3, 0.18, 0.3]} position={[0, 0.12, 0]} />
          <mesh geometry={GEO.sphere} material={mat} scale={[0.16, 0.16, 0.16]} position={[0, -0.05, 0]} />
          <pointLight color="#ff2222" intensity={alarm ? 5 : 0.35} distance={15} decay={2} />
        </group>
      ))}
      {/* depot pole carrying its red lamp */}
      <RigidBody type="fixed" colliders={false} position={[22, 0, -2]}>
        <CuboidCollider args={[0.15, 2.6, 0.15]} position={[0, 2.6, 0]} />
        <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.16, 5.2, 0.16]} position={[0, 2.6, 0]} castShadow />
      </RigidBody>
    </group>
  )
}
// CINEMATIC #1: two rotating red beacons, mounted once the alarm fires.
function Beacon({ x, y, z, dir }) {
  const arm = useRef()
  useFrame((_, dt) => {
    if (arm.current) arm.current.rotation.y += dt * 4.5 * dir
  })
  return (
    <group position={[x, y, z]}>
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.14, 1.1, 0.14]} position={[0, 0.55, 0]} />
      <group ref={arm} position={[0, 1.15, 0]}>
        <mesh geometry={GEO.box} material={MATS.beaconRed} scale={[0.8, 0.16, 0.16]} position={[0.35, 0, 0]} />
        <mesh geometry={GEO.sphere} material={MATS.beaconRed} scale={[0.17, 0.17, 0.17]} position={[0.72, 0, 0]} />
      </group>
      <pointLight color="#ff2222" intensity={6} distance={20} decay={2} position={[0, 1.2, 0]} />
    </group>
  )
}
function Beacons() {
  return (
    <group>
      <Beacon x={-12} y={7.5} z={5} dir={1} />
      <Beacon x={0} y={4.5} z={-45} dir={-1} />
    </group>
  )
}

// Extraction pads near the south spawn — only shown during the final objective.
function ExtractionMarkers() {
  const show = useGame((s) => s.objectiveIndex >= s.objectives.length - 1 && s.objectives.length > 0)
  const pulse = useRef()
  useFrame(({ clock }) => {
    if (pulse.current) {
      const t = clock.getElapsedTime()
      pulse.current.children.forEach((m, i) => {
        m.material.emissiveIntensity = 0.7 + Math.sin(t * 4 + i * Math.PI) * 0.35
      })
    }
  })
  if (!show) return null
  return (
    <group ref={pulse}>
      {arcticMapRefs.extractionPads.map(([x, z], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.glowGreen}
          scale={[0.85, 0.1, 0.85]} position={[x, 0.06, z]} />
      ))}
    </group>
  )
}

// ---------------- spawns & covers ----------------
// EnemyManager reads these via spawnApi (no props). Tower snipers use type 'roof'.
const SPAWNS = [
  // perimeter guards: fence/gate corridor (4)
  { pos: [-8, 0.2, 34], patrol: [[-12, 32], [8, 32], [8, 37], [-12, 37]] },
  { pos: [8, 0.2, 33], patrol: [[12, 37], [-8, 37], [-8, 32], [12, 32]] },
  { pos: [0, 0.2, 28.5], patrol: [[-6, 28], [6, 28]] },
  { pos: [-16, 0.2, 36], patrol: [[-20, 35], [-10, 35]] },
  // yard (2)
  { pos: [-6, 0.2, 14], patrol: [[-12, 12], [0, 16]] },
  { pos: [7, 0.2, 10], patrol: [[2, 7], [12, 12]] },
  // hangar 1 interior (2)
  { pos: [-16, 0.2, 8], patrol: [[-19, 5], [-9, 5], [-9, 10], [-19, 10]] },
  { pos: [-9, 0.2, 0], patrol: [[-14, -1], [-6, -1], [-6, 3], [-14, 3]] },
  // hangar 2 exterior (2)
  { pos: [9, 0.2, -11], patrol: [[7, -9], [14, -13]] },
  { pos: [24, 0.2, -16], patrol: [[23, -14], [27, -18]] },
  // data center (2)
  { pos: [-4, 0.2, -36], patrol: [[-7, -34], [0, -38]] },
  { pos: [5, 0.2, -42], patrol: [[1, -40], [7, -44]] },
  // tower snipers (2)
  { pos: [-28, 6.6, 0], patrol: [[-29, -1], [-27, -1], [-27, 1], [-29, 1]], type: 'roof' },
  { pos: [28, 6.6, -20], patrol: [[27, -21], [29, -21], [29, -19], [27, -19]], type: 'roof' },
]
const COVERS = [
  [-6, 33], [6, 32],           // corridor crates
  [-4, 27.5], [4, 27.5],       // gate sandbags
  [-8, 14], [8.6, 11.6],       // yard crates
  [-4, 5],                     // hangar 1 door
  [-19.5, 11], [-6.5, -1],     // hangar 1 interior
  [10, -12], [25, -16],        // hangar 2
  [23, -3], [29, -12.5],       // depot
  [-3.4, -36.5], [5.5, -43.5], // data center
  [-26, 1], [26, -19],         // towers
]

// Reinforcement plan (executed by MissionManager via enemyRegistry.requestSpawn):
// - objective 'alarm' (index 6) starts -> 2x mid-yard: {pos:[-10,0.2,18]}, {pos:[10,0.2,14]}
// - objective 'alarm' + 20s -> 2x gate: {pos:[-6,0.2,30]}, {pos:[6,0.2,30]}

// ---------------- map root ----------------
export default function ArcticOutpost() {
  const [alarm, setAlarm] = useState(false)
  useEffect(() => {
    arcticMapRefs.alarmFired = false
    spawnApi.set(SPAWNS, COVERS)
    const unsub = missionEvents.on('alarmOn', () => {
      arcticMapRefs.alarmFired = true
      setAlarm(true)
      audio.alarm()
    })
    return () => { unsub() }
  }, [])
  return (
    <group>
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#0a1326', 45, 230]} />
      {/* the ONE shadow-casting light: dim bluish moon */}
      <directionalLight color="#a8c0ff" intensity={0.6} position={[45, 55, -30]} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-75} shadow-camera-right={75}
        shadow-camera-top={75} shadow-camera-bottom={-75}
        shadow-camera-near={1} shadow-camera-far={260}
        shadow-bias={-0.0004} />
      <hemisphereLight skyColor="#24365e" groundColor="#0a0e18" intensity={0.4} />
      <Ground />
      <Bounds />
      <PerimeterFence />
      <InnerWall />
      <WatchTower x={-28} z={0} />
      <WatchTower x={28} z={-20} />
      <WatchTower x={-32} z={36} />
      <WatchTower x={32} z={36} />
      <Hangar1 />
      <Hangar2 />
      <FuelDepot />
      <DataCenter />
      <Truck x={-6} z={18} ry={0.3} />
      <Truck x={20} z={-2} ry={-0.4} />
      <Jeep x={6} z={22} ry={2.8} />
      <Antenna x={18} z={24} />
      <Antenna x={-18} z={-30} />
      <Antenna x={8} z={-40} />
      <TipBlinkers />
      <Searchlight alarm={alarm} />
      <Floodlights alarm={alarm} />
      <RedLights alarm={alarm} />
      {alarm && <Beacons />}
      <Props />
      <ExtractionMarkers />
    </group>
  )
}
