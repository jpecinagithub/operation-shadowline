// Module-level enemy registry. Enemies register themselves on mount.
// WeaponSystem / Grenades / cinematics query & damage through this — no prop drilling.
import * as THREE from 'three'

const enemies = new Map()
let seq = 1
// spawn requests queued by MissionManager (reinforcements), consumed by EnemyManager
const spawnQueue = []

export const enemyRegistry = {
  register(e) {
    e.id = e.id || `e${seq++}`
    enemies.set(e.id, e)
    return e.id
  },
  unregister(id) { enemies.delete(id) },
  clear() { enemies.clear(); spawnQueue.length = 0; seq = 1 },

  damage(id, amount, point, dir) {
    const e = enemies.get(id)
    if (!e || !e.alive) return false
    e.hp -= amount
    e.lastDamageDir = dir ? dir.clone() : new THREE.Vector3()
    e.lastDamageAt = performance.now()
    e.onDamaged && e.onDamaged(amount, point, dir)
    if (e.hp <= 0) {
      e.alive = false
      e.onDeath && e.onDeath(point, dir)
    }
    return true
  },

  /** ray-sphere test against all alive enemies. Returns {id, dist, point} of nearest or null. */
  raycast(origin, dir, maxDist) {
    let best = null
    const toC = new THREE.Vector3()
    for (const e of enemies.values()) {
      if (!e.alive) continue
      const c = e.getCenter() // Vector3 world
      toC.copy(c).sub(origin)
      const t = toC.dot(dir)
      if (t < 0 || t > maxDist) continue
      const d2 = toC.lengthSq() - t * t
      const r = e.radius || 0.45
      if (d2 > r * r * 4) continue // generous capsule approx
      if (!best || t < best.dist) {
        best = { id: e.id, dist: t, point: origin.clone().addScaledVector(dir, t), enemy: e }
      }
    }
    return best
  },

  alive() { return [...enemies.values()].filter((e) => e.alive) },
  count() { return enemies.size },
  aliveCount() { let n = 0; for (const e of enemies.values()) if (e.alive) n++; return n },

  /** alert enemies within radius of a position (gunshot noise) */
  alertNear(pos, radius) {
    for (const e of enemies.values()) {
      if (!e.alive) continue
      if (e.getPosition().distanceTo(pos) < radius) e.onAlerted && e.onAlerted(pos)
    }
  },

  requestSpawn(cfg) { spawnQueue.push(cfg) },
  consumeSpawns() { const q = spawnQueue.splice(0); return q },
}
