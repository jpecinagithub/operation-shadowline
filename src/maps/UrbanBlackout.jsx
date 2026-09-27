// OPERATION SHADOWLINE — Urban Blackout map. 100% original procedural content.
//
// Night raid through a rain-soaked ruined city: a wreck-choked avenue runs
// south (z=55, player spawn) to north, ending at an office tower (z -30..-50).
// The player breaches the tower, climbs two RAMPS (no stairs — the physics
// character controller cannot climb steps) to floor 3, rescues a trapped allied
// team, holds the room, then boards a helicopter on the avenue.
//
// KEY NUMBERS FOR MISSION LOGIC (do not change without updating MissionManager):
//   FLOOR2_Y = 4.0            (floor-2 slab top; player y ~4.2 standing)
//   FLOOR3_Y = 8.0            (floor-3 slab top; player y ~8.2 standing)
//   Ramp1 lobby->floor2: x=-10, low end (y=0) z=-35, high end (y=4) z=-43, slope 26.6deg
//   Ramp2 floor2->floor3: x=+10, low end (y=4) z=-43, high end (y=8) z=-35, slope 26.6deg
//   Tower entrance breach: x in [-2.8, 2.8], z = -30 (enter zone: x [-4,4], z [-34,-28])
//   Allied-team room: x in [4,12], z in [-50,-42] @ y=8; door gap x in [7,8.2] at z=-42
//     (rescue zone: x [4,12], z [-50,-42], y [7.5,9])
//   Fuel truck: [1.5, 0, 10] — damageable id in urbanMapRefs.fuelId (hp 60).
//     Cinematic trigger: mission logic calls damageables.damage(urbanMapRefs.fuelId, 999)
//     when the player crosses z ~= 14 (truck sits 4m ahead, in view).
//   Helicopter hover: [0, 6, -20] (avenue, in front of the tower).
//     Flight waypoints: [80,40,140] -> [40,25,80] -> [10,12,40] -> [0,7,0] -> [0,6,-20]
//     Events listened: 'heliInbound' (fly in), 'heliDepart' (ascend + fly off north).
//   Evac zone: center [0, -20], radius ~4 (green pads shown during final objective).
//   Events emitted: 'fuelDestroyed'. urbanMapRefs: { fuelId, fuelDestroyed, heliArrived }.
//
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CuboidCollider, CylinderCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { damageables } from '../systems/damageables.js'
import { useGame } from '../systems/GameState.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'
import { playerRef } from '../player/playerRef.js'
import { missionEvents, spawnApi } from '../missions/MissionManager.jsx'

// Shared with MissionManager: damageable id + one-shot flags.
export const urbanMapRefs = { fuelId: null, fuelDestroyed: false, heliArrived: false }

// Floor heights (slab tops). Player/enemy standing y ~= these + 0.2.
export const FLOOR2_Y = 4
export const FLOOR3_Y = 8

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
  asphalt: lam(0x23262e),
  asphaltDark: lam(0x191c22),
  puddleCyan: lam(0x0a0e14, 0x2a7a9a, 0.55),
  puddleMagenta: lam(0x0a0e14, 0x9a2a7a, 0.45),
  bldgA: lam(0x1b1e26),
  bldgB: lam(0x232733),
  bldgC: lam(0x15171e),
  towerWall: lam(0x20232b),
  towerTrim: lam(0x2b2f38),
  windowDark: lam(0x05070c, 0x10202f, 0.7),
  windowLit: lam(0x1a1006, 0xff9a3a, 0.9),
  concrete: lam(0x3a3d44),
  concreteDark: lam(0x26282e),
  neonCyan: lam(0x062a30, 0x00e5ff, 2.4),
  neonMagenta: lam(0x2a0620, 0xff2bd1, 2.4),
  neonRed: lam(0x2a0808, 0xff3131, 2.4),
  carBlue: lam(0x2e4a66),
  carRed: lam(0x5a2e2e),
  carGrey: lam(0x3a3d42),
  burnt: lam(0x121110),
  tire: lam(0x0c0c0c),
  glassDark: lam(0x0a0e14),
  fireGlow: lam(0xff8a2a, 0xff7a1a, 1.6),
  darkMetal: lam(0x23262c),
  metal: lam(0x4a4e55),
  tankShell: lam(0x7a7d82),
  olive: lam(0x5b6242),
  oliveDark: lam(0x42482f),
  skin: lam(0x8a6a52),
  helmet: lam(0x3a3d33),
  cubicle: lam(0x39404a),
  desk: lam(0x33373d),
  sandbag: lam(0x4a4436),
  glowGreen: lam(0x0a2a12, 0x39ff6a, 1.6),
  rampTop: lam(0x2e3138),
  lampDead: lam(0x1a1c20),
  heliBody: lam(0x2a2d33),
}
// Helicopter-only cached assets.
const coneGeo = new THREE.ConeGeometry(4.2, 13, 18, 1, true)
const coneMat = new THREE.MeshBasicMaterial({
  color: 0xfff0c0, transparent: true, opacity: 0.09,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
})
const discGeo = new THREE.CircleGeometry(5.6, 24)
const discMat = new THREE.MeshBasicMaterial({
  color: 0x9aa2ad, transparent: true, opacity: 0,
  side: THREE.DoubleSide, depthWrite: false,
})

// Deterministic pseudo-random for rubble / clutter placement.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------- tiny helpers ----------------
// P: plain visual mesh (no collider), scaled unit geometry.
function P({ p, s, m, ry = 0, rx = 0, rz = 0, cast = true, recv = true, geo = GEO.box }) {
  return (
    <mesh geometry={geo} material={m} position={p} scale={s} rotation={[rx, ry, rz]}
      castShadow={cast} receiveShadow={recv} />
  )
}
// Solid: fixed rigid body + matching cuboid collider + box mesh.
function Solid({ p, s, m, ry = 0, cast = true }) {
  return (
    <RigidBody type="fixed" colliders={false} position={p} rotation={[0, ry, 0]}>
      <CuboidCollider args={[s[0] / 2, s[1] / 2, s[2] / 2]} />
      <mesh geometry={GEO.box} material={m} scale={s} castShadow={cast} receiveShadow />
    </RigidBody>
  )
}
function SolidCyl({ p, r, h, m }) {
  return (
    <RigidBody type="fixed" colliders={false} position={p}>
      <CylinderCollider args={[h / 2, r]} />
      <mesh geometry={GEO.cyl} material={m} scale={[r * 2, h, r * 2]} castShadow receiveShadow />
    </RigidBody>
  )
}
// Ramp: inclined slab. dir=+1 rises toward -z (north), dir=-1 rises toward +z.
// Low end surface at (x, y0, z0); run 8m, rise 4m -> slope atan(4/8) = 26.57deg.
// The RigidBody itself is rotated so collider and mesh always match.
const RAMP_ANGLE = Math.atan2(4, 8)
const RAMP_LEN = Math.sqrt(80)
const RAMP_COS = 8 / RAMP_LEN
const RAMP_SIN = 4 / RAMP_LEN
function Ramp({ x, y0, z0, dir, w = 2.6 }) {
  const rx = dir * RAMP_ANGLE
  // Box center placed so the TOP SURFACE passes exactly through the end points.
  const yc = y0 + 2 - 0.15 * RAMP_COS
  const zc = z0 - dir * (4 + 0.15 * RAMP_SIN)
  return (
    <RigidBody type="fixed" colliders={false} position={[x, yc, zc]} rotation={[rx, 0, 0]}>
      <CuboidCollider args={[w / 2, 0.15, RAMP_LEN / 2]} />
      <mesh geometry={GEO.box} material={MATS.rampTop} scale={[w, 0.3, RAMP_LEN]}
        castShadow receiveShadow />
      {/* hazard edge strips */}
      <mesh geometry={GEO.box} material={MATS.neonRed} scale={[0.12, 0.02, RAMP_LEN]}
        position={[-w / 2 + 0.1, 0.16, 0]} />
      <mesh geometry={GEO.box} material={MATS.neonRed} scale={[0.12, 0.02, RAMP_LEN]}
        position={[w / 2 - 0.1, 0.16, 0]} />
    </RigidBody>
  )
}

