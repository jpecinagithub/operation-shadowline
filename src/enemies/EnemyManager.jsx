// Spawns and owns all <Enemy> instances.
// Reads spawnApi (exported by src/missions/MissionManager.jsx) for the map's initial
// spawns + cover points, and consumes enemyRegistry.consumeSpawns() each frame for
// reinforcements (capped at 14 alive). Remounted via key={runId} by Game.jsx;
// cleanup clears the registry.
import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { spawnApi } from '../missions/MissionManager.jsx'
import { enemyRegistry } from './enemyRegistry.js'
import Enemy from './Enemy.jsx'

const MAX_ALIVE = 14

let uidSeq = 0
const tagSpawn = (cfg) => ({ ...cfg, _uid: `s${++uidSeq}` })

export default function EnemyManager() {
  const [spawns, setSpawns] = useState([])
  const initialTaken = useRef(false)

  useEffect(() => {
    initialTaken.current = false
    return () => {
      enemyRegistry.clear()
    }
  }, [])

  useFrame(() => {
    // Initial spawns: the map calls spawnApi.set() on its own mount. Read them once
    // they're available (robust to mount ordering between map and manager).
    if (
      !initialTaken.current &&
      spawnApi &&
      Array.isArray(spawnApi.spawns) &&
      spawnApi.spawns.length > 0
    ) {
      initialTaken.current = true
      setSpawns(spawnApi.spawns.map(tagSpawn))
    }
    // Reinforcements requested by MissionManager / cinematics.
    const queued = enemyRegistry.consumeSpawns()
    if (queued.length > 0) {
      const room = Math.max(0, MAX_ALIVE - enemyRegistry.aliveCount())
      const take = queued.slice(0, room).map(tagSpawn)
      if (take.length > 0) setSpawns((prev) => [...prev, ...take])
    }
  })

  const covers = (spawnApi && spawnApi.covers) || []

  return (
    <group>
      {spawns.map((s) => (
        <Enemy key={s._uid} spawn={s} covers={covers} />
      ))}
    </group>
  )
}
