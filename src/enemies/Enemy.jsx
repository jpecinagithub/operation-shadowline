// Enemy soldier: procedural low-poly model + AI state machine.
// All geometry procedural, all content original. Kinematic movement (no rigid body),
// LOS raycasts against the physics world via useRapier.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { enemyRegistry } from './enemyRegistry.js'
import { playerRef } from '../player/playerRef.js'
import { useGame } from '../systems/GameState.js'
import { audio } from '../systems/AudioManager.js'
import { fx } from '../effects/fx.js'
import { spawnAmmoDrop } from '../systems/pickups.js'
import { yawTo, lerpAngle, hasLOS, pickCover } from './ai.js'

// ---------- module temps: zero allocation in the hot loop ----------
const _toP = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _head = new THREE.Vector3()
const _chest = new THREE.Vector3()
const _tip = new THREE.Vector3()
const _miss = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _move = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

const AVOID_ANGLE = (Math.PI * 70) / 180 // obstacle avoidance turn
const DETECT_RANGE = 40
const DETECT_HALF_ANGLE = Math.cos(THREE.MathUtils.degToRad(65))

// ---------- shared geometry (built once for all enemies) ----------
const GEO = {
  leg: new THREE.BoxGeometry(0.16, 0.75, 0.18),
  torso: new THREE.BoxGeometry(0.48, 0.62, 0.3),
  arm: new THREE.BoxGeometry(0.13, 0.55, 0.15),
  head: new THREE.SphereGeometry(0.16, 10, 8),
  helmet: new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  gun: new THREE.BoxGeometry(0.09, 0.14, 0.8),
  visor: new THREE.BoxGeometry(0.24, 0.05, 0.03),
}

const UNIFORMS = ['#6e6258', '#8a7a5c', '#6b6f72', '#41474d']
// NOTE: no olive/green tones here — allies wear blue-gray, and these must never
// read as friendly at a glance.

const normPt = (p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z })

