// Small AI math helpers for enemies. Pure functions + shared temps, no per-frame allocation.
import * as THREE from 'three'

const _dir = new THREE.Vector3()

/** Yaw (radians) so model-forward (sin(yaw), 0, cos(yaw)) points from a to b. a,b have {x,z}. */
export function yawTo(a, b) {
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/** Smallest signed difference between angles a -> b. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Lerp angle a toward b by t (clamped 0..1) along the shortest arc. */
export function lerpAngle(a, b, t) {
  return a + angleDiff(a, b) * Math.min(1, Math.max(0, t))
}

/**
 * Line-of-sight check against physics world colliders.
 * Returns true when `to` is visible from `from` (no collider blocks within dist - slack).
 * Defensive: if world/rapier not ready yet, assume visible.
 */
export function hasLOS(world, rapier, from, to, slack = 0.6) {
  if (!world || !rapier) return true
  _dir.copy(to).sub(from)
  const dist = _dir.length()
  if (dist < 1e-4) return true
  _dir.multiplyScalar(1 / dist)
  const ray = new rapier.Ray(
    { x: from.x, y: from.y, z: from.z },
    { x: _dir.x, y: _dir.y, z: _dir.z }
  )
  const hit = world.castRay(ray, dist + slack, true)
  return !hit || hit.timeOfImpact >= dist - slack
}

/**
 * Pick a cover point: nearest point within maxDist that is farther from the player
 * than I am (so it puts something between me and the threat).
 * Covers may be [x,z], [x,y,z] or {x,y,z}.
 */
export function pickCover(covers, myPos, playerPos, maxDist = 25) {
  if (!covers || covers.length === 0) return null
  const myDistP = Math.hypot(myPos.x - playerPos.x, myPos.z - playerPos.z)
  let best = null
  let bestD = Infinity
  for (const c of covers) {
    const cx = Array.isArray(c) ? c[0] : c.x
    const cz = Array.isArray(c) ? (c.length > 2 ? c[2] : c[1]) : c.z
    const cy = Array.isArray(c) ? (c.length > 2 ? c[1] : myPos.y) : (c.y ?? myPos.y)
    if (cx == null || cz == null) continue
    const d = Math.hypot(cx - myPos.x, cz - myPos.z)
    if (d > maxDist) continue
    const dPlayer = Math.hypot(cx - playerPos.x, cz - playerPos.z)
    if (dPlayer <= myDistP) continue // must be farther from the player than I am
    if (d < bestD) {
      bestD = d
      best = { x: cx, y: cy, z: cz }
    }
  }
  return best
}
