// WeaponView: procedural first-person gun models (boxes/cylinders, no external
// assets). The group is positioned from the camera every frame at the scene root.
// Animations: idle bob/sway, ADS centering, recoil kick, sprint-lowered pose,
// reload dip+roll, and a 45ms muzzle flash on every shot.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'
import { playerRef } from '../player/playerRef.js'

const GUNMETAL = '#2a2c30'
const DARK = '#17181b'
const GRIP = '#202226'
const ACCENTS = { AR7: '#8a7a5a', KX9: '#4a6a8a', M12: '#7a5238', VX: '#5a6a42' }
// barrel-tip position per weapon (gun local space, gun points toward -Z)
const MUZZLE = {
  AR7: [0, 0.015, -0.9],
  KX9: [0, 0.01, -0.58],
  M12: [0, 0.025, -0.86],
  VX: [0, 0.02, -1.14],
}

const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()

function useMats(accent) {
  const mats = useMemo(
    () => ({
      metal: new THREE.MeshStandardMaterial({ color: GUNMETAL, roughness: 0.55, metalness: 0.65 }),
      dark: new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.8, metalness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6, metalness: 0.4 }),
      grip: new THREE.MeshStandardMaterial({ color: GRIP, roughness: 0.9, metalness: 0.1 }),
    }),
    [accent]
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  return mats
}

// Box part
function B({ m, p, s, r }) {
  return (
    <mesh material={m} position={p} rotation={r || [0, 0, 0]}>
      <boxGeometry args={s} />
    </mesh>
  )
}
// Cylinder part, default aligned along Z (barrels)
function C({ m, p, rr, h, r }) {
  return (
    <mesh material={m} position={p} rotation={r || [Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[rr, rr, h, 16]} />
    </mesh>
  )
}

function GunModel({ id, flashRef }) {
  const mats = useMats(ACCENTS[id] || '#888888')
  const mz = MUZZLE[id] || [0, 0.015, -0.9]
  return (
    <group>
      {id === 'AR7' && (
        <>
          <B m={mats.metal} p={[0, 0, -0.26]} s={[0.075, 0.11, 0.44]} />
          <B m={mats.dark} p={[0, 0.005, -0.52]} s={[0.068, 0.085, 0.28]} />
          <B m={mats.accent} p={[0, -0.04, -0.52]} s={[0.07, 0.018, 0.26]} />
          <C m={mats.metal} p={[0, 0.015, -0.72]} rr={0.016} h={0.24} />
          <C m={mats.dark} p={[0, 0.015, -0.86]} rr={0.024} h={0.07} />
          <B m={mats.grip} p={[0, -0.13, -0.3]} s={[0.055, 0.17, 0.1]} r={[0.18, 0, 0]} />
          <B m={mats.grip} p={[0, -0.1, -0.1]} s={[0.05, 0.12, 0.06]} r={[0.35, 0, 0]} />
          <B m={mats.dark} p={[0, -0.01, 0.1]} s={[0.062, 0.1, 0.26]} />
          <B m={mats.dark} p={[0, 0.02, 0.24]} s={[0.05, 0.06, 0.05]} />
          <B m={mats.dark} p={[0, 0.085, -0.1]} s={[0.032, 0.055, 0.06]} />
          <B m={mats.accent} p={[0, 0.062, -0.26]} s={[0.04, 0.015, 0.3]} />
          <B m={mats.dark} p={[0, 0.062, -0.68]} s={[0.014, 0.045, 0.014]} />
        </>
      )}
      {id === 'KX9' && (
        <>
          <B m={mats.metal} p={[0, 0, -0.18]} s={[0.07, 0.1, 0.32]} />
          <C m={mats.dark} p={[0, 0.01, -0.44]} rr={0.028} h={0.24} />
          <C m={mats.metal} p={[0, 0.01, -0.33]} rr={0.014} h={0.06} />
          <B m={mats.grip} p={[0, -0.115, -0.22]} s={[0.05, 0.15, 0.075]} r={[0.12, 0, 0]} />
          <B m={mats.grip} p={[0, -0.095, -0.06]} s={[0.048, 0.11, 0.055]} r={[0.35, 0, 0]} />
          <B m={mats.dark} p={[0, 0.005, 0.06]} s={[0.05, 0.07, 0.2]} />
          <B m={mats.accent} p={[0.037, 0, -0.18]} s={[0.006, 0.06, 0.2]} />
          <B m={mats.accent} p={[-0.037, 0, -0.18]} s={[0.006, 0.06, 0.2]} />
          <B m={mats.dark} p={[0, 0.06, -0.18]} s={[0.04, 0.02, 0.28]} />
          <B m={mats.dark} p={[0, 0.085, -0.1]} s={[0.03, 0.05, 0.04]} />
        </>
      )}
      {id === 'M12' && (
        <>
          <B m={mats.metal} p={[0, 0, -0.22]} s={[0.075, 0.1, 0.4]} />
          <C m={mats.metal} p={[0, 0.025, -0.56]} rr={0.024} h={0.5} />
          <C m={mats.dark} p={[0, 0.025, -0.82]} rr={0.028} h={0.05} />
          <C m={mats.dark} p={[0, -0.035, -0.5]} rr={0.02} h={0.42} />
          <B m={mats.grip} p={[0, -0.035, -0.52]} s={[0.08, 0.055, 0.2]} />
          <B m={mats.accent} p={[0, -0.035, -0.62]} s={[0.082, 0.02, 0.06]} />
          <B m={mats.grip} p={[0, -0.1, -0.08]} s={[0.05, 0.12, 0.06]} r={[0.35, 0, 0]} />
          <B m={mats.dark} p={[0, -0.01, 0.12]} s={[0.06, 0.1, 0.24]} />
          <B m={mats.dark} p={[0, 0.07, -0.14]} s={[0.02, 0.03, 0.1]} />
        </>
      )}
      {id === 'VX' && (
        <>
          <B m={mats.metal} p={[0, 0, -0.28]} s={[0.068, 0.1, 0.52]} />
          <C m={mats.metal} p={[0, 0.02, -0.8]} rr={0.014} h={0.58} />
          <C m={mats.dark} p={[0, 0.02, -1.1]} rr={0.02} h={0.06} />
          <B m={mats.dark} p={[0, 0.005, -0.6]} s={[0.06, 0.07, 0.34]} />
          <C m={mats.dark} p={[0, 0.105, -0.3]} rr={0.032} h={0.24} />
          <C m={mats.accent} p={[0, 0.105, -0.43]} rr={0.034} h={0.02} />
          <B m={mats.dark} p={[0, 0.06, -0.24]} s={[0.02, 0.05, 0.03]} />
          <B m={mats.dark} p={[0, 0.06, -0.36]} s={[0.02, 0.05, 0.03]} />
          <B m={mats.grip} p={[0, -0.1, -0.28]} s={[0.05, 0.11, 0.09]} r={[0.15, 0, 0]} />
          <B m={mats.dark} p={[0, 0.01, 0.12]} s={[0.06, 0.12, 0.28]} />
          <B m={mats.accent} p={[0, 0.085, 0.12]} s={[0.062, 0.02, 0.2]} />
          <B m={mats.dark} p={[0, -0.06, -0.72]} s={[0.012, 0.12, 0.012]} r={[0.3, 0, 0]} />
        </>
      )}
      {/* muzzle flash: additive crossed planes, shown 45ms per shot */}
      <group position={mz} ref={flashRef} visible={false}>
        <mesh>
          <planeGeometry args={[0.32, 0.32]} />
          <meshBasicMaterial
            color="#ffd9a0"
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.32, 0.32]} />
          <meshBasicMaterial
            color="#ff9a5a"
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  )
}