// ---------------- ground / bounds ----------------
const PUDDLES = [
  { p: [2, 48], s: [3.2, 2.2], m: 'puddleCyan' },
  { p: [-3, 30], s: [4.2, 2.6], m: 'puddleMagenta' },
  { p: [4, 10], s: [3.6, 2.4], m: 'puddleCyan' },
  { p: [-2, -6], s: [4.6, 3.0], m: 'puddleMagenta' },
  { p: [3, -20], s: [3.4, 2.2], m: 'puddleCyan' },
  { p: [0, 54], s: [5.0, 2.4], m: 'puddleCyan' },
  { p: [-5, -27], s: [3.8, 2.6], m: 'puddleMagenta' },
]
function Ground() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[0, -0.5, 2]}>
        <CuboidCollider args={[45, 0.5, 62]} />
      </RigidBody>
      <mesh geometry={GEO.plane} material={MATS.asphalt} rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 2]} scale={[90, 124, 1]} receiveShadow />
      {/* darker asphalt patches */}
      <mesh geometry={GEO.plane} material={MATS.asphaltDark} rotation={[-Math.PI / 2, 0, 0]}
        position={[-14, 0.015, 20]} scale={[26, 60, 1]} receiveShadow />
      <mesh geometry={GEO.plane} material={MATS.asphaltDark} rotation={[-Math.PI / 2, 0, 0]}
        position={[14, 0.015, -22]} scale={[26, 56, 1]} receiveShadow />
      {/* fake neon reflections */}
      {PUDDLES.map((pd, i) => (
        <mesh key={i} geometry={GEO.plane} material={MATS[pd.m]} rotation={[-Math.PI / 2, 0, 0]}
          position={[pd.p[0], 0.04, pd.p[1]]} scale={[pd.s[0], pd.s[1], 1]} receiveShadow />
      ))}
    </group>
  )
}
function Bounds() {
  const walls = [
    { p: [0, 3, 62], s: [90, 6, 2] },
    { p: [0, 3, -58], s: [90, 6, 2] },
    { p: [-44, 3, 2], s: [2, 6, 130] },
    { p: [44, 3, 2], s: [2, 6, 130] },
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

// ---------------- avenue props ----------------
function CarWreck({ x, z, ry, burnt, paint }) {
  const body = burnt ? MATS.burnt : paint
  const glass = burnt ? MATS.burnt : MATS.glassDark
  const wheels = []
  for (const wx of [1.35, -1.35]) for (const wz of [0.95, -0.95]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[2.2, 0.95, 1.05]} position={[0, 0.95, 0]} />
      <mesh geometry={GEO.box} material={body} scale={[4.2, 0.75, 1.9]} position={[0, 0.62, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={body} scale={[2.0, 0.62, 1.7]} position={[-0.2, 1.28, 0]} castShadow />
      <mesh geometry={GEO.box} material={glass} scale={[1.8, 0.4, 1.72]} position={[-0.2, 1.2, 0]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[0.76, 0.3, 0.76]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.38, wz]} castShadow />
      ))}
    </RigidBody>
  )
}
// Burning wreck: fire glow + flickering point light (NO shadow) + periodic smoke.
function BurningCar({ x, z, ry }) {
  const smokeT = useRef(0)
  const light = useRef()
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (light.current)
      light.current.intensity = 130 + Math.sin(t * 21 + x) * 30 + Math.sin(t * 47 + z) * 18
    smokeT.current += dt
    if (smokeT.current > 1.5) {
      smokeT.current = 0
      fx.smoke(new THREE.Vector3(x, 1.7, z), 0.9, 3.5)
    }
  })
  return (
    <group>
      <CarWreck x={x} z={z} ry={ry} burnt />
      <P p={[x, 1.02, z]} s={[1.7, 0.12, 1.1]} m={MATS.fireGlow} ry={ry} cast={false} />
      <pointLight ref={light} color="#ff7a2a" intensity={130} distance={26} decay={2}
        position={[x, 1.9, z]} />
    </group>
  )
}
function BusWreck({ x, z, ry }) {
  const wheels = []
  for (const wx of [1.45, -1.45]) for (const wz of [3.4, 0, -3.4]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} rotation={[0, ry, 0]}>
      <CuboidCollider args={[1.5, 1.5, 5.1]} position={[0, 1.5, 0]} />
      <mesh geometry={GEO.box} material={MATS.burnt} scale={[2.9, 2.4, 10.2]} position={[0, 1.7, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={MATS.windowDark} scale={[2.92, 0.8, 9.0]} position={[0, 2.2, 0]} />
      <mesh geometry={GEO.box} material={MATS.burnt} scale={[2.9, 0.5, 10.2]} position={[0, 0.5, 0]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[0.9, 0.35, 0.9]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.45, wz]} castShadow />
      ))}
    </RigidBody>
  )
}
function Barricade({ x, z, ry = 0 }) {
  return <Solid p={[x, 0.5, z]} s={[2.2, 1.0, 0.6]} m={MATS.concrete} ry={ry} />
}
function Rubble({ x, z, seed = 1, r = 2.2, n = 7 }) {
  const chunks = useMemo(() => {
    const rnd = mulberry32(seed)
    return Array.from({ length: n }, (_, i) => ({
      dx: (rnd() - 0.5) * r * 2,
      dz: (rnd() - 0.5) * r * 2,
      s: 0.3 + rnd() * 0.7,
      ry: rnd() * Math.PI,
      rx: (rnd() - 0.5) * 0.6,
      dark: i % 2 === 0,
    }))
  }, [seed, r, n])
  return (
    <group>
      {chunks.map((c, i) => (
        <mesh key={i} geometry={GEO.box} material={c.dark ? MATS.concreteDark : MATS.asphaltDark}
          position={[x + c.dx, c.s * 0.26, z + c.dz]} scale={[c.s, c.s * 0.55, c.s * 0.8]}
          rotation={[c.rx, c.ry, 0]} castShadow receiveShadow />
      ))}
    </group>
  )
}
// Traffic light: full signal cycle (green -> yellow -> red), emissive only.
function TrafficLight({ x, z, ry, phase = 0 }) {
  const red = useMemo(() => lam(0x220000, 0xff2222, 2), [])
  const yel = useMemo(() => lam(0x221a00, 0xffaa22, 2), [])
  const grn = useMemo(() => lam(0x002200, 0x22ff44, 2), [])
  useFrame(({ clock }) => {
    const c = (clock.elapsedTime + phase) % 9
    red.emissiveIntensity = c > 5 ? 2.2 : 0.08
    yel.emissiveIntensity = c > 4 && c <= 5 ? 2.2 : 0.08
    grn.emissiveIntensity = c <= 4 ? 2.2 : 0.08
  })
  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
        <CuboidCollider args={[0.18, 2.9, 0.18]} position={[0, 2.9, 0]} />
      </RigidBody>
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.22, 5.8, 0.22]} position={[0, 2.9, 0]} castShadow />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.5, 1.5, 0.5]} position={[0, 5.2, 0]} castShadow />
      <mesh geometry={GEO.plane} material={red} scale={[0.3, 0.3]} position={[0, 5.62, 0.26]} />
      <mesh geometry={GEO.plane} material={yel} scale={[0.3, 0.3]} position={[0, 5.2, 0.26]} />
      <mesh geometry={GEO.plane} material={grn} scale={[0.3, 0.3]} position={[0, 4.78, 0.26]} />
    </group>
  )
}
// Street lamp: most are dead; flickering ones buzz with emissive only (no light).
// Lamps with `lit` also cast a real point light so the avenue stays playable at night.
function StreetLamp({ x, z, flicker = false, lit = false }) {
  const headMat = useMemo(
    () => (flicker
      ? new THREE.MeshLambertMaterial({ color: 0x333322, emissive: 0xcfe0ff, emissiveIntensity: 1.2 })
      : lit
        ? new THREE.MeshLambertMaterial({ color: 0x333322, emissive: 0xcfe0ff, emissiveIntensity: 1.6 })
        : MATS.lampDead),
    [flicker, lit]
  )
  const light = useRef()
  useFrame(() => {
    if (flicker) {
      const on = Math.random() >= 0.15
      headMat.emissiveIntensity = on ? 0.8 + Math.random() * 0.8 : 0.05
      if (light.current) light.current.intensity = on ? 540 + Math.random() * 120 : 15
    }
  })
  const sx = x > 0 ? -1 : 1
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]}>
      <CuboidCollider args={[0.16, 3.2, 0.16]} position={[0, 3.2, 0]} />
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.2, 6.4, 0.2]} position={[0, 3.2, 0]} castShadow />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[1.6, 0.14, 0.14]} position={[sx * 0.75, 6.3, 0]} />
      <mesh geometry={GEO.box} material={headMat} scale={[0.5, 0.2, 0.3]} position={[sx * 1.4, 6.18, 0]} />
      {lit && <pointLight ref={light} color="#cfe0ff" intensity={600} distance={60} decay={2} position={[sx * 1.4, 5.8, 0]} />}
    </RigidBody>
  )
}
// Neon sign: colored emissive plane on a backing plate. No lights, just glow.
function NeonSign({ p, s, m, ry = 0, flicker = false }) {
  const mat = useMemo(() => (flicker ? m.clone() : m), [m, flicker])
  useFrame(() => {
    if (flicker) mat.emissiveIntensity = Math.random() < 0.08 ? 0.2 : 2 + Math.random() * 0.8
  })
  return (
    <group position={p} rotation={[0, ry, 0]}>
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[s[0] + 0.35, s[1] + 0.35, 0.14]} />
      <mesh geometry={GEO.plane} material={mat} scale={[s[0], s[1]]} position={[0, 0, 0.08]} />
    </group>
  )
}
function AvenueBuilding({ x, z, w, d, h, m, faceX }) {
  const mat = MATS[m]
  const dir = Math.sign(faceX - x) // +1: face looks east, -1: looks west
  const wins = useMemo(() => {
    const arr = []
    const cols = 3
    const rows = Math.max(2, Math.floor(h / 6))
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++)
        arr.push({
          z: z - d / 2 + ((c + 0.5) * d) / cols,
          y: 3.6 + r * 6,
          lit: (c * 7 + r * 3 + Math.abs(Math.round(x))) % 13 === 0,
        })
    return arr
  }, [x, z, d, h])
  return (
    <group>
      <Solid p={[x, h / 2, z]} s={[w, h, d]} m={mat} />
      <P p={[x, h + 0.4, z]} s={[w + 0.6, 0.8, d + 0.6]} m={MATS.bldgC} cast={false} />
      <P p={[x - w / 4, h + 1.4, z + d / 5]} s={[2.2, 2.8, 2.2]} m={MATS.concreteDark} cast={false} />
      {wins.map((wn, i) => (
        <mesh key={i} geometry={GEO.plane} material={wn.lit ? MATS.windowLit : MATS.windowDark}
          position={[faceX + dir * 0.07, wn.y, wn.z]}
          rotation={[0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
          scale={[2.4, 3.2, 1]} />
      ))}
    </group>
  )
}
const AVE_BUILDINGS = [
  { x: -18, z: 44, w: 16, d: 14, h: 18, m: 'bldgA', faceX: -10 },
  { x: -18, z: 26, w: 16, d: 14, h: 24, m: 'bldgB', faceX: -10 },
  { x: -18, z: 8, w: 16, d: 14, h: 16, m: 'bldgC', faceX: -10 },
  { x: -18, z: -10, w: 16, d: 14, h: 21, m: 'bldgA', faceX: -10 },
  { x: 18, z: 46, w: 16, d: 14, h: 20, m: 'bldgB', faceX: 10 },
  { x: 18, z: 28, w: 16, d: 14, h: 16, m: 'bldgA', faceX: 10 },
  { x: 18, z: 10, w: 16, d: 14, h: 24, m: 'bldgC', faceX: 10 },
  { x: 18, z: -8, w: 16, d: 14, h: 18, m: 'bldgB', faceX: 10 },
]
function Avenue() {
  return (
    <group>
      {AVE_BUILDINGS.map((b, i) => (
        <AvenueBuilding key={i} {...b} />
      ))}
      {/* neon signs on the street faces */}
      <NeonSign p={[-9.85, 11, 26]} s={[1.4, 7]} m={MATS.neonCyan} ry={Math.PI / 2} flicker />
      <NeonSign p={[9.85, 13, 10]} s={[4.2, 1.1]} m={MATS.neonMagenta} ry={-Math.PI / 2} />
      <NeonSign p={[-9.85, 8, 2]} s={[3.0, 0.9]} m={MATS.neonRed} ry={Math.PI / 2} />
      <NeonSign p={[9.85, 9, -8]} s={[1.2, 5.5]} m={MATS.neonCyan} ry={-Math.PI / 2} />
      {/* wrecks: cover, angled across the street */}
      <CarWreck x={-3.5} z={44} ry={0.4} burnt paint={MATS.carBlue} />
      <CarWreck x={4} z={36} ry={-0.5} paint={MATS.carBlue} />
      <BusWreck x={-2} z={30} ry={0.18} />
      <BurningCar x={-4.5} z={26} ry={0.9} />
      <CarWreck x={3} z={18} ry={0.2} paint={MATS.carRed} />
      <CarWreck x={-2} z={4} ry={-0.7} paint={MATS.carGrey} />
      <CarWreck x={5} z={-8} ry={0.55} paint={MATS.carBlue} />
      <BurningCar x={0} z={-16} ry={0.1} />
      <CarWreck x={-3} z={-23} ry={-0.4} burnt paint={MATS.carRed} />
      {/* concrete barricades */}
      <Barricade x={3.5} z={40} ry={0.3} />
      <Barricade x={-3.5} z={32.5} ry={-0.2} />
      <Barricade x={3} z={8.5} ry={0.15} />
      <Barricade x={-3} z={-3.5} ry={-0.35} />
      {/* traffic lights */}
      <TrafficLight x={7.5} z={20} ry={Math.PI} phase={0} />
      <TrafficLight x={-7.5} z={-6} ry={0} phase={4.5} />
      {/* street lamps: a few working ones light the avenue; two flicker */}
      <StreetLamp x={-7.5} z={48} lit />
      <StreetLamp x={7.5} z={34} flicker lit />
      <StreetLamp x={-7.5} z={12} />
      <StreetLamp x={7.5} z={-2} flicker lit />
      <StreetLamp x={-7.5} z={-18} lit />
      {/* rubble */}
      <Rubble x={5} z={46} seed={11} />
      <Rubble x={-6} z={20} seed={23} r={2.8} />
      <Rubble x={6} z={-12} seed={37} />
      <Rubble x={-5} z={-22} seed={51} r={2.8} n={9} />
      {/* sandbags guarding the tower forecourt */}
      <Solid p={[-5, 0.35, -27]} s={[2.4, 0.7, 0.9]} m={MATS.sandbag} ry={0.2} />
      <Solid p={[5, 0.35, -27]} s={[2.4, 0.7, 0.9]} m={MATS.sandbag} ry={-0.2} />
    </group>
  )
}

// ---------------- fuel truck (CINEMATIC #2) ----------------
// Parked mid-avenue at [1.5, 0, 10]. Damageable (hp 60); the mission logic
// detonates it cinematically via damageables.damage(urbanMapRefs.fuelId, 999)
// when the player crosses z ~= 14.
const FUEL_POS = [1.5, 0, 10]
function FuelTruck() {
  const [burnt, setBurnt] = useState(false)
  const smokeT = useRef(0)
  const fireMat = useMemo(() => MATS.fireGlow.clone(), [])
  useEffect(() => {
    const id = damageables.register({
      position: [FUEL_POS[0], 1.5, FUEL_POS[2]],
      radius: 3.4,
      hp: 60,
      onDeath: () => {
        const v = new THREE.Vector3(FUEL_POS[0], 1.5, FUEL_POS[2])
        fx.explosion(v, 3.2)
        fx.smoke(v.clone().add(new THREE.Vector3(0, 1.5, 0)), 2.6, 12)
        audio.explosion(1.5)
        playerRef.shake = 1
        urbanMapRefs.fuelDestroyed = true
        missionEvents.emit('fuelDestroyed')
        setBurnt(true)
      },
    })
    urbanMapRefs.fuelId = id
    return () => {
      damageables.unregister(id)
      if (urbanMapRefs.fuelId === id) urbanMapRefs.fuelId = null
    }
  }, [])
  useFrame((state, dt) => {
    if (!burnt) return
    smokeT.current += dt
    if (smokeT.current > 0.8) {
      smokeT.current = 0
      fx.smoke(
        new THREE.Vector3(
          FUEL_POS[0] + (Math.random() - 0.5) * 3, 2.6,
          FUEL_POS[2] + (Math.random() - 0.5) * 3
        ),
        1.6, 6
      )
    }
    fireMat.emissiveIntensity = 1 + Math.sin(state.clock.elapsedTime * 17) * 0.5
  })
  const cab = burnt ? MATS.burnt : MATS.carRed
  const tank = burnt ? MATS.burnt : MATS.tankShell
  const wheels = []
  for (const wx of [1.25, -1.25]) for (const wz of [3.4, 0.5, -2.5]) wheels.push([wx, wz])
  return (
    <RigidBody type="fixed" colliders={false} position={FUEL_POS} rotation={[0, 0.15, 0]}>
      <CuboidCollider args={[1.6, 1.9, 4.8]} position={[0, 1.9, 0]} />
      <mesh geometry={GEO.box} material={burnt ? MATS.burnt : MATS.darkMetal}
        scale={[2.4, 0.5, 9.2]} position={[0, 0.8, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.box} material={cab} scale={[2.5, 2.3, 2.2]} position={[0, 1.95, 3.4]} castShadow />
      <mesh geometry={GEO.box} material={burnt ? MATS.burnt : MATS.glassDark}
        scale={[2.1, 0.8, 0.15]} position={[0, 2.4, 4.45]} />
      <mesh geometry={GEO.cyl} material={tank} scale={[2.6, 5.6, 2.6]}
        rotation={[Math.PI / 2, 0, 0]} position={[0, 2.1, -1.2]} castShadow receiveShadow />
      <mesh geometry={GEO.cyl} material={burnt ? MATS.burnt : MATS.metal} scale={[2.66, 0.3, 2.66]}
        rotation={[Math.PI / 2, 0, 0]} position={[0, 2.1, 0.4]} />
      {wheels.map(([wx, wz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MATS.tire} scale={[0.9, 0.35, 0.9]}
          rotation={[0, 0, Math.PI / 2]} position={[wx, 0.45, wz]} castShadow />
      ))}
      {burnt && (
        <mesh geometry={GEO.plane} material={fireMat} scale={[2.2, 4.5]}
          rotation={[-Math.PI / 2, 0, 0]} position={[0, 3.45, -1.2]} />
      )}
    </RigidBody>
  )
}

// ---------------- tower ----------------
// Footprint x in [-12,12], z in [-30,-50]. Three interior levels:
//   lobby  y=0 (ground), floor2 slab top y=4, floor3 slab top y=8, roof y=12.
// Breached entrance on the south wall: x in [-2.8,2.8], opening y in [0,3].
function TowerShell() {
  return (
    <group>
      {/* south wall (z=-30): west / east / lintel over the breach */}
      <Solid p={[-7.4, 6, -30]} s={[9.2, 12, 0.6]} m={MATS.towerWall} />
      <Solid p={[7.4, 6, -30]} s={[9.2, 12, 0.6]} m={MATS.towerWall} />
      <Solid p={[0, 7.5, -30]} s={[5.6, 9, 0.6]} m={MATS.towerTrim} />
      {/* north / west / east walls */}
      <Solid p={[0, 6, -50]} s={[24.6, 12, 0.6]} m={MATS.towerWall} />
      <Solid p={[-12, 6, -40]} s={[0.6, 12, 20.6]} m={MATS.towerWall} />
      <Solid p={[12, 6, -40]} s={[0.6, 12, 20.6]} m={MATS.towerWall} />
      {/* roof slab (visual cap; collider blocks stray grenades) */}
      <Solid p={[0, 12.25, -40]} s={[25, 0.5, 21]} m={MATS.towerTrim} />
      {/* breach rubble flanking the entrance (walk path kept clear) */}
      <Rubble x={-2.6} z={-29.2} seed={71} r={1.4} n={6} />
      <Rubble x={2.6} z={-30.8} seed={83} r={1.4} n={6} />
      <Rubble x={0.5} z={-31.5} seed={97} r={1.8} n={5} />
      {/* broken windows on the south face */}
      {[-8, -4, 4, 8].map((wx) =>
        [2.2, 6.2, 10.2].map((wy) => (
          <mesh key={`${wx}${wy}`} geometry={GEO.plane} material={MATS.windowDark}
            position={[wx, wy, -29.66]} scale={[2.2, 1.8, 1]} />
        ))
      )}
      <mesh geometry={GEO.plane} material={MATS.windowLit} position={[4, 10.2, -29.62]} scale={[2.2, 1.8, 1]} />
    </group>
  )
}
// Floor slabs: EVERY floor gets its own collider slab so player/enemies stand on it.
// Cutouts leave the ramp wells open (see RampShafts).
function FloorSlabs() {
  return (
    <group>
      {/* floor 2, top y=4 */}
      <Solid p={[0, 3.8, -46.5]} s={[24, 0.4, 7]} m={MATS.towerTrim} />        {/* S1 north strip */}
      <Solid p={[1.65, 3.8, -36.5]} s={[20.7, 0.4, 13]} m={MATS.towerTrim} />  {/* S2 east of ramp1 well */}
      <Solid p={[-10.35, 3.8, -32.5]} s={[3.3, 0.4, 5]} m={MATS.towerTrim} />  {/* S3 over shaft entry */}
      {/* floor 3, top y=8 */}
      <Solid p={[0, 7.8, -46.5]} s={[24, 0.4, 7]} m={MATS.towerTrim} />        {/* T1 north strip */}
      <Solid p={[-1.65, 7.8, -39]} s={[20.7, 0.4, 8]} m={MATS.towerTrim} />    {/* T1b west of ramp2 well */}
      <Solid p={[11.65, 7.8, -39]} s={[0.7, 0.4, 8]} m={MATS.towerTrim} />     {/* T1c east sliver */}
      <Solid p={[0, 7.8, -32.5]} s={[24, 0.4, 5]} m={MATS.towerTrim} />        {/* T2 south strip */}
    </group>
  )
}
// Ramps + enclosing shaft walls + guard rails around the floor wells.
function RampShafts() {
  return (
    <group>
      {/* ramp 1: lobby (y=0) -> floor 2 (y=4), x=-10 */}
      <Ramp x={-10} y0={0} z0={-35} dir={1} />
      <Solid p={[-11.55, 2, -39]} s={[0.3, 4, 8.4]} m={MATS.towerWall} />
      <Solid p={[-8.45, 2, -39]} s={[0.3, 4, 8.4]} m={MATS.towerWall} />
      {/* guard rails around the floor-2 well */}
      <Solid p={[-11.55, 4.55, -39]} s={[0.24, 1.1, 8.4]} m={MATS.metal} />
      <Solid p={[-8.45, 4.55, -39]} s={[0.24, 1.1, 8.4]} m={MATS.metal} />
      <Solid p={[-10, 4.55, -34.9]} s={[3.4, 1.1, 0.24]} m={MATS.metal} />
      {/* ramp 2: floor 2 (y=4) -> floor 3 (y=8), x=+10 */}
      <Ramp x={10} y0={4} z0={-43} dir={-1} />
      <Solid p={[8.45, 6, -39]} s={[0.3, 4, 8.4]} m={MATS.towerWall} />
      <Solid p={[11.55, 6, -39]} s={[0.3, 4, 8.4]} m={MATS.towerWall} />
      {/* guard rails around the floor-3 well (south edge is the ramp exit: open) */}
      <Solid p={[8.45, 8.55, -39]} s={[0.24, 1.1, 8.4]} m={MATS.metal} />
      <Solid p={[11.55, 8.55, -39]} s={[0.24, 1.1, 8.4]} m={MATS.metal} />
    </group>
  )
}
function Lobby() {
  return (
    <group>
      {/* reception desk (cover) */}
      <Solid p={[-5, 0.55, -42]} s={[4, 1.1, 1]} m={MATS.desk} />
      <P p={[-5, 1.15, -42]} s={[4.2, 0.08, 1.2]} m={MATS.towerTrim} cast={false} />
      {/* pillars */}
      {[-6, 6].map((px) =>
        [-36, -42, -48].map((pz) => (
          <Solid key={`${px}${pz}`} p={[px, 2, pz]} s={[0.8, 4, 0.8]} m={MATS.concrete} />
        ))
      )}
      {/* collapsed ceiling debris */}
      <Rubble x={6} z={-33} seed={101} r={2.4} n={8} />
      <Rubble x={-3} z={-47} seed={113} r={2.0} n={6} />
      {/* toppled directory board */}
      <P p={[3.5, 0.5, -38]} s={[2.2, 1.4, 0.12]} m={MATS.windowDark} ry={0.5} rx={-1.1} />
    </group>
  )
}
function Floor2() {
  return (
    <group>
      {/* cubicle dividers (cover), y base = 4 */}
      <Solid p={[-3, 4.75, -40]} s={[6, 1.5, 0.15]} m={MATS.cubicle} />
      <Solid p={[3, 4.75, -40]} s={[6, 1.5, 0.15]} m={MATS.cubicle} />
      <Solid p={[-3, 4.75, -44]} s={[6, 1.5, 0.15]} m={MATS.cubicle} />
      <Solid p={[3, 4.75, -44]} s={[6, 1.5, 0.15]} m={MATS.cubicle} />
      <Solid p={[0, 4.75, -42]} s={[0.15, 1.5, 4.15]} m={MATS.cubicle} />
      <Solid p={[-6, 4.75, -42]} s={[0.15, 1.5, 4.15]} m={MATS.cubicle} />
      <Solid p={[6, 4.75, -42]} s={[0.15, 1.5, 4.15]} m={MATS.cubicle} />
      {/* desks inside the cubicles (visual) */}
      <P p={[-3, 4.4, -42]} s={[2.2, 0.12, 1]} m={MATS.desk} cast={false} />
      <P p={[3, 4.4, -42]} s={[2.2, 0.12, 1]} m={MATS.desk} cast={false} />
      <P p={[-3, 4.4, -38.6]} s={[2.2, 0.12, 1]} m={MATS.desk} cast={false} />
      {/* scattered office clutter */}
      <Rubble x={-8} z={-47} seed={127} r={1.8} n={5} />
      <P p={[8, 4.15, -46]} s={[1.6, 0.3, 1.1]} m={MATS.desk} ry={0.7} />
    </group>
  )
}
// Decorative allied soldier: crouched, olive uniform. NO AI, NO registry.
function FriendlySoldier({ p, ry = 0 }) {
  return (
    <group position={p} rotation={[0, ry, 0]} userData={{ baseY: p[1] }}>
      <mesh geometry={GEO.box} material={MATS.oliveDark} scale={[0.42, 0.34, 0.4]} position={[0, 0.2, 0.1]} castShadow />
      <mesh geometry={GEO.box} material={MATS.olive} scale={[0.44, 0.52, 0.3]} position={[0, 0.58, -0.02]} rotation={[0.15, 0, 0]} castShadow />
      <mesh geometry={GEO.sphere} material={MATS.skin} scale={[0.15, 0.17, 0.15]} position={[0, 0.95, 0.03]} />
      <mesh geometry={GEO.box} material={MATS.helmet} scale={[0.26, 0.13, 0.28]} position={[0, 1.03, 0.03]} castShadow />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.07, 0.07, 0.95]} position={[0.18, 0.62, 0.32]} rotation={[0.1, 0, 0]} />
    </group>
  )
}
function AlliedTeam() {
  const g = useRef()
  // Subtle idle breathing so the squad reads as alive (decorative only).
  useFrame(({ clock }) => {
    if (!g.current) return
    const t = clock.elapsedTime
    g.current.children.forEach((c, i) => {
      c.position.y = c.userData.baseY + Math.sin(t * 1.8 + i * 2.1) * 0.025
    })
  })
  return (
    <group ref={g}>
      <FriendlySoldier p={[6, 8, -44.5]} ry={2.7} />
      <FriendlySoldier p={[9.5, 8, -47.5]} ry={-0.7} />
      <FriendlySoldier p={[5.2, 8, -48.2]} ry={1.3} />
    </group>
  )
}
function Floor3() {
  return (
    <group>
      {/* office dividers west of the allied room */}
      <Solid p={[-6, 9, -38]} s={[8, 2, 0.3]} m={MATS.cubicle} />
      <Solid p={[-2, 9, -44]} s={[0.3, 2, 8]} m={MATS.cubicle} />
      <P p={[-7, 8.4, -42]} s={[2.2, 0.12, 1]} m={MATS.desk} cast={false} />
      <P p={[-5, 8.4, -46]} s={[1.8, 0.12, 1]} m={MATS.desk} cast={false} ry={0.4} />
      {/* ---- allied-team room: x in [4,12], z in [-50,-42] ---- */}
      <Solid p={[4, 10, -46]} s={[0.5, 4, 8]} m={MATS.towerWall} />          {/* west wall */}
      <Solid p={[5.5, 10, -42]} s={[3, 4, 0.5]} m={MATS.towerWall} />        {/* south wall, west of door */}
      <Solid p={[10.1, 10, -42]} s={[3.8, 4, 0.5]} m={MATS.towerWall} />     {/* south wall, east of door */}
      {/* barricaded door visual: sandbag stacks flanking a 1.2m walkable gap */}
      <Solid p={[6.85, 8.35, -41.85]} s={[0.5, 0.7, 1.1]} m={MATS.sandbag} />
      <Solid p={[8.35, 8.35, -42.15]} s={[0.5, 0.7, 1.1]} m={MATS.sandbag} />
      <P p={[6.85, 8.85, -41.85]} s={[0.45, 0.35, 1.0]} m={MATS.sandbag} cast={false} />
      <P p={[7.6, 8.5, -42.6]} s={[1.1, 1.0, 0.1]} m={MATS.desk} ry={0.35} rx={0.25} />
      {/* room cover: crates + tipped table (defensible during the 90s hold) */}
      <Solid p={[10, 8.5, -48]} s={[1, 1, 1]} m={MATS.desk} />
      <Solid p={[11, 8.5, -48.2]} s={[1, 1, 1]} m={MATS.desk} ry={0.3} />
      <Solid p={[10.4, 9.4, -48.1]} s={[0.9, 0.9, 0.9]} m={MATS.desk} ry={0.5} />
      <P p={[6, 8.35, -45.5]} s={[1.9, 0.7, 1.1]} m={MATS.desk} ry={0.2} />
      <AlliedTeam />
    </group>
  )
}
function Tower() {
  return (
    <group>
      <TowerShell />
      <FloorSlabs />
      <RampShafts />
      <Lobby />
      <Floor2 />
      <Floor3 />
    </group>
  )
}