export default function Enemy({ spawn, covers }) {
  const group = useRef()
  const body = useRef()
  const legL = useRef()
  const legR = useRef()
  const armL = useRef()
  const armR = useRef()
  const rapierApi = useRapier()
  const rapierRef = useRef({ world: null, rapier: null })
  rapierRef.current.world = rapierApi.world
  rapierRef.current.rapier = rapierApi.rapier
  const rayCache = useRef(null)
  const [mounted, setMounted] = useState(true)

  const cfg = useMemo(() => {
    const pos = new THREE.Vector3(spawn.pos[0], spawn.pos[1], spawn.pos[2])
    const raw = spawn.patrol && spawn.patrol.length ? spawn.patrol : [[spawn.pos[0], spawn.pos[2]]]
    const patrol = raw.map(normPt)
    return {
      pos,
      patrol,
      roof: spawn.type === 'roof' || spawn.type === 'r',
      yaw0: yawTo(pos, patrol[0]),
    }
  }, [spawn])

  const mats = useMemo(() => {
    const uniColor = UNIFORMS[(Math.random() * UNIFORMS.length) | 0]
    return {
      uni: new THREE.MeshStandardMaterial({ color: uniColor, roughness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2e2c26', roughness: 0.95 }),
      skin: new THREE.MeshStandardMaterial({ color: '#c99e7a', roughness: 0.8 }),
      helm: new THREE.MeshStandardMaterial({ color: '#3d3a33', roughness: 0.85 }),
      gunm: new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.6, metalness: 0.4 }),
      visor: new THREE.MeshStandardMaterial({
        color: '#300000',
        emissive: new THREE.Color('#ff1a1a'),
        emissiveIntensity: 0.25,
        roughness: 0.4,
      }),
    }
  }, [])

  // ---------- AI state (all in one ref, mutated per frame) ----------
  const ai = useRef({
    state: 'PATROL',
    yaw: cfg.yaw0,
    wpIndex: 0,
    pauseT: 0,
    alertT: 0,
    stimulus: new THREE.Vector3(),
    lastKnown: new THREE.Vector3(),
    lostT: 0,
    scanT: 0,
    searchArrived: false,
    strafeDir: 1,
    strafeT: 2,
    burstT: 1.5,
    burstLeft: 0,
    shotT: 0,
    coverPt: null,
    coverT: 0,
    coverCheckT: 4,
    staggerT: 0,
    avoidSign: 1,
    crouching: false,
    moving: false,
    walkPhase: 0,
    deadT: 0,
    fadeT: 0,
    deadY: 0,
    fallSide: 1,
    visorFlash: 0,
    tickAcc: Math.random() * 0.25, // staggered detection phase
  })

  const getRay = () => {
    if (!rayCache.current) {
      const { rapier } = rapierRef.current
      if (!rapier) return null
      rayCache.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
    }
    return rayCache.current
  }
  const setRay = (ray, ox, oy, oz, dx, dy, dz) => {
    ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz
    ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz
  }

  // ---------- registry callbacks (stable: only touch refs) ----------
  const onDamaged = (amount, point, dir) => {
    const a = ai.current
    if (a.state === 'DEAD') return
    a.staggerT = 0.35 // brief speed cut
    a.visorFlash = 1
    if (point) {
      if (dir) fx.blood(point, dir)
      else {
        _fwd.set(Math.sin(a.yaw), 0, Math.cos(a.yaw))
        fx.blood(point, _fwd)
      }
    }
    const s = useGame.getState()
    if (s.status === 'playing' && playerRef.alive && (a.state === 'PATROL' || a.state === 'SEARCH')) {
      onAlerted(playerRef.position)
    }
  }

  const onAlerted = (pos) => {
    const a = ai.current
    if (a.state === 'DEAD' || a.state === 'COMBAT' || a.state === 'COVER') return
    a.state = 'ALERT'
    a.alertT = 0
    if (pos && pos.isVector3) a.stimulus.copy(pos)
    else if (Array.isArray(pos)) a.stimulus.set(pos[0], pos[1], pos[2])
    else a.stimulus.copy(playerRef.position)
  }

  const onDeath = () => {
    const a = ai.current
    if (a.state === 'DEAD') return
    a.state = 'DEAD'
    a.deadT = 0
    a.fadeT = 0
    a.deadY = group.current ? group.current.position.y : cfg.pos.y
    a.fallSide = Math.random() < 0.5 ? 1 : -1
    if (group.current) {
      const gp = group.current.position
      spawnAmmoDrop(gp.x, gp.y + 0.4, gp.z)
    }
    useGame.getState().addKill()
    useGame.getState().emit('kill')
    audio.impact('flesh')
  }

  const regRef = useRef(null)
  useEffect(() => {
    const reg = {
      getPosition: () => group.current.position,
      getCenter: () => group.current.position.clone().add(_tmp.set(0, 1.1, 0)),
      radius: 0.5,
      hp: 100,
      alive: true,
      onDamaged,
      onDeath,
      onAlerted,
    }
    regRef.current = reg
    enemyRegistry.register(reg)
    return () => {
      if (regRef.current) enemyRegistry.unregister(regRef.current.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- perception ----------
  const canSeePlayer = (g, a) => {
    const { world, rapier } = rapierRef.current
    _head.copy(g.position)
    _head.y += 1.62
    _chest.copy(playerRef.position)
    _chest.y -= 0.25
    _toP.copy(_chest).sub(_head)
    const dist = _toP.length()
    if (dist > DETECT_RANGE) return false
    const speed = playerRef.velocity.length()
    const noisy = playerRef.sprinting || speed > 6
    if (dist < 12 && noisy) return hasLOS(world, rapier, _head, _chest, 0.6)
    _dir.copy(_toP).multiplyScalar(1 / Math.max(dist, 1e-4))
    const dot = Math.sin(a.yaw) * _dir.x + Math.cos(a.yaw) * _dir.z
    if (dot < DETECT_HALF_ANGLE) return false
    return hasLOS(world, rapier, _head, _chest, 0.6)
  }

  const detectionTick = (g, a, playing) => {
    if (!playing) {
      if (a.state === 'COMBAT' || a.state === 'ALERT' || a.state === 'COVER') {
        a.state = 'SEARCH'
        a.searchArrived = false
        a.crouching = false
      }
      return
    }
    const visible = canSeePlayer(g, a)
    if (visible) {
      if (a.state !== 'COMBAT') {
        a.state = 'COMBAT'
        a.lostT = 0
        a.burstT = 0.6 + Math.random() * 0.8
        a.crouching = false
        enemyRegistry.alertNear(g.position, 30)
      }
      a.lastKnown.copy(playerRef.position)
      a.lostT = 0
    } else if (a.state === 'COMBAT') {
      a.lostT += 0.25
      if (a.lostT > 4) {
        a.state = 'SEARCH'
        a.searchArrived = false
        a.scanT = 0
      }
    }
  }

  // ---------- kinematic movement with obstacle avoidance ----------
  const moveWithAvoid = (g, a, dx, dz, speed, dt) => {
    const { world, rapier } = rapierRef.current
    let mx = dx
    let mz = dz
    if (world && rapier && (mx !== 0 || mz !== 0)) {
      const inv = 1 / Math.hypot(mx, mz)
      const fxv = mx * inv
      const fzv = mz * inv
      const ray = getRay()
      if (ray) {
        setRay(ray, g.position.x, g.position.y + 0.9, g.position.z, fxv, 0, fzv)
        if (world.castRay(ray, 1.6, true)) {
          const c = Math.cos(AVOID_ANGLE * a.avoidSign)
          const s = Math.sin(AVOID_ANGLE * a.avoidSign)
          mx = fxv * c - fzv * s
          mz = fxv * s + fzv * c
          a.avoidSign *= -1
        }
      }
    }
    let sp = speed
    if (a.staggerT > 0) sp *= 0.3
    g.position.x += mx * sp * dt
    g.position.z += mz * sp * dt
    if (cfg.roof) g.position.y = cfg.pos.y // roof type never falls
  }

  // ---------- enemy fire ----------
  const fireShot = (g, a) => {
    const { world, rapier } = rapierRef.current
    _head.copy(g.position)
    _head.y += 1.45
    _chest.copy(playerRef.position)
    _chest.y -= 0.25
    _dir.copy(_chest).sub(_head)
    const dist = _dir.length()
    if (dist > 48 || dist < 0.01) return
    if (!hasLOS(world, rapier, _head, _chest, 0.6)) return
    _dir.multiplyScalar(1 / dist)
    _tip.set(0.18, 1.12, 0.78)
    g.localToWorld(_tip)
    audio.enemyShoot(dist)
    fx.muzzle(_tip, _dir)
    const speed = playerRef.velocity.length()
    let chance =
      0.55 -
      dist * 0.008 -
      (speed > 6 ? 0.15 : 0) -
      (playerRef.crouching ? 0.1 : 0) -
      (playerRef.ads ? 0 : 0.05)
    chance = Math.max(0.05, Math.min(0.9, chance))
    if (Math.random() < chance) {
      useGame.getState().damagePlayer(7 + Math.random() * 6)
      fx.tracer(_tip, _chest, 0xff6a5a)
    } else {
      _miss.set(
        _chest.x + (Math.random() * 2 - 1) * 1.5,
        _chest.y + (Math.random() * 2 - 1) * 1.0,
        _chest.z + (Math.random() * 2 - 1) * 1.5
      )
      fx.tracer(_tip, _miss, 0xff6a5a)
      fx.impact(_miss, UP, 'dirt')
    }
  }

  const doBurstFire = (g, a, dt, burstGap) => {
    if (a.burstLeft > 0) {
      a.shotT -= dt
      if (a.shotT <= 0) {
        a.shotT = 0.12
        a.burstLeft -= 1
        fireShot(g, a)
      }
    } else {
      a.burstT -= dt
      if (a.burstT <= 0) {
        a.burstLeft = 3 + ((Math.random() * 3) | 0) // 3-5 shots
        a.shotT = 0
        a.burstT = burstGap[0] + Math.random() * (burstGap[1] - burstGap[0])
      }
    }
  }

  // ---------- main loop ----------
  useFrame((_, dtRaw) => {
    const g = group.current
    if (!g || !regRef.current) return
    const a = ai.current
    const dt = Math.min(dtRaw, 0.1)
    const playing = useGame.getState().status === 'playing' && playerRef.alive
    if (a.staggerT > 0) a.staggerT -= dt

    // ----- DEAD: fall, sink, fade, remove -----
    if (a.state === 'DEAD') {
      a.deadT += dt
      const k = Math.min(1, a.deadT / 0.4)
      const e = 1 - (1 - k) * (1 - k)
      g.rotation.z = a.fallSide * e * (Math.PI * 0.5)
      g.position.y = a.deadY - e * 0.3
      if (a.deadT > 7) {
        if (a.fadeT === 0) {
          for (const m of Object.values(mats)) m.transparent = true
        }
        a.fadeT += dt
        const op = Math.max(0, 1 - a.fadeT)
        for (const m of Object.values(mats)) m.opacity = op
        if (a.fadeT >= 1) {
          enemyRegistry.unregister(regRef.current.id)
          regRef.current = null
          setMounted(false)
        }
      }
      return
    }

    // ----- perception tick (staggered 0.25s) -----
    a.tickAcc += dt
    if (a.tickAcc >= 0.25) {
      a.tickAcc -= 0.25
      detectionTick(g, a, playing)
    }

    a.moving = false

    // ----- PATROL -----
    if (a.state === 'PATROL') {
      const wp = cfg.patrol[a.wpIndex % cfg.patrol.length]
      _tmp.set(wp.x - g.position.x, 0, wp.z - g.position.z)
      const d = _tmp.length()
      if (d < 0.6) {
        if (a.pauseT <= 0) a.pauseT = 1.0 + Math.random() * 1.2
        a.pauseT -= dt
        if (a.pauseT <= 0) {
          a.wpIndex = (a.wpIndex + 1) % cfg.patrol.length
          a.pauseT = 0
        }
      } else {
        _tmp.multiplyScalar(1 / d)
        moveWithAvoid(g, a, _tmp.x, _tmp.z, 2, dt)
        a.moving = true
        a.yaw = lerpAngle(a.yaw, yawTo(g.position, wp), 8 * dt)
      }
    }
    // ----- ALERT: face stimulus 1.6s, then decide -----
    else if (a.state === 'ALERT') {
      a.alertT += dt
      a.yaw = lerpAngle(a.yaw, yawTo(g.position, a.stimulus), 6 * dt)
      if (a.alertT >= 1.6) {
        if (playing && canSeePlayer(g, a)) {
          a.state = 'COMBAT'
          a.lastKnown.copy(playerRef.position)
          a.lostT = 0
          a.burstT = 0.5
          enemyRegistry.alertNear(g.position, 30)
        } else {
          a.state = 'SEARCH'
          a.lastKnown.copy(a.stimulus)
          a.searchArrived = false
          a.scanT = 0
        }
      }
    }
    // ----- SEARCH: go to lastKnown, scan 6s, back to patrol -----
    else if (a.state === 'SEARCH') {
      _tmp.set(a.lastKnown.x - g.position.x, 0, a.lastKnown.z - g.position.z)
      const d = _tmp.length()
      if (!a.searchArrived && d > 1.2) {
        _tmp.multiplyScalar(1 / d)
        moveWithAvoid(g, a, _tmp.x, _tmp.z, 2.6, dt)
        a.moving = true
        a.yaw = lerpAngle(a.yaw, yawTo(g.position, a.lastKnown), 8 * dt)
      } else {
        a.searchArrived = true
        a.scanT += dt
        a.yaw += dt * 1.2 // scanning sweep
        if (a.scanT >= 6) {
          a.scanT = 0
          a.state = 'PATROL'
        }
      }
    }
    // ----- COMBAT -----
    else if (a.state === 'COMBAT') {
      _toP.copy(playerRef.position).sub(g.position)
      _toP.y = 0
      const dist = Math.max(0.01, _toP.length())
      _toP.multiplyScalar(1 / dist)
      const faceYaw = Math.atan2(_toP.x, _toP.z)

      a.strafeT -= dt
      if (a.strafeT <= 0) {
        a.strafeDir = Math.random() < 0.5 ? -1 : 1
        a.strafeT = 1 + Math.random() * 2
      }
      const rangeMove = dist > 25 ? 1 : dist < 8 ? -1 : 0
      _move.set(_toP.z * a.strafeDir, 0, -_toP.x * a.strafeDir)
      _move.multiplyScalar(2.5)
      _move.x += _toP.x * rangeMove * 1.6
      _move.z += _toP.z * rangeMove * 1.6
      const ml = _move.length()
      if (ml > 0.01) {
        _move.multiplyScalar(1 / ml)
        moveWithAvoid(g, a, _move.x, _move.z, 2.5, dt)
        a.moving = true
      }
      const firing = a.burstLeft > 0
      a.yaw = lerpAngle(
        a.yaw,
        firing || !a.moving ? faceYaw : Math.atan2(_move.x, _move.z),
        10 * dt
      )
      if (playing) doBurstFire(g, a, dt, [1.4, 2.4])

      a.coverCheckT -= dt
      if (a.coverCheckT <= 0) {
        a.coverCheckT = 6
        if (regRef.current.hp < 45 || Math.random() < 0.25) {
          const c = pickCover(covers, g.position, playerRef.position, 25)
          if (c) {
            a.state = 'COVER'
            a.coverPt = c
            a.coverT = 0
            a.crouching = true
            a.burstLeft = 0
          }
        }
      }
    }
    // ----- COVER: move to cover point, crouch, peek-fire -----
    else if (a.state === 'COVER') {
      a.coverT += dt
      _tmp.set(a.coverPt.x - g.position.x, 0, a.coverPt.z - g.position.z)
      const d = _tmp.length()
      if (d > 0.9) {
        _tmp.multiplyScalar(1 / d)
        moveWithAvoid(g, a, _tmp.x, _tmp.z, 3.2, dt)
        a.moving = true
        a.yaw = lerpAngle(a.yaw, Math.atan2(_tmp.x, _tmp.z), 8 * dt)
      } else {
        _toP.copy(playerRef.position).sub(g.position)
        _toP.y = 0
        a.yaw = lerpAngle(a.yaw, Math.atan2(_toP.x, _toP.z), 8 * dt)
        if (playing) doBurstFire(g, a, dt, [2.2, 3.4])
      }
      if (a.coverT > 12 || !playing) {
        a.state = playing ? 'COMBAT' : 'SEARCH'
        a.searchArrived = false
        a.crouching = false
        a.burstT = 0.8
      }
    }

    // ----- apply orientation, walk cycle, crouch, visor -----
    g.rotation.y = a.yaw
    if (a.moving) a.walkPhase += dt * 9
    const swing = a.moving ? Math.sin(a.walkPhase) * 0.55 : 0
    if (legL.current) legL.current.rotation.x = swing
    if (legR.current) legR.current.rotation.x = -swing
    if (armL.current) armL.current.rotation.x = -swing * 0.6
    if (armR.current) armR.current.rotation.x = swing * 0.6
    if (body.current) {
      const targetY = a.crouching ? -0.35 : 0
      body.current.position.y += (targetY - body.current.position.y) * Math.min(1, 8 * dt)
    }
    a.visorFlash = Math.max(0, a.visorFlash - dt * 3)
    const alerted = a.state === 'COMBAT' || a.state === 'ALERT' || a.state === 'COVER'
    const visorTarget = 0.25 + (alerted ? 1.4 : 0) + a.visorFlash * 2
    mats.visor.emissiveIntensity += (visorTarget - mats.visor.emissiveIntensity) * Math.min(1, 10 * dt)
  })

  if (!mounted) return null
  return (
    <group ref={group} position={[cfg.pos.x, cfg.pos.y, cfg.pos.z]}>
      <group ref={body}>
        {/* legs (pivot at hip) */}
        <group ref={legL} position={[-0.12, 0.75, 0]}>
          <mesh geometry={GEO.leg} material={mats.dark} position={[0, -0.375, 0]} />
        </group>
        <group ref={legR} position={[0.12, 0.75, 0]}>
          <mesh geometry={GEO.leg} material={mats.dark} position={[0, -0.375, 0]} />
        </group>
        {/* torso */}
        <mesh geometry={GEO.torso} material={mats.uni} position={[0, 1.06, 0]} castShadow />
        {/* arms (pivot at shoulder) */}
        <group ref={armL} position={[-0.33, 1.3, 0.02]}>
          <mesh geometry={GEO.arm} material={mats.uni} position={[0, -0.22, 0]} />
        </group>
        <group ref={armR} position={[0.33, 1.3, 0.02]}>
          <mesh geometry={GEO.arm} material={mats.uni} position={[0, -0.22, 0]} />
        </group>
        {/* head + helmet */}
        <mesh geometry={GEO.head} material={mats.skin} position={[0, 1.52, 0]} castShadow />
        <mesh geometry={GEO.helmet} material={mats.helm} position={[0, 1.55, -0.01]} />
        {/* red visor strip (brightens when alerted) */}
        <mesh geometry={GEO.visor} material={mats.visor} position={[0, 1.53, 0.15]} />
        {/* rifle held forward */}
        <mesh geometry={GEO.gun} material={mats.gunm} position={[0.18, 1.12, 0.35]} />
      </group>
    </group>
  )
}