export default function WeaponView() {
  const camera = useThree((s) => s.camera)
  const currentWeapon = useGame((s) => s.currentWeapon)
  const reloading = useGame((s) => s.reloading)
  const group = useRef()
  const flash = useRef()
  const kick = useRef(0)
  const flashUntil = useRef(0)
  const bobPhase = useRef(0)
  const sway = useRef({ x: 0, y: 0 })
  const sprintBlend = useRef(0)
  const reloadBlend = useRef(0)
  const reloadRef = useRef(reloading)
  reloadRef.current = reloading

  // mouse sway (gun lags behind fast mouse movement)
  useEffect(() => {
    const onMove = (e) => {
      if (!document.pointerLockElement) return
      sway.current.x = THREE.MathUtils.clamp(sway.current.x + e.movementX, -60, 60)
      sway.current.y = THREE.MathUtils.clamp(sway.current.y + e.movementY, -60, 60)
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  // recoil kick + muzzle flash on every shot
  useEffect(
    () =>
      useGame.subscribe((s) => s.ev.shoot, (n, p) => {
        if (n > p) {
          kick.current = 1
          flashUntil.current = performance.now() + 45
          if (flash.current) flash.current.scale.setScalar(0.8 + Math.random() * 0.5)
        }
      }),
    []
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const grp = group.current
    if (!grp) return
    const blend = playerRef.adsBlend

    // idle bob from player speed
    const hs = Math.hypot(playerRef.velocity.x, playerRef.velocity.z)
    if (playerRef.onGround && hs > 0.5) bobPhase.current += dt * (2 + hs)
    const bAmt = (1 - blend * 0.85) * Math.min(1, hs / 4)
    const bx = Math.cos(bobPhase.current * 0.5) * 0.012 * bAmt
    const by = Math.sin(bobPhase.current) * 0.009 * bAmt

    // decays
    kick.current = THREE.MathUtils.damp(kick.current, 0, 11, dt)
    sway.current.x = THREE.MathUtils.damp(sway.current.x, 0, 9, dt)
    sway.current.y = THREE.MathUtils.damp(sway.current.y, 0, 9, dt)
    sprintBlend.current = THREE.MathUtils.damp(sprintBlend.current, playerRef.sprinting ? 1 : 0, 8, dt)
    reloadBlend.current = THREE.MathUtils.damp(reloadBlend.current, reloadRef.current ? 1 : 0, 6, dt)

    const sb = sprintBlend.current
    const rb2 = reloadBlend.current
    const px = THREE.MathUtils.lerp(0.28, 0, blend) + bx + sb * 0.07
    const py = THREE.MathUtils.lerp(-0.27, -0.155, blend) + by - sb * 0.1 - rb2 * 0.14
    const pz = THREE.MathUtils.lerp(-0.55, -0.4, blend) - kick.current * 0.08

    camera.getWorldDirection(_dir)
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    grp.position
      .copy(camera.position)
      .addScaledVector(_dir, pz)
      .addScaledVector(_right, px)
      .addScaledVector(_up, py)
    grp.quaternion.copy(camera.quaternion)
    grp.rotateX(kick.current * 0.15 + rb2 * 0.4 - sb * 0.5)
    grp.rotateZ(rb2 * 0.5)
    grp.rotateY(THREE.MathUtils.clamp(-sway.current.x * 0.0016, -0.08, 0.08))
    grp.rotateX(THREE.MathUtils.clamp(-sway.current.y * 0.0012, -0.06, 0.06))

    if (flash.current) flash.current.visible = performance.now() < flashUntil.current
  })

  return (
    <group ref={group}>
      <GunModel key={currentWeapon} id={currentWeapon} flashRef={flash} />
    </group>
  )
}