// ---------------- helicopter (CINEMATIC #1) ----------------
// Parked far away (invisible) until 'heliInbound': flies a low path down the
// avenue BETWEEN the buildings, then hovers at [0, 6, -20] in front of the
// tower with its searchlight on. 'heliDepart' (mission complete): ascends and
// flies off north.
const HELI_WAYPOINTS = [
  [80, 40, 140],  // parked start (far south-east, out of sight)
  [40, 25, 80],   // approach over the rooftops
  [10, 12, 40],   // drop into the avenue canyon
  [0, 7, 0],      // low run up the avenue, between the buildings
  [0, 6, -20],    // hover point: avenue in front of the tower
]
const HOVER_POS = [0, 6, -20]
function angLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}
function Helicopter() {
  const g = useRef()
  const mainRotor = useRef()
  const tailRotor = useRef()
  const rotorDisc = useRef()
  const navL = useRef()
  const navR = useRef()
  const cone = useRef()
  const spot = useRef()
  const spotTarget = useRef()
  const st = useRef({ phase: 'parked', wp: 1, t: 0, spin: 0, light: 0 })
  const wps = useMemo(() => HELI_WAYPOINTS.map((w) => new THREE.Vector3(...w)), [])
  const navRedMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 2 }), [])
  const navGrnMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0x003300, emissive: 0x22ff44, emissiveIntensity: 2 }), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (spot.current && spotTarget.current) spot.current.target = spotTarget.current
    const off1 = missionEvents.on('heliInbound', () => {
      const s = st.current
      if (s.phase !== 'parked') return
      s.phase = 'inbound'
      s.wp = 1
      g.current.visible = true
      audio.helicopter()
    })
    const off2 = missionEvents.on('heliDepart', () => {
      const s = st.current
      if (s.phase !== 'inbound' && s.phase !== 'hover') return
      s.phase = 'depart'
      s.t = 0
      urbanMapRefs.heliArrived = false
      audio.stopHeli()
    })
    return () => {
      off1()
      off2()
      audio.stopHeli()
    }
  }, [])

  useFrame((state, dt) => {
    const s = st.current
    if (!g.current) return
    const t = state.clock.elapsedTime
    // rotor spin-up / spin-down
    const targetSpin = s.phase === 'parked' || s.phase === 'gone' ? 0 : 26
    s.spin += (targetSpin - s.spin) * Math.min(1, dt * 1.1)
    if (mainRotor.current) mainRotor.current.rotation.y += s.spin * dt
    if (tailRotor.current) tailRotor.current.rotation.x += s.spin * 2.4 * dt
    if (rotorDisc.current) rotorDisc.current.material.opacity = (s.spin / 26) * 0.14
    // nav light blink
    const blink = Math.sin(t * 7) > 0 ? 2.4 : 0.15
    navRedMat.emissiveIntensity = blink
    navGrnMat.emissiveIntensity = Math.sin(t * 7 + Math.PI) > 0 ? 2.4 : 0.15
    // searchlight fade
    const lightTarget = s.phase === 'hover' ? 1 : 0
    s.light += (lightTarget - s.light) * Math.min(1, dt * 2)
    if (spot.current) spot.current.intensity = s.light * 260
    if (cone.current) cone.current.visible = s.light > 0.03

    const pos = g.current.position
    if (s.phase === 'inbound') {
      const target = wps[s.wp]
      tmp.copy(target).sub(pos)
      const dist = tmp.length()
      if (dist < 1.4) {
        s.wp += 1
        if (s.wp >= wps.length) {
          s.phase = 'hover'
          s.t = 0
          urbanMapRefs.heliArrived = true
        }
      } else {
        tmp.normalize()
        pos.addScaledVector(tmp, Math.min(dist, 20 * dt))
        g.current.rotation.y = angLerp(g.current.rotation.y, Math.atan2(tmp.x, tmp.z), Math.min(1, dt * 3))
      }
    } else if (s.phase === 'hover') {
      s.t += dt
      pos.set(HOVER_POS[0], HOVER_POS[1] + Math.sin(s.t * 1.6) * 0.25, HOVER_POS[2])
      g.current.rotation.y = angLerp(g.current.rotation.y, 0, Math.min(1, dt * 2)) // nose south, toward the player
      g.current.rotation.z = Math.sin(s.t * 1.1) * 0.02
    } else if (s.phase === 'depart') {
      s.t += dt
      if (s.t < 3) {
        pos.y += dt * 10 // ascend
      } else {
        pos.y += dt * 4
        pos.z -= dt * 32 // fly off north
      }
      g.current.rotation.y = angLerp(g.current.rotation.y, Math.PI, Math.min(1, dt * 2))
      if (pos.z < -170 || pos.y > 90) {
        s.phase = 'gone'
        g.current.visible = false
      }
    }
  })

  return (
    <group ref={g} position={[80, 40, 140]} visible={false}>
      {/* fuselage */}
      <mesh geometry={GEO.box} material={MATS.heliBody} scale={[2.4, 1.9, 5.2]} castShadow />
      <mesh geometry={GEO.box} material={MATS.glassDark} scale={[2.0, 1.15, 1.5]} position={[0, 0.3, 2.9]} />
      <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[2.42, 0.5, 5.22]} position={[0, -0.75, 0]} />
      {/* tail boom + fin + tail rotor */}
      <mesh geometry={GEO.box} material={MATS.heliBody} scale={[0.55, 0.55, 6.5]} position={[0, 0.5, -5.6]} castShadow />
      <mesh geometry={GEO.box} material={MATS.heliBody} scale={[0.25, 1.7, 1.0]} position={[0, 1.35, -8.6]} />
      <group ref={tailRotor} position={[0.28, 1.35, -8.6]}>
        <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.08, 2.3, 0.32]} />
      </group>
      {/* main rotor */}
      <mesh geometry={GEO.cyl} material={MATS.darkMetal} scale={[0.3, 1.0, 0.3]} position={[0, 1.4, 0]} />
      <group ref={mainRotor} position={[0, 1.95, 0]}>
        <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[11.5, 0.09, 0.55]} />
        <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.55, 0.09, 11.5]} />
      </group>
      <mesh ref={rotorDisc} geometry={discGeo} material={discMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.95, 0]} />
      {/* landing skids */}
      {[-1.15, 1.15].map((sx) => (
        <group key={sx}>
          <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.18, 0.18, 4.8]} position={[sx, -1.4, 0]} />
          <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.14, 1.0, 0.14]} position={[sx, -0.9, 1.5]} />
          <mesh geometry={GEO.box} material={MATS.darkMetal} scale={[0.14, 1.0, 0.14]} position={[sx, -0.9, -1.5]} />
        </group>
      ))}
      {/* nav lights */}
      <mesh ref={navL} geometry={GEO.sphere} material={navRedMat} scale={[0.15, 0.15, 0.15]} position={[-1.25, 0.25, 1.8]} />
      <mesh ref={navR} geometry={GEO.sphere} material={navGrnMat} scale={[0.15, 0.15, 0.15]} position={[1.25, 0.25, 1.8]} />
      {/* searchlight cone + spotlight (no shadow) */}
      <mesh ref={cone} geometry={coneGeo} material={coneMat} position={[0, -7.5, 1.2]} visible={false} />
      <spotLight ref={spot} color="#ffedb8" intensity={0} distance={50} angle={0.3}
        penumbra={0.6} decay={1.6} position={[0, -1, 1.2]} />
      <object3D ref={spotTarget} position={[0, -16, 1.2]} />
    </group>
  )
}

