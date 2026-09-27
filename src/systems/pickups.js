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

// Called from Enemy.onDeath. Drops one magazine of reserve ammo for a random
// carried weapon at the casualty's position.
export function spawnAmmoDrop(x, y, z) {
  try {
    if (Math.random() > DROP_CHANCE) return null
    const g = useGame.getState()
    const carried = (g.weapons || []).filter((id) => WEAPONS[id])
    if (!carried.length) return null
    const wid = carried[Math.floor(Math.random() * carried.length)]
    return pickups.spawn({
      kind: 'ammo',
      pos: [x, y, z],
      weaponId: wid,
      amount: WEAPONS[wid].magSize,
    })
  } catch {
    return null
  }
}

// Returns true if the pickup was consumed.
export function collectPickup(p) {
  try {
    const g = useGame.getState()
    if (p.kind === 'ammo') {
      const added = g.addReserveAmmo(p.weaponId, p.amount)
      if (added <= 0) return false // reserve full — leave it on the ground
      setLastPickupLabel(`+${added} ${p.weaponId} AMMO`)
    }
    pickups.remove(p.id)
    g.emit('pickup')
    return true
  } catch {
    return false
  }
}
