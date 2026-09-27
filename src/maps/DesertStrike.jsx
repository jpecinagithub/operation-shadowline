// OPERATION SHADOWLINE — Desert Strike map. 100% original procedural content.
// Fictional desert town at sunset (~150m, z +55 south gate .. -75 comms building).
// All geometry procedural, flat Lambert materials, no external assets.
// NOTE: MissionManager.jsx imports { mapRefs } from this file, and this file imports
// { missionEvents, spawnApi } from MissionManager.jsx. The cycle is safe: neither module
// touches the other's bindings during top-level evaluation (only inside components/effects).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { damageables } from '../systems/damageables.js'
import { interactables } from '../systems/interactables.js'
import { useGame } from '../systems/GameState.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'
import { missionEvents, spawnApi } from '../missions/MissionManager.jsx'

// Shared with MissionManager: damageable/interactable ids + one-shot flags.
export const mapRefs = { cineCarId: null, relayId: null, truckDestroyed: false }

// ---------------- cached geometry / materials (module level) ----------------
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  plane: new THREE.PlaneGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
}
const lam = (color, emissive = 0x000000, ei = 1) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: ei })
const MATS = {
  sand: lam(0xc99a5b),
  sandDark: lam(0xb0824a),
  sandLight: lam(0xd8ab6b),
  stone: lam(0x9d8a6e),
  stoneDark: lam(0x77644e),
  plaster: lam(0xd8c49c),
  plasterDark: lam(0xbfa87e),
  wood: lam(0x6e4f30),
  woodDark: lam(0x54391f),
  canopyA: lam(0xb3402e),
  canopyB: lam(0xe8dcc0),
  metal: lam(0x5a5f66),
  darkMetal: lam(0x33363b),
  burnt: lam(0x1c1a18),
  rust: lam(0x8a3b22),
  olive: lam(0x5b6242),
  tire: lam(0x1e1e1e),
  sandbag: lam(0xa68a5e),
  contBlue: lam(0x2e5f8a),
  contRust: lam(0xa34a2a),
  contGreen: lam(0x4a6b3f),
  charred: lam(0x241d18),
  glassDark: lam(0x14181c),
  lampHead: lam(0x8a7a5a),
  glowGreen: lam(0x39ff6a, 0x39ff6a, 1.6),
  fireGlow: lam(0xff8a2a, 0xff7a1a, 1.4),
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
// SolidCyl: same idea for cylinders (barrels, fountain base).
function SolidCyl({ p, r, h, m }) {
  return (
    <RigidBody type="fixed" colliders={false} position={p}>
      <CylinderCollider args={[h / 2, r]} />
      <mesh geometry={GEO.cyl} material={m} scale={[r * 2, h, r * 2]} castShadow receiveShadow />
    </RigidBody>
  )
}

// ---------------- ground ----------------
const PATCHES = [
  { p: [-32, 0.02, 22], s: [30, 20], m: 'sandDark' },
  { p: [30, 0.02, -6], s: [26, 24], m: 'sandLight' },
  { p: [-28, 0.02, -34], s: [24, 26], m: 'sandDark' },
  { p: [8, 0.025, 34], s: [22, 16], m: 'sandLight' },
  { p: [-6, 0.02, -58], s: [30, 18], m: 'sandDark' },
  { p: [34, 0.025, -46], s: [20, 22], m: 'sandLight' },
  { p: [-36, 0.025, -8], s: [18, 20], m: 'sandLight' },
]
function Ground() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[0, -0.5, -10]}>
        <CuboidCollider args={[65, 0.5, 90]} />
      </RigidBody>
      <mesh geometry={GEO.plane} material={MATS.sand} rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, -10]} scale={[130, 180, 1]} receiveShadow />
      {PATCHES.map((pt, i) => (
        <mesh key={i} geometry={GEO.plane} material={MATS[pt.m]} rotation={[-Math.PI / 2, 0, 0]}
          position={pt.p} scale={[pt.s[0], pt.s[1], 1]} receiveShadow />
      ))}
    </group>
  )
}