// ---------------- rain ----------------
// Cheap line-segment rain in a 70x30x70 volume that follows the player.
function Rain() {
  const ref = useRef()
  const N = 550
  const { positions, drops } = useMemo(() => {
    const positions = new Float32Array(N * 6)
    const drops = []
    for (let i = 0; i < N; i++) {
      const d = {
        x: (Math.random() - 0.5) * 70,
        y: Math.random() * 30,
        z: (Math.random() - 0.5) * 70,
        s: 24 + Math.random() * 10,
      }
      drops.push(d)
      positions[i * 6] = d.x; positions[i * 6 + 1] = d.y; positions[i * 6 + 2] = d.z
      positions[i * 6 + 3] = d.x + 0.12; positions[i * 6 + 4] = d.y - 0.9; positions[i * 6 + 5] = d.z
    }
    return { positions, drops }
  }, [])
  useFrame((_, dt) => {
    if (!ref.current) return
    const arr = ref.current.geometry.attributes.position.array
    for (let i = 0; i < N; i++) {
      const d = drops[i]
      d.y -= d.s * dt
      if (d.y < 0) {
        d.y = 30
        d.x = (Math.random() - 0.5) * 70
        d.z = (Math.random() - 0.5) * 70
      }
      arr[i * 6] = d.x; arr[i * 6 + 1] = d.y; arr[i * 6 + 2] = d.z
      arr[i * 6 + 3] = d.x + 0.12; arr[i * 6 + 4] = d.y - 0.9; arr[i * 6 + 5] = d.z
    }
    ref.current.geometry.attributes.position.needsUpdate = true
    ref.current.position.set(playerRef.position.x, 0, playerRef.position.z)
  })
  return (
    <lineSegments ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#8fa3bf" transparent opacity={0.32} />
    </lineSegments>
  )
}

