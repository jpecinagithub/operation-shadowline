// PlayerController: first-person character controller (physics body + camera).
// Owns: WASD movement, sprint/crouch/jump, mouse look w/ pointer lock, head bob,
// FOV kick, screen shake, footsteps, HP regen, F-to-interact, Esc-to-pause.
// Writes playerRef every frame. ADS state is owned by WeaponSystem (it reads RMB);
// this controller only reads playerRef.ads for speed/FOV/bob scaling.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'
import { playerRef } from './playerRef.js'
import { MISSIONS } from '../missions/missionData.js'
import { interactables } from '../systems/interactables.js'
import { audio } from '../systems/AudioManager.js'

/** Shared with WeaponSystem so hitscan rays can exclude the player's own capsule. */
export const playerPhysics = { collider: null }

const EYE_STAND = 1.62
const EYE_CROUCH = 1.08
const WALK = 5.2
const SPRINT = 7.5
const CROUCH_SPD = 2.6
const ADS_SPD = 3.4
const JUMP_VEL = 7.2
const MOUSE = 0.0022

// Yaw convention: horizontal forward = (sin(yaw), 0, cos(yaw)).
// spawnYaw = PI therefore faces -Z, matching the MISSIONS spawnYaw comments.
// Camera rotation.y = yaw + PI with order 'YXZ' realizes exactly this forward.
const _right = new THREE.Vector3()