// Distant dunes for silhouette (outside play bounds, no colliders).
function Dunes() {
  const dunes = [
    [-58, 0, 34, 22, 5, 34], [58, 0, -8, 24, 6, 30], [-58, 0, -52, 20, 4, 30],
    [58, 0, -62, 22, 5, 28], [24, 0, 76, 40, 6, 18], [-30, 0, -88, 44, 7, 20],
  ]
  return (
    <group>
      {dunes.map((d, i) => (
        <P key={i} p={[d[0], d[4] / 2 - 0.5, d[2]]} s={[d[3], d[4], d[5]]} m={MATS.sandDark} cast={false} />
      ))}
    </group>
  )
}

// Invisible walls keeping the player inside the play area.
function Bounds() {
  const walls = [
    { p: [0, 3, 60], s: [110, 6, 2] },
    { p: [0, 3, -80], s: [110, 6, 2] },
    { p: [-52, 3, -10], s: [2, 6, 150] },
    { p: [52, 3, -10], s: [2, 6, 150] },
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

// ---------------- south gate (z=46, gap x in [-3,3]) ----------------
function Gate() {
  return (
    <group>
      <Solid p={[-11, 4.25, 46]} s={[3, 8.5, 3]} m={MATS.stone} />
      <Solid p={[11, 4.25, 46]} s={[3, 8.5, 3]} m={MATS.stone} />
      <P p={[-11, 8.85, 46]} s={[3.6, 0.7, 3.6]} m={MATS.stoneDark} cast={false} />
      <P p={[11, 8.85, 46]} s={[3.6, 0.7, 3.6]} m={MATS.stoneDark} cast={false} />
      <Solid p={[-6.5, 2, 46]} s={[7, 4, 1.6]} m={MATS.plasterDark} />
      <Solid p={[6.5, 2, 46]} s={[7, 4, 1.6]} m={MATS.plasterDark} />
    </group>
  )
}

// ---------------- buildings ----------------
const BUILDINGS = [
  // west row (x spans -26..-10)
  { x: -18, z: 33, w: 16, d: 9, h: 6, m: 'plaster' },
  { x: -18, z: 21, w: 16, d: 9, h: 7, m: 'stone' },
  { x: -18, z: 9, w: 16, d: 9, h: 5, m: 'plasterDark' },
  { x: -18, z: -3.5, w: 16, d: 9, h: 8, m: 'stone' },      // ROOF A (y=8)
  { x: -18, z: -14.5, w: 16, d: 9, h: 6, m: 'plaster' },
  { x: -18, z: -28, w: 16, d: 8, h: 5, m: 'stoneDark' },
  { x: -18, z: -36, w: 16, d: 8, h: 7, m: 'plaster' },
  // east row (x spans 10..26)
  { x: 18, z: 34, w: 16, d: 10, h: 5, m: 'stone' },
  { x: 18, z: 22, w: 16, d: 10, h: 8, m: 'plaster' },      // ROOF B (y=8)
  { x: 18, z: 10, w: 16, d: 10, h: 6, m: 'plasterDark' },
  { x: 18, z: -2, w: 16, d: 10, h: 5, m: 'stone' },
  { x: 18, z: -14, w: 16, d: 10, h: 7, m: 'plaster' },     // ROOF C (y=7)
  { x: 18, z: -26, w: 16, d: 10, h: 5, m: 'stoneDark' },
  { x: 18, z: -35, w: 16, d: 8, h: 6, m: 'plasterDark' },
]
const DOORS = [
  [-9.92, 33], [-9.92, -3.5], [9.92, 22], [9.92, -14],
]
function Building({ x, z, w, d, h, m }) {
  const mat = MATS[m]
  const ph = 0.7, pt = 0.35
  return (
    <group>
      <Solid p={[x, h / 2, z]} s={[w, h, d]} m={mat} />
      <P p={[x, h + ph / 2, z - d / 2]} s={[w + pt, ph, pt]} m={mat} cast={false} />
      <P p={[x, h + ph / 2, z + d / 2]} s={[w + pt, ph, pt]} m={mat} cast={false} />
      <P p={[x - w / 2, h + ph / 2, z]} s={[pt, ph, d + pt]} m={mat} cast={false} />
      <P p={[x + w / 2, h + ph / 2, z]} s={[pt, ph, d + pt]} m={mat} cast={false} />
    </group>
  )
}

// ---------------- market (z in [8,26]) ----------------
function Stall({ x, z }) {
  const strips = [-1.04, -0.52, 0, 0.52, 1.04]
  const poles = []
  for (const sx of [-1, 1]) for (const sz of [-0.55, 0.55]) poles.push([sx, sz])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CuboidCollider args={[1.4, 1.35, 1.15]} position={[0, 1.35, 0]} />
      <mesh geometry={GEO.box} material={MATS.wood} scale={[2.2, 0.9, 1.3]}
        position={[0, 0.45, 0]} castShadow receiveShadow />
      {poles.map(([sx, sz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.woodDark} scale={[0.12, 2.6, 0.12]}
          position={[sx, 1.3, sz]} castShadow />
      ))}
      {strips.map((sx, i) => (
        <mesh key={`s${i}`} geometry={GEO.box} material={i % 2 ? MATS.canopyB : MATS.canopyA}
          scale={[0.54, 0.06, 2.2]} position={[sx, 2.62, 0]} castShadow />
      ))}
    </RigidBody>
  )
}
const CRATES = [
  [-6.8, 0.5, 21.5], [-5.6, 0.5, 21.5], [-6.2, 1.5, 21.5],
  [6.8, 0.5, 15], [6.8, 0.5, 13.8],
  [-3, 0.5, 0], [-1.8, 0.5, 0.5],
  [10, 0.5, -24], [-10, 0.5, -36], [2, 0.5, -48],
]
const BARRELS = [
  [7.2, 20, 'rust'], [-7.2, 16, 'metal'], [7.2, 11, 'metal'], [-7.5, 4, 'rust'],
  [11, -28, 'metal'], [-11, -30, 'metal'], [3, -44, 'rust'], [-3, -50, 'metal'],
]
function FireLight() {
  const ref = useRef()
  const smokeT = useRef(0)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (ref.current) ref.current.intensity = 1.8 + Math.sin(t * 23) * 0.4 + Math.sin(t * 57) * 0.25
    smokeT.current += dt
    if (smokeT.current > 1.6) {
      smokeT.current = 0
      fx.smoke(new THREE.Vector3(2.5, 1.4, 14), 0.7, 3)
    }
  })
  return <pointLight ref={ref} color="#ff7a2a" intensity={1.8} distance={18} decay={2} position={[2.5, 1.6, 14]} />
}
function Market() {
  return (
    <group>
      <Stall x={-4.5} z={22} />
      <Stall x={4.5} z={18} />
      <Stall x={-4.5} z={13} />
      <Stall x={4.5} z={9} />
      {CRATES.map((c, i) => (
        <Solid key={i} p={c} s={[1, 1, 1]} m={MATS.wood} />
      ))}
      {BARRELS.map((b, i) => (
        <SolidCyl key={i} p={[b[0], 0.45, b[1]]} r={0.35} h={0.9} m={b[2] === 'rust' ? MATS.rust : MATS.metal} />
      ))}
      {/* fire barrel */}
      <SolidCyl p={[2.5, 0.45, 14]} r={0.32} h={0.9} m={MATS.rust} />
      <P p={[2.5, 0.94, 14]} s={[0.5, 0.08, 0.5]} m={MATS.fireGlow} geo={GEO.cyl} cast={false} />
    </group>
  )
}

