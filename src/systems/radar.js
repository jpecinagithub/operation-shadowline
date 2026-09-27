// Radar/minimap data helpers. Read at render-loop frequency (no react state).
import { enemyRegistry } from '../enemies/enemyRegistry.js'

// Playable-area bounds per mission (from map colliders), used to scale world -> minimap.
export const MAP_BOUNDS = {
  desert: { minX: -60, maxX: 60, minZ: -70, maxZ: 50 },
  arctic: { minX: -60, maxX: 60, minZ: -60, maxZ: 65 },
  urban: { minX: -45, maxX: 45, minZ: -55, maxZ: 60 },
}

// World position of the current objective, or null.
// objective.target is [x, z] for fixed points, or 'enemies' = centroid of live hostiles.
export function objectiveWorldPos(objective) {
  if (!objective || objective.target === undefined) return null
  if (objective.target === 'enemies') {
    const list = enemyRegistry.alive()
    if (!list.length) return null
    let x = 0
    let z = 0
    for (const e of list) {
      const p = e.getPosition()
      x += p.x
      z += p.z
    }
    return { x: x / list.length, z: z / list.length }
  }
  return { x: objective.target[0], z: objective.target[1] }
}