// ---------------- evac markers ----------------
// Green glow pads under the helicopter hover zone, shown during the final objective.
function ExtractionMarkers() {
  const show = useGame((s) => s.objectiveIndex >= s.objectives.length - 1 && s.objectives.length > 0)
  const pulse = useRef()
  useFrame(({ clock }) => {
    if (pulse.current) {
      const t = clock.getElapsedTime()
      pulse.current.children.forEach((m, i) => {
        m.material.emissiveIntensity = 0.9 + Math.sin(t * 4 + i * Math.PI) * 0.4
      })
    }
  })
  if (!show) return null
  // NOTE: mutating the shared glowGreen material's emissiveIntensity here matches the
  // DesertStrike pattern (its pads are the only users of the material).
  return (
    <group ref={pulse}>
      {[-2.5, 2.5].map((x) => (
        <mesh key={x} geometry={GEO.cyl} material={MATS.glowGreen}
          scale={[0.9, 0.1, 0.9]} position={[x, 0.06, -20]} />
      ))}
    </group>
  )
}

// ---------------- spawns & covers ----------------
// EnemyManager reads these via spawnApi (no props). Floor-2/3 spawns use
// type 'roof' so the enemy keeps its spawn y (roof type never falls).
const SPAWNS = [
  // avenue (6) — fighting between the wrecks
  { pos: [-3.5, 0.2, 44], patrol: [[-5, 42], [-2, 46]] },
  { pos: [4, 0.2, 36], patrol: [[2, 34], [6, 38]] },
  { pos: [-4.5, 0.2, 26], patrol: [[-6, 24], [-3, 28]] },
  { pos: [3, 0.2, 18], patrol: [[1, 16], [5, 20]] },
  { pos: [-2, 0.2, 4], patrol: [[-4, 2], [0, 6]] },
  { pos: [5, 0.2, -8], patrol: [[3, -10], [7, -6]] },
  // lobby (2)
  { pos: [-6, 0.2, -38], patrol: [[-8, -36], [-4, -40]] },
  { pos: [5, 0.2, -44], patrol: [[3, -42], [7, -46]] },
  // floor 2 (3)
  { pos: [-9, 4.2, -47], patrol: [[-10, -45], [-4, -48]], type: 'roof' },
  { pos: [2, 4.2, -47], patrol: [[0, -45], [4, -48]], type: 'roof' },
  { pos: [8, 4.2, -34], patrol: [[7, -32], [9, -36]], type: 'roof' },
  // floor 3 (4)
  { pos: [-8, 8.2, -34], patrol: [[-10, -32], [-6, -35]], type: 'roof' },
  { pos: [0, 8.2, -47], patrol: [[-1, -45], [1, -48]], type: 'roof' },
  { pos: [-8, 8.2, -45], patrol: [[-10, -43], [-6, -47]], type: 'roof' },
  { pos: [6, 8.2, -37], patrol: [[5, -35], [7, -39]], type: 'roof' },
]
const COVERS = [
  // avenue: wrecks + barricades
  [-4.8, 42.5], [5.2, 34.5], [-3.6, 31.5], [-5.8, 24.5], [4.2, 16.5],
  [4.6, 38.5], [2.2, 9], [-2.5, -5.5], [-3.2, 2.5], [6.2, -9.5],
  // lobby: reception desk + pillars
  [-6.5, -40.5], [-3.5, -43.5], [-6, -37.5], [6, -43.5],
  // floor 2: cubicles
  [-4, -41.5], [0, -39], [4, -42.5], [-2, -38.5], [8, -33],
  // floor 3: offices + allied room
  [-6, -36.5], [0, -45.5], [-8, -43.5], [6, -43], [9, -46.5],
  // ramp exits
  [-10, -44.5], [10, -33.5],
]