// ---------------- cars ----------------
function CarBody({ burnt, color }) {
  const body = burnt ? MATS.burnt : color
  const glass = burnt ? MATS.burnt : MATS.glassDark
  const wheels = []
  for (const wx of [1.35, -1.35]) for (const wz of [0.95, -0.95]) wheels.push([wx, wz])
  return (
    <group>
      <mesh geometry={GEO.box} material={body} scale={[4.2, 0.75, 1.9]} position={[0, 0.62, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={body} scale={[2.0, 0.62, 1.7]} position={[-0.2, 1.28, 0]} castShadow />
      <mesh geometry={GEO.box} material={glass} scale={[1.8, 0.4, 1.72]} position={[-0.2, 1.2, 0]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[0.76, 0.3, 0.76]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.38, wz]} castShadow />
      ))}
    </group>
  )
}
function WreckCar({ x, z, ry }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[2.2, 0.95, 1.0]} position={[0, 0.95, 0]} />
      <CarBody burnt color={MATS.burnt} />
    </RigidBody>
  )
}
// Cinematic-1 car: parked at the market exit. MissionManager detonates it via
// damageables.damage(mapRefs.cineCarId, 999) when the player crosses the trigger.
function CineCar() {
  const [burnt, setBurnt] = useState(false)
  useEffect(() => {
    const id = damageables.register({
      position: [-4, 1, 6], radius: 2.6, hp: 40,
      onDeath: () => {
        fx.explosion(new THREE.Vector3(-4, 1.2, 6), 2.6)
        fx.smoke(new THREE.Vector3(-4, 2, 6), 1.6, 8)
        audio.explosion(1.4)
        setBurnt(true)
        missionEvents.emit('cineCar')
      },
    })
    mapRefs.cineCarId = id
    return () => {
      damageables.unregister(id)
      if (mapRefs.cineCarId === id) mapRefs.cineCarId = null
    }
  }, [])
  return (
    <RigidBody type="fixed" colliders={false} position={[-4, 0, 6]} rotation={[0, 0.25, 0]}>
      <CuboidCollider args={[2.2, 0.95, 1.0]} position={[0, 0.95, 0]} />
      <CarBody burnt={burnt} color={MATS.rust} />
    </RigidBody>
  )
}

