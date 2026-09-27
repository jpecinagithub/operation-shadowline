// WeaponSystem: hitscan firing, ADS, reload, weapon switching. Renders nothing.
// Hits: rapier castRayAndGetNormal for world geometry; enemyRegistry + damageables
// raycasts for targets; nearest hit wins. Recoil is accumulated in playerRef
// (radians) and consumed/decayed by PlayerController.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'
import { WEAPONS, WEAPON_ORDER } from './weaponData.js'
import { playerRef } from '../player/playerRef.js'
import { playerPhysics } from '../player/PlayerController.jsx'
import { enemyRegistry } from '../enemies/enemyRegistry.js'
import { damageables } from '../systems/damageables.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'

const DEG = Math.PI / 180
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _muzzle = new THREE.Vector3()
const _end = new THREE.Vector3()
const _tmp = new THREE.Vector3()

export default function WeaponSystem() {
  const camera = useThree((s) => s.camera)
  const { world, rapier } = useRapier()
  const firing = useRef(false) // LMB held
  const adsHeld = useRef(false) // RMB held
  const lastShot = useRef(0)
  const lastDry = useRef(0)
  const adsBlend = useRef(0)
  const prevAds = useRef(false)
  const drawUntil = useRef(0) // weapon switch draw delay
  const semiFired = useRef(false) // semi-auto edge latch
  const rayRef = useRef(null)
  const camRef = useRef(camera)
  camRef.current = camera

  const fireShot = (g, w, wid, now, ads) => {
    const ammo = g.ammo[wid]
    if (!ammo || ammo.mag <= 0) {
      if (now - lastDry.current > 350) {
        lastDry.current = now
        audio.dryFire()
      }
      semiFired.current = true
      g.doReload(wid)
      return
    }
    if (!g.consumeAmmo(wid)) return
    lastShot.current = now
    if (!w.auto) semiFired.current = true
    g.emit('shoot')

    const cam = camRef.current
    cam.getWorldDirection(_fwd)
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion)

    // muzzle approx in world (WeaponView draws the flash at the real barrel tip)
    _muzzle
      .copy(cam.position)
      .addScaledVector(_fwd, 0.55)
      .addScaledVector(_right, 0.16)
      .addScaledVector(_up, -0.12)
    fx.muzzle(_muzzle, _fwd)
    audio.shoot(wid)

    // recoil, stored in radians; PlayerController applies + decays it
    const rk = w.recoil * DEG
    playerRef.recoilPitch += rk * 0.5 * (ads ? 0.65 : 1)
    playerRef.recoilYaw += (Math.random() - 0.5) * rk * 0.3
    playerRef.shake = Math.min(1, playerRef.shake + (wid === 'M12' ? 0.18 : 0.06))

    enemyRegistry.alertNear(playerRef.position, 45)

    _origin.copy(cam.position).addScaledVector(_fwd, 0.3)
    const spread = w.spread * (ads ? 0.6 : 1)
    if (!rayRef.current && rapier) {
      rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
    }
    const ray = rayRef.current
    const flags = rapier ? rapier.QueryFilterFlags.EXCLUDE_SENSORS : undefined
    const exclude = playerPhysics.collider || undefined

    for (let p = 0; p < w.pellets; p++) {
      // gaussian-ish spread jitter
      const jx = (Math.random() + Math.random() + Math.random() - 1.5) * spread
      const jy = (Math.random() + Math.random() + Math.random() - 1.5) * spread
      _dir.copy(_fwd).addScaledVector(_right, jx).addScaledVector(_up, jy).normalize()

      let wDist = Infinity
      let wNormal = null
      if (ray && world) {
        ray.origin.x = _origin.x
        ray.origin.y = _origin.y
        ray.origin.z = _origin.z
        ray.dir.x = _dir.x
        ray.dir.y = _dir.y
        ray.dir.z = _dir.z
        const wh = world.castRayAndGetNormal(ray, w.range, true, flags, undefined, exclude)
        if (wh) {
          wDist = wh.timeOfImpact
          wNormal = wh.normal
        }
      }
      const eh = enemyRegistry.raycast(_origin, _dir, w.range)
      const dh = damageables.raycast(_origin, _dir, w.range)

      let kind = 'world'
      let best = wDist
      if (eh && eh.dist < best) {
        kind = 'enemy'
        best = eh.dist
      }
      if (dh && dh.dist < best) {
        kind = 'dmg'
        best = dh.dist
      }

      if (kind === 'enemy') {
        _end.copy(eh.point)
        const dmg = w.damage * (1 - 0.5 * (eh.dist / w.range))
        enemyRegistry.damage(eh.id, dmg, _end, _dir)
        fx.blood(_end, _dir)
        g.emit('hit')
        audio.impact('flesh')
      } else if (kind === 'dmg') {
        _tmp.set(dh.point[0], dh.point[1], dh.point[2])
        _end.copy(_tmp)
        damageables.damage(dh.id, w.damage)
        fx.impact(_tmp, null, 'metal')
        fx.sparks(_tmp, _dir)
        audio.impact('metal')
      } else if (wDist < Infinity) {
        _end.copy(_origin).addScaledVector(_dir, wDist)
        _tmp.set(wNormal.x, wNormal.y, wNormal.z)
        fx.impact(_end, _tmp, 'concrete')
        audio.impact('concrete')
        if (wDist > 25 && Math.random() < 0.3) audio.ricochet()
      } else {
        _end.copy(_origin).addScaledVector(_dir, w.range)
      }
      fx.tracer(_muzzle, _end, w.tracer)
    }
  }
  const fireRef = useRef(fireShot)
  fireRef.current = fireShot

  // ---- input ----
  useEffect(() => {
    const onMouseDown = (e) => {
      const g = useGame.getState()
      if (g.status !== 'playing' || !document.pointerLockElement) return
      if (e.button === 0) {
        firing.current = true
        semiFired.current = false
      } else if (e.button === 2) {
        adsHeld.current = true
      }
    }
    const onMouseUp = (e) => {
      if (e.button === 0) {
        firing.current = false
        semiFired.current = false
      } else if (e.button === 2) {
        adsHeld.current = false
      }
    }
    const onKeyDown = (e) => {
      if (e.repeat) return
      const g = useGame.getState()
      if (g.status !== 'playing') return
      if (e.code === 'KeyR') {
        g.doReload(g.currentWeapon)
      } else if (e.code.length === 6 && e.code.startsWith('Digit')) {
        const i = parseInt(e.code.slice(5), 10) - 1
        if (i >= 0 && i < WEAPON_ORDER.length) {
          const id = WEAPON_ORDER[i]
          if (g.weapons.includes(id) && id !== g.currentWeapon) {
            g.switchWeapon(id)
            drawUntil.current = performance.now() + 250
          }
        }
      }
    }
    const onCtx = (e) => {
      if (useGame.getState().status === 'playing') e.preventDefault()
    }
    const onBlur = () => {
      firing.current = false
      adsHeld.current = false
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onCtx)
    window.addEventListener('blur', onBlur)
    const unsub = useGame.subscribe((s) => s.ev.reload, (n, p) => {
      if (n > p) audio.reload()
    })
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onCtx)
      window.removeEventListener('blur', onBlur)
      unsub()
      firing.current = false
      adsHeld.current = false
    }
  }, [])

  // ---- per-frame ----
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = useGame.getState()
    if (g.status !== 'playing') return
    if (!world || !rapier) return

    // ADS blend (~200ms), blocked while sprinting or reloading
    const adsTarget = adsHeld.current && !playerRef.sprinting && !g.reloading ? 1 : 0
    adsBlend.current = THREE.MathUtils.damp(adsBlend.current, adsTarget, 14, dt)
    const ads = adsBlend.current > 0.5
    playerRef.ads = ads
    playerRef.adsBlend = adsBlend.current
    if (ads !== prevAds.current) {
      prevAds.current = ads
      useGame.setState({ ads })
    }

    // fire
    const wid = g.currentWeapon
    const w = WEAPONS[wid]
    if (!w) return
    const now = performance.now()
    const wantFire = firing.current && (w.auto || !semiFired.current)
    if (
      wantFire &&
      !g.reloading &&
      now >= drawUntil.current &&
      now - lastShot.current >= 60000 / w.rpm
    ) {
      fireRef.current(g, w, wid, now, ads)
    }
  })

  return null
}
