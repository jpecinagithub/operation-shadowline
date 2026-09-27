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
// objective.zone (optional {yMin,yMax,zMin,zMax}) restricts which hostiles count.
export function enemiesInZone(zone) {
  const list = enemyRegistry.alive()
  if (!zone) return list
  return list.filter((e) => {
    const p = e.getPosition()
    if (zone.yMin !== undefined && p.y < zone.yMin) return false
    if (zone.yMax !== undefined && p.y > zone.yMax) return false
    if (zone.zMin !== undefined && p.z < zone.zMin) return false
    if (zone.zMax !== undefined && p.z > zone.zMax) return false
    if (zone.xMin !== undefined && p.x < zone.xMin) return false
    if (zone.xMax !== undefined && p.x > zone.xMax) return false
    return true
  })
}

export function objectiveWorldPos(objective) {
  if (!objective || objective.target === undefined) return null
  if (objective.target === 'enemies') {
    const list = enemiesInZone(objective.zone)
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