// ---------------- gun truck (plaza, damageable objective target) ----------------
function GunTruck() {
  const [burnt, setBurnt] = useState(false)
  const lastSmoke = useRef(0)
  useEffect(() => {
    const id = damageables.register({
      position: [6, 1, -32], radius: 2.6, hp: 130,
      onDamaged: (hpLeft) => {
        const now = performance.now()
        if (hpLeft < 60 && hpLeft > 0 && now - lastSmoke.current > 1200) {
          lastSmoke.current = now
          fx.smoke(new THREE.Vector3(6, 2.2, -32), 1.4, 5)
        }
      },
      onDeath: () => {
        fx.explosion(new THREE.Vector3(6, 1.5, -32), 2.4)
        fx.smoke(new THREE.Vector3(6, 2.5, -32), 2, 10)
        audio.explosion(1.2)
        mapRefs.truckDestroyed = true
        setBurnt(true)
        missionEvents.emit('truckDestroyed')
      },
    })
    return () => damageables.unregister(id)
  }, [])
  const body = burnt ? MATS.burnt : MATS.olive
  const dark = burnt ? MATS.burnt : MATS.darkMetal
  const wheels = []
  for (const wx of [1.25, -1.25]) for (const wz of [1.6, -1.6]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={[6, 0, -32]} rotation={[0, -0.15, 0]}>
      <CuboidCollider args={[1.4, 1.5, 3.2]} position={[0, 1.4, 0]} />
      <mesh geometry={GEO.box} material={body} scale={[2.5, 1.0, 4.4]} position={[0, 1.15, 0.7]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={body} scale={[2.4, 1.8, 1.9]} position={[0, 1.5, -1.75]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={burnt ? MATS.burnt : MATS.glassDark} scale={[2.0, 0.7, 0.1]} position={[0, 1.9, -2.72]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[1.0, 0.35, 1.0]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.5, wz]} castShadow />
      ))}
      <mesh geometry={GEO.box} material={dark} scale={[0.7, 0.5, 0.7]} position={[0, 1.9, 0.7]} castShadow />
      <mesh geometry={GEO.cyl} material={dark} scale={[0.18, 2.4, 0.18]} rotation={[Math.PI / 2, 0, 0]} position={[0, 2.15, -0.5]} castShadow />
    </RigidBody>
  )
}