// Reinforcement plan (executed by MissionManager via enemyRegistry.requestSpawn):
// - objective 'defend' (index 6) starts -> waves of 2-3 avenue/floor hostiles converging
//   on the tower: {pos:[0,0.2,-24]}, {pos:[-4,0.2,-26]}, {pos:[4,0.2,-26]} etc.
// - 'heliInbound' emitted when the defend timer ends; 'heliDepart' on mission complete.

// ---------------- map root ----------------
export default function UrbanBlackout() {
  useEffect(() => {
    urbanMapRefs.fuelId = null
    urbanMapRefs.fuelDestroyed = false
    urbanMapRefs.heliArrived = false
    spawnApi.set(SPAWNS, COVERS)
  }, [])
  return (
    <group>
      <color attach="background" args={['#05080f']} />
      <fog attach="fog" args={['#0b1424', 35, 200]} />
      {/* moon: the single shadow-casting light */}
      <directionalLight color="#8aa8d8" intensity={1.7} position={[45, 70, -10]} castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-75} shadow-camera-right={75}
        shadow-camera-top={75} shadow-camera-bottom={-75}
        shadow-camera-near={1} shadow-camera-far={220}
        shadow-bias={-0.0004} />
      <hemisphereLight skyColor="#2a3a5a" groundColor="#0a0c12" intensity={1.0} />
      <Ground />
      <Bounds />
      <Avenue />
      <FuelTruck />
      <Tower />
      <Helicopter />
      <Rain />
      <ExtractionMarkers />
    </group>
  )
}
