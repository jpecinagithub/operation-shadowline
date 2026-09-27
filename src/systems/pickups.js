// Ammo pickups (enemy drops). Module-level store with a version counter so the
// 3D renderer can subscribe via useSyncExternalStore. No per-frame react state.
import { useGame } from './GameState.js'
import { WEAPONS } from '../weapons/weaponData.js'

let seq = 1
let version = 0
const listeners = new Set()

let lastPickupLabel = '+ AMMO'
export function setLastPickupLabel(s) {
  lastPickupLabel = s
}
export function getLastPickupLabel() {
  return lastPickupLabel
}

export const pickups = {
  list: [], // {id, kind:'ammo', pos:[x,y,z], weaponId, amount, ttl, spawnedAt}
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  getVersion() {
    return version
  },
  _bump() {
    version++
    listeners.forEach((fn) => fn())
  },
  spawn(cfg) {
    const p = {
      id: `p${seq++}`,
      ttl: 40,
      spawnedAt: performance.now(),
      ...cfg,
    }
    this.list.push(p)
    this._bump()
    return p.id
  },
  remove(id) {
    const i = this.list.findIndex((p) => p.id === id)
    if (i >= 0) {
      this.list.splice(i, 1)
      this._bump()
    }
  },
  clear() {
    this.list.length = 0
    this._bump()
  },
}

const DROP_CHANCE = 0.7

// Called from Enemy.onDeath. Drops a generic ammo box at the casualty's position.
// The box is weapon-agnostic: at pickup time it fills the carried weapon that
// needs it most (lowest reserve ratio, current weapon wins ties).
export function spawnAmmoDrop(x, y, z) {
  try {
    if (Math.random() > DROP_CHANCE) return null
    return pickups.spawn({ kind: 'ammo', pos: [x, y, z] })
  } catch {
    return null
  }
}

// Returns 'ok' | 'full' (all reserves maxed — leave the box) | 'error'.
export function collectPickup(p) {
  try {
    const g = useGame.getState()
    if (p.kind === 'ammo') {
      const carried = (g.weapons || []).filter((id) => WEAPONS[id] && g.ammo[id])
      let best = null
      let bestRatio = Infinity
      for (const id of carried) {
        const ratio = g.ammo[id].reserve / WEAPONS[id].maxReserve
        if (ratio < bestRatio) {
          best = id
          bestRatio = ratio
        }
      }
      // prefer the weapon in hand on ties
      const cur = g.currentWeapon
      if (cur && g.ammo[cur] && WEAPONS[cur]) {
        const curRatio = g.ammo[cur].reserve / WEAPONS[cur].maxReserve
        if (curRatio <= bestRatio + 1e-6) {
          best = cur
          bestRatio = curRatio
        }
      }
      if (!best || bestRatio >= 1 - 1e-6) return 'full'
      const added = g.addReserveAmmo(best, WEAPONS[best].magSize)
      if (added <= 0) return 'full'
      setLastPickupLabel(`+${added} ${best} AMMO`)
    }
    pickups.remove(p.id)
    g.emit('pickup')
    return 'ok'
  } catch {
    return 'error'
  }
}