// ---------------- plaza (z in [-24,-42]) ----------------
function Fountain() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, -33]}>
      <CylinderCollider args={[0.6, 3]} position={[0, 0.6, 0]} />
      <mesh geometry={GEO.cyl} material={MATS.stone} scale={[6, 1.1, 6]} position={[0, 0.55, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.cyl} material={MATS.stoneDark} scale={[4.8, 0.2, 4.8]} position={[0, 0.25, 0]} receiveShadow />
      <mesh geometry={GEO.cyl} material={MATS.stone} scale={[0.8, 2.2, 0.8]} position={[0, 1.1, 0]} castShadow />
      <mesh geometry={GEO.cyl} material={MATS.stoneDark} scale={[2, 0.4, 2]} position={[0, 2.3, 0]} castShadow />
    </RigidBody>
  )
}
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
function LampPost({ x, z, flicker = false }) {
  const mat = useMemo(() => {
    if (!flicker) return MATS.lampHead
    return new THREE.MeshLambertMaterial({ color: 0xffe0b0, emissive: 0xffc37a, emissiveIntensity: 1 })
  }, [flicker])
  const head = useRef()
  useFrame(() => {
    if (flicker && head.current) {
      head.current.emissiveIntensity = Math.random() < 0.12 ? 0.1 : 0.9 + Math.random() * 0.6
    }
  })
  const sx = x > 0 ? -1 : 1
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CuboidCollider args={[0.15, 2.75, 0.15]} position={[0, 2.75, 0]} />
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.18, 5.5, 0.18]} position={[0, 2.75, 0]} castShadow />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[1.3, 0.12, 0.12]} position={[sx * 0.6, 5.45, 0]} />
      <mesh ref={head} geometry={GEO.box} material={mat} scale={[0.45, 0.22, 0.28]} position={[sx * 1.15, 5.32, 0]} />
    </RigidBody>
  )
}
function Plaza() {
  return (
    <group>
      <Fountain />
      <WreckCar x={-6} z={-28} ry={0.35} />
      <WreckCar x={5.5} z={-38} ry={-0.6} />
      <SandbagRow x={-3.9} z={-22} />
      <SandbagRow x={3.9} z={-22} />
      <SandbagRow x={-3.9} z={-46} />
      <SandbagRow x={3.9} z={-46} />
      <SandbagRow x={-10} z={-27} ry={Math.PI / 2} />
      <Solid p={[12, 1.3, -30]} s={[2.4, 2.6, 6]} m={MATS.contBlue} />
      <Solid p={[-12, 1.3, -34]} s={[2.4, 2.6, 6]} m={MATS.contRust} />
      <Solid p={[12, 1.3, -18]} s={[2.4, 2.6, 6]} m={MATS.contGreen} />
      <Solid p={[-13, 1.3, -12]} s={[2.4, 2.6, 6]} m={MATS.contBlue} />
      <LampPost x={-7} z={30} />
      <LampPost x={7} z={6} />
      <LampPost x={-7} z={-18} flicker />
      <LampPost x={7} z={-40} />
    </group>
  )
}