export default function PlayerController() {
  const rb = useRef(null)
  const { gl, camera } = useThree()
  const { world, rapier } = useRapier()
  const keys = useRef({})
  const jumpBuf = useRef(-1e9)
  const bobPhase = useRef(0)
  const stepAcc = useRef(0)
  const sprintM = useRef(false)
  const crouchM = useRef(false)
  const rayRef = useRef(null)

  const mission = useGame.getState().mission
  const def = MISSIONS[mission] || MISSIONS.desert

  // ---- spawn ----
  useEffect(() => {
    playerRef.reset(def.spawn[0], def.spawn[1], def.spawn[2], def.spawnYaw)
    const body = rb.current
    if (body) {
      body.setTranslation({ x: def.spawn[0], y: def.spawn[1], z: def.spawn[2] }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      try {
        playerPhysics.collider = body.collider(0)
      } catch {
        playerPhysics.collider = null
      }
    }
    camera.rotation.order = 'YXZ'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- input ----
  useEffect(() => {
    const canvas = gl.domElement
    const onClick = () => {
      if (useGame.getState().status !== 'playing') return
      if (document.pointerLockElement) return
      audio.init()
      audio.resume()
      try {
        const p = canvas.requestPointerLock()
        if (p && p.catch) p.catch(() => {})
      } catch {
        /* pointer lock unavailable */
      }
    }
    const onMouseMove = (e) => {
      if (document.pointerLockElement !== canvas) return
      const s = useGame.getState()
      if (s.status !== 'playing') return
      const sens = MOUSE * (s.settings?.sensitivity ?? 1) * (playerRef.ads ? 0.65 : 1)
      playerRef.yaw -= e.movementX * sens
      playerRef.pitch = THREE.MathUtils.clamp(playerRef.pitch - e.movementY * sens, -1.5, 1.5)
    }
    const onLockChange = () => {
      if (!document.pointerLockElement && useGame.getState().status === 'playing') {
        useGame.getState().pause()
      }
    }
    const GAME_KEYS = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
      'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'KeyF',
    ])
    const onKeyDown = (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault()
      if (e.repeat) return
      keys.current[e.code] = true
      if (useGame.getState().status !== 'playing') return
      if (e.code === 'Space') jumpBuf.current = performance.now()
      if (e.code === 'KeyF') {
        const it = interactables.nearest(playerRef.position)
        if (it) {
          try {
            it.onInteract()
          } catch {
            /* map-owned handler */
          }
          useGame.getState().emit('interact')
        }
      }
    }
    const onKeyUp = (e) => {
      keys.current[e.code] = false
    }
    const onBlur = () => {
      keys.current = {}
    }
    canvas.addEventListener('click', onClick)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onLockChange)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [gl])

  // hurt feedback: sound + shake kick
  useEffect(
    () =>
      useGame.subscribe((s) => s.ev.hurt, (n, p) => {
        if (n > p) {
          audio.hurt()
          playerRef.shake = Math.min(1, playerRef.shake + 0.3)
        }
      }),
    []
  )

  // leave pointer lock when the game stops being playable (pause/death/complete menus)
  useEffect(
    () =>
      useGame.subscribe((s) => s.status, (st) => {
        if (st !== 'playing' && document.pointerLockElement) document.exitPointerLock()
      }),
    []
  )

  // ---- per-frame ----
  // Priority -1: camera must be final before WeaponView reads it.
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    const body = rb.current
    if (!body) return
    if (g.status !== 'playing') return

    // stance + intent
    const k = keys.current
    const crouching = !!(k.KeyC || k.ControlLeft)
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0)
    const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0)
    const ads = playerRef.ads
    const sprinting = !!((k.ShiftLeft || k.ShiftRight) && f > 0 && !ads && !crouching)

    // ground check: ray down 1.1m, excluding own capsule
    if (!rayRef.current && rapier) {
      rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
    }
    const t0 = body.translation()
    let onGround = playerRef.onGround
    if (world && rayRef.current && playerPhysics.collider) {
      const ray = rayRef.current
      ray.origin.x = t0.x
      ray.origin.y = t0.y + 0.35
      ray.origin.z = t0.z
      const hit = world.castRay(
        ray,
        1.1,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        playerPhysics.collider
      )
      onGround = !!hit
    } else {
      onGround = t0.y < 0.6
    }

    // movement relative to yaw
    const yaw = playerRef.yaw
    const sinY = Math.sin(yaw)
    const cosY = Math.cos(yaw)
    let mx = sinY * f - cosY * r
    let mz = cosY * f + sinY * r
    const ml = Math.hypot(mx, mz)
    if (ml > 1) {
      mx /= ml
      mz /= ml
    }
    const speed = sprinting ? SPRINT : ads ? ADS_SPD : crouching ? CROUCH_SPD : WALK
    const lv = body.linvel()
    const kk = 1 - Math.exp(-(onGround ? 11 : 2.6) * dt)
    const vx = lv.x + (mx * speed - lv.x) * kk
    const vz = lv.z + (mz * speed - lv.z) * kk
    let vy = lv.y
    const now = performance.now()
    if (onGround && now - jumpBuf.current < 0.15) {
      vy = JUMP_VEL
      jumpBuf.current = -1e9
      onGround = false
    }
    body.setLinvel({ x: vx, y: vy, z: vz }, true)

    // write shared player state
    const t = body.translation()
    playerRef.position.set(t.x, t.y, t.z)
    playerRef.velocity.set(vx, vy, vz)
    playerRef.onGround = onGround
    playerRef.crouching = crouching
    playerRef.sprinting = sprinting

    // eye height
    playerRef.eyeHeight = THREE.MathUtils.damp(
      playerRef.eyeHeight,
      crouching ? EYE_CROUCH : EYE_STAND,
      10,
      dt
    )

    // head bob
    const hSpeed = Math.hypot(vx, vz)
    if (onGround && hSpeed > 0.5) bobPhase.current += dt * (2.2 + hSpeed * 1.1)
    const bobScale = (ads ? 0.25 : 1) * Math.min(1, hSpeed / 4)
    const bobY = Math.sin(bobPhase.current) * 0.035 * bobScale
    const bobX = Math.cos(bobPhase.current * 0.5) * 0.02 * bobScale

    // recoil: apply then decay
    const pitch = playerRef.pitch + playerRef.recoilPitch
    const yawV = playerRef.yaw + playerRef.recoilYaw
    playerRef.recoilPitch = THREE.MathUtils.damp(playerRef.recoilPitch, 0, 9, dt)
    playerRef.recoilYaw = THREE.MathUtils.damp(playerRef.recoilYaw, 0, 9, dt)

    // screen shake (trauma)
    playerRef.shake = Math.max(0, playerRef.shake - dt * 1.6)
    const sh = playerRef.shake * playerRef.shake
    const tt = now * 0.001
    const shP = (Math.sin(tt * 43.7) + Math.sin(tt * 27.1) * 0.6) * 0.022 * sh
    const shY = (Math.cos(tt * 35.3) + Math.sin(tt * 29.7) * 0.6) * 0.022 * sh
    const shR = Math.sin(tt * 51.3) * 0.03 * sh

    _right.set(-cosY, 0, sinY)
    camera.position.set(t.x, t.y + playerRef.eyeHeight + bobY, t.z)
    camera.position.addScaledVector(_right, bobX)
    camera.rotation.set(
      THREE.MathUtils.clamp(pitch + shP, -1.65, 1.65),
      yawV + Math.PI + shY,
      shR + r * -0.015
    )

    // FOV kick
    const targetFov = ads ? 55 : sprinting ? 82 : 75
    const nf = THREE.MathUtils.damp(camera.fov, targetFov, 9, dt)
    if (Math.abs(nf - camera.fov) > 0.01) {
      camera.fov = nf
      camera.updateProjectionMatrix()
    }

    // footsteps
    if (onGround && hSpeed > 1.2) {
      stepAcc.current += hSpeed * dt
      if (stepAcc.current >= (sprinting ? 2.9 : 2.2)) {
        stepAcc.current = 0
        audio.footstep(sprinting)
      }
    } else {
      stepAcc.current = Math.min(stepAcc.current, 1)
    }

    // HP regen after 5s without damage
    if (now - g.lastDamageAt > 5000 && g.hp > 0 && g.hp < g.maxHp) {
      g.healPlayer(10 * dt)
    }

    // mirror stance to store (edge-triggered to avoid zustand churn)
    if (sprinting !== sprintM.current) {
      sprintM.current = sprinting
      useGame.setState({ sprint: sprinting })
    }
    if (crouching !== crouchM.current) {
      crouchM.current = crouching
      useGame.setState({ crouch: crouching })
    }
  }, -1)

  return (
    <RigidBody
      ref={rb}
      type="dynamic"
      position={def.spawn}
      colliders={false}
      linearDamping={6}
      lockRotations
      canSleep={false}
    >
      {/* capsule offset so the body origin sits at the feet; eye height is origin-relative */}
      <CapsuleCollider args={[0.5, 0.32]} position={[0, 0.82, 0]} />
    </RigidBody>
  )
}