// ---------------- comms building (z ~ -58) ----------------
function RelayConsole({ detonated }) {
  const bulb = useRef()
  const screenMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x0a2a12, emissive: 0x2aff5a, emissiveIntensity: 0.9 }),
    []
  )
  const bulbMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 2 }),
    []
  )
  useFrame((state) => {
    if (bulb.current && !detonated) {
      bulb.current.emissiveIntensity = 1.2 + Math.sin(state.clock.elapsedTime * 7) * 1.1
    }
  })
  useEffect(() => {
    const id = interactables.register({
      position: [0, 1, -61], radius: 2.6, prompt: 'Plant explosive [F]',
      // Only plantable during the 'plant' objective — planting early would soft-lock the flow.
      onInteract: () => {
        if (useGame.getState().objectiveIndex === 7) missionEvents.emit('relayPlanted')
      },
    })
    mapRefs.relayId = id
    const unsub = missionEvents.on('relayPlanted', () => interactables.unregister(id))
    return () => {
      unsub()
      interactables.unregister(id)
      if (mapRefs.relayId === id) mapRefs.relayId = null
    }
  }, [])
  const body = detonated ? MATS.charred : MATS.darkMetal
  return (
    <group>
      <Solid p={[0, 0.55, -61]} s={[1.6, 1.1, 0.7]} m={body} />
      {!detonated && (
        <mesh geometry={GEO.plane} material={screenMat} scale={[1.3, 0.55]}
          position={[0, 1.28, -60.62]} rotation={[-0.35, 0, 0]} />
      )}
      <mesh ref={bulb} geometry={GEO.sphere} material={detonated ? MATS.charred : bulbMat}
        scale={[0.12, 0.12, 0.12]} position={[0, 1.62, -61]} />
    </group>
  )
}
function CommsBuilding() {
  const [detonated, setDetonated] = useState(false)
  const smokeT = useRef(0)
  useEffect(() => missionEvents.on('relayDetonated', () => setDetonated(true)), [])
  useFrame((_, dt) => {
    if (!detonated) return
    smokeT.current += dt
    if (smokeT.current > 0.7) {
      smokeT.current = 0
      fx.smoke(
        new THREE.Vector3((Math.random() - 0.5) * 8, 4.5, -58 + (Math.random() - 0.5) * 6),
        2.2, 9
      )
    }
  })
  const wall = detonated ? MATS.charred : MATS.plaster
  const trim = detonated ? MATS.charred : MATS.plasterDark
  return (
    <group>
      {/* outer walls; south wall split leaves a door gap x in [-1,1] */}
      <Solid p={[0, 2.5, -62.6]} s={[14, 5, 0.8]} m={wall} />
      <Solid p={[-4, 2.5, -53.4]} s={[6, 5, 0.8]} m={wall} />
      <Solid p={[4, 2.5, -53.4]} s={[6, 5, 0.8]} m={wall} />
      <Solid p={[0, 4.6, -53.4]} s={[2.4, 0.8, 0.8]} m={trim} />
      <Solid p={[-6.6, 2.5, -58]} s={[0.8, 5, 10]} m={wall} />
      <Solid p={[6.6, 2.5, -58]} s={[0.8, 5, 10]} m={wall} />
      <mesh geometry={GEO.box} material={trim} scale={[14.6, 0.6, 10.6]}
        position={[0, 5.3, -58]} castShadow receiveShadow />
      {/* divider wall: two rooms, doorway x in [-1,3.5] */}
      <Solid p={[-3.75, 2.5, -58]} s={[5.5, 5, 0.6]} m={wall} />
      <Solid p={[5, 2.5, -58]} s={[3, 5, 0.6]} m={wall} />
      {/* antenna */}
      <P p={[5, 8.4, -60]} s={[0.15, 6, 0.15]} m={MATS.darkMetal} geo={GEO.cyl} cast={false} />
      <P p={[5, 10.8, -60]} s={[1.6, 0.12, 0.12]} m={MATS.darkMetal} cast={false} />
      <RelayConsole detonated={detonated} />
    </group>
  )
}

// Extraction rally markers near the south gate — only shown during the final
// escape objective, as flat glowing pads (previously tall pillars that blocked
// the spawn view).
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
      {[-2.5, 2.5].map((x) => (
        <mesh key={x} geometry={GEO.cyl} material={MATS.glowGreen}
          scale={[0.85, 0.1, 0.85]} position={[x, 0.06, 44]} />
      ))}
    </group>
  )
}

// ---------------- spawns & covers ----------------
// EnemyManager reads these via spawnApi (no props). Roof spawns are enemy-only
// vantage points (type 'roof', y = roof height); the player has no way up.
const SPAWNS = [
  // gate patrol (3)
  { pos: [-6, 0.2, 40], patrol: [[-6, 38], [6, 38], [6, 44], [-6, 44]] },
  { pos: [6, 0.2, 42], patrol: [[6, 44], [-6, 44], [-6, 38], [6, 38]] },
  { pos: [0, 0.2, 36], patrol: [[-4, 34], [4, 34]] },
  // market (3)
  { pos: [-5, 0.2, 18], patrol: [[-5, 14], [-5, 22]] },
  { pos: [5, 0.2, 12], patrol: [[5, 9], [5, 18]] },
  { pos: [0, 0.2, 24], patrol: [[-3, 22], [3, 22]] },
  // roofs (3)
  { pos: [-18, 8.2, -3.5], patrol: [[-22, -6], [-14, -6], [-14, -1], [-22, -1]], type: 'roof' },
  { pos: [18, 8.2, 22], patrol: [[14, 20], [22, 20], [22, 24], [14, 24]], type: 'roof' },
  { pos: [18, 7.2, -14], patrol: [[14, -16], [22, -16], [22, -12], [14, -12]], type: 'roof' },
  // plaza (3)
  { pos: [-8, 0.2, -28], patrol: [[-10, -26], [-4, -30]] },
  { pos: [8, 0.2, -36], patrol: [[4, -34], [10, -38]] },
  { pos: [0, 0.2, -26], patrol: [[-4, -24], [4, -28]] },
  // comms approach (2)
  { pos: [-4, 0.2, -48], patrol: [[-6, -46], [-2, -50]] },
  { pos: [4, 0.2, -54], patrol: [[2, -52], [6, -56]] },
]
const COVERS = [
  [-5, 40], [5, 40],                 // gate walls
  [-6.5, 22], [6.5, 18],             // market stalls
  [-6.5, 13], [6.5, 9],
  [-6.5, 6], [-1.2, 8.5],            // cinematic car
  [3, 0], [-3, -1.5],                // market exit crates
  [-8.5, -28], [-3.5, -25.5],        // plaza wreck (west)
  [8, -38], [3, -35],                // plaza wreck (east)
  [-3.5, -33], [3.5, -33],           // fountain
  [3.2, -29.5], [8.8, -34],          // gun truck
]

// Reinforcement plan (executed by MissionManager via enemyRegistry.requestSpawn):
// - objective 'plaza' (index 4) starts -> 2x plaza: {pos:[-10,0.2,-23]}, {pos:[10,0.2,-37]}
// - objective 'comms' (index 6) starts -> 2x comms: {pos:[-6,0.2,-47]}, {pos:[6,0.2,-49]}

// ---------------- map root ----------------
export default function DesertStrike() {
  useEffect(() => {
    mapRefs.truckDestroyed = false
    spawnApi.set(SPAWNS, COVERS)
  }, [])
  return (
    <group>
      <color attach="background" args={['#2e1a0e']} />
      <fog attach="fog" args={['#cf8a4a', 55, 260]} />
      <directionalLight color="#ffb36b" intensity={2.2} position={[-55, 24, 20]} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60} shadow-camera-right={60}
        shadow-camera-top={60} shadow-camera-bottom={-60}
        shadow-camera-near={1} shadow-camera-far={220}
        shadow-bias={-0.0004} />
      <hemisphereLight skyColor="#ff9a4d" groundColor="#5b3a22" intensity={0.5} />
      <FireLight />
      <pointLight color="#ff9a4d" intensity={0.7} distance={34} decay={2} position={[0, 5, -32]} />
      <Ground />
      <Dunes />
      <Bounds />
      <Gate />
      {BUILDINGS.map((b, i) => (
        <Building key={i} x={b.x} z={b.z} w={b.w} d={b.d} h={b.h} m={b.m} />
      ))}
      {DOORS.map(([dx, dz], i) => (
        <P key={`d${i}`} p={[dx, 1.3, dz]} s={[0.15, 2.6, 1.6]} m={MATS.woodDark} cast={false} />
      ))}
      <Market />
      <CineCar />
      <Plaza />
      <GunTruck />
      <CommsBuilding />
      <ExtractionMarkers />
    </group>
  )
}
