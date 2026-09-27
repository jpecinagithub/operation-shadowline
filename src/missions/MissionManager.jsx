// OPERATION SHADOWLINE — Desert Strike mission flow (MAP agent owns this file).
// Watches player zones + kill deltas, advances objectives, runs both cinematics,
// the 12s plant countdown, reinforcements, checkpoints, adaptive music and mission timer.
// NOTE: DesertStrike.jsx imports { missionEvents, spawnApi } from this file, and this file
// imports { mapRefs } from DesertStrike.jsx. The cycle is safe: neither module touches the
// other's bindings during top-level evaluation (only inside components/effects).
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../systems/GameState.js'
import { playerRef } from '../player/playerRef.js'
import { enemyRegistry } from '../enemies/enemyRegistry.js'
import { damageables } from '../systems/damageables.js'
import { interactables } from '../systems/interactables.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'
import { MISSIONS } from './missionData.js'
import { mapRefs } from '../maps/DesertStrike.jsx'

// ---------------- tiny pub/sub ----------------
// Events: 'truckDestroyed', 'relayPlanted', 'relayDetonated', 'cineCar'.
export const missionEvents = {
  _map: new Map(),
  on(evt, fn) {
    let set = this._map.get(evt)
    if (!set) {
      set = new Set()
      this._map.set(evt, set)
    }
    set.add(fn)
    return () => {
      const s = this._map.get(evt)
      if (s) s.delete(fn)
    }
  },
  emit(evt, data) {
    const set = this._map.get(evt)
    if (set) set.forEach((fn) => fn(data))
  },
}

// ---------------- checkpoint API ----------------
// cp = { objectiveIndex, pos: [x,y,z], yaw }
export const checkpointApi = {
  saved: null,
  pending: null,
  save(cp) {
    this.saved = cp
  },
  clear() {
    this.saved = null
    this.pending = null
  },
}

// ---------------- spawn API (map -> EnemyManager, no props) ----------------
export const spawnApi = {
  spawns: [],
  covers: [],
  set(spawns, covers) {
    this.spawns = spawns
    this.covers = covers
  },
}

// Objective indices (from missionData desert.objectives)
const IDX = { enter: 0, patrol: 1, market: 2, roofs: 3, plaza: 4, vehicle: 5, comms: 6, plant: 7, escape: 8 }

export default function MissionManager() {
  const mission = useGame((s) => s.mission)
  const prevIdx = useRef(-1)
  const killsAtStart = useRef(0)
  const needKills = useRef(3)
  const cineDone = useRef(false)
  const plant = useRef(null) // { t, beepT, done } — 12s countdown after planting
  const musicT = useRef(0)
  const timeT = useRef(0)
  const missionTime = useRef(0)

  const completeObjectiveFlow = () => {
    const g = useGame.getState()
    const before = g.objectiveIndex
    g.completeObjective()
    const st = useGame.getState()
    // Save a checkpoint for the NEXT objective (skip after the final one — nothing to resume).
    if (st.objectiveIndex !== before && st.objectiveIndex < st.objectives.length) {
      const p = playerRef.position
      checkpointApi.save({
        objectiveIndex: st.objectiveIndex,
        pos: [p.x, p.y, p.z],
        yaw: playerRef.yaw,
      })
    }
  }

  const onObjectiveStart = (idx) => {
    const kills = useGame.getState().kills
    killsAtStart.current = kills
    if (idx === IDX.patrol) {
      // Require killing the patrol; if the player already thinned it during 'enter',
      // only the survivors count (prevents a soft-lock).
      needKills.current = Math.max(1, Math.min(3, enemyRegistry.aliveCount()))
    } else if (idx === IDX.roofs) {
      needKills.current = Math.max(1, Math.min(2, enemyRegistry.aliveCount()))
    } else if (idx === IDX.plaza) {
      enemyRegistry.requestSpawn({ pos: [-10, 0.2, -23], patrol: [[-8, -25], [-3, -30]] })
      enemyRegistry.requestSpawn({ pos: [10, 0.2, -37], patrol: [[8, -34], [3, -38]] })
    } else if (idx === IDX.comms) {
      enemyRegistry.requestSpawn({ pos: [-6, 0.2, -47], patrol: [[-6, -45], [-2, -49]] })
      enemyRegistry.requestSpawn({ pos: [6, 0.2, -49], patrol: [[6, -45], [2, -49]] })
    }
  }

  // ---- mount: checkpoint restore, event subs, restart hook ----
  useEffect(() => {
    if (mission !== 'desert') return
    if (checkpointApi.pending) {
      const cp = checkpointApi.pending
      useGame.setState({ objectiveIndex: cp.objectiveIndex })
      playerRef.position.set(cp.pos[0], cp.pos[1], cp.pos[2])
      playerRef.yaw = cp.yaw
      checkpointApi.pending = null
      onObjectiveStart(cp.objectiveIndex)
      prevIdx.current = cp.objectiveIndex
    } else {
      prevIdx.current = -1 // first useFrame tick fires onObjectiveStart(0)
    }
    killsAtStart.current = useGame.getState().kills
    needKills.current = 3
    missionTime.current = useGame.getState().missionTime || 0
    cineDone.current = false
    plant.current = null

    const onTruck = () => {
      if (useGame.getState().objectiveIndex === IDX.vehicle) completeObjectiveFlow()
    }
    const onPlanted = () => {
      if (mapRefs.relayId) interactables.unregister(mapRefs.relayId)
      if (useGame.getState().objectiveIndex === IDX.plant && !plant.current) {
        plant.current = { t: 0, beepT: 0, done: false }
        useGame.getState().showBanner('EXPLOSIVE ARMED', '12 seconds', 3000)
      }
    }
    const u1 = missionEvents.on('truckDestroyed', onTruck)
    const u2 = missionEvents.on('relayPlanted', onPlanted)

    // "RESTART CHECKPOINT" (EndScreens) calls this hook.
    window.__restartCheckpoint = () => {
      checkpointApi.pending = checkpointApi.saved
      useGame.getState().startMission('desert', MISSIONS.desert)
      useGame.setState((st) => ({ runId: (st.runId || 0) + 1 }))
    }
    return () => {
      u1()
      u2()
      if (window.__restartCheckpoint) delete window.__restartCheckpoint
    }
  }, [mission])

  // ---- per-frame mission logic ----
  useFrame((_, rawDt) => {
    if (mission !== 'desert') return
    const dt = Math.min(rawDt, 0.1)
    const g = useGame.getState()
    if (g.status !== 'playing') {
      if (g.status === 'complete') audio.setMusicMode('complete')
      return
    }
    const idx = g.objectiveIndex
    const p = playerRef.position

    if (idx !== prevIdx.current) {
      onObjectiveStart(idx)
      prevIdx.current = idx
    }

    // 12s plant countdown (accelerating beeps) -> detonation cinematic
    const pl = plant.current
    if (pl && !pl.done) {
      pl.t += dt
      pl.beepT += dt
      const interval = Math.max(0.28, 1 - (pl.t / 12) * 0.72)
      if (pl.beepT >= interval) {
        pl.beepT = 0
        audio.plantBeep()
      }
      if (pl.t >= 12) {
        pl.done = true
        fx.explosion(new THREE.Vector3(0, 1.6, -61), 3)
        audio.explosion(1.5)
        missionEvents.emit('relayDetonated')
        playerRef.shake = 1
        if (useGame.getState().objectiveIndex === IDX.plant) completeObjectiveFlow()
      }
    }

    switch (idx) {
      case IDX.enter: // 0: through the south gate
        if (p.z < 40) completeObjectiveFlow()
        break
      case IDX.patrol: // 1: eliminate the patrol (kill delta)
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case IDX.market: // 2: cross the market -> CINEMATIC 1 (car ambush)
        if (p.z < 4) {
          if (!cineDone.current) {
            cineDone.current = true
            if (mapRefs.cineCarId) damageables.damage(mapRefs.cineCarId, 999)
            fx.dust(new THREE.Vector3(p.x, 0.5, p.z), 2)
          }
          completeObjectiveFlow()
          // AMBUSH banner after completeObjectiveFlow so it isn't instantly replaced.
          useGame.getState().showBanner('AMBUSH', 'Vehicle explosion blocking the street', 3200)
        }
        break
      case IDX.roofs: // 3: clear the rooftops (kill delta)
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case IDX.plaza: // 4: reach the plaza
        if (p.z < -22) completeObjectiveFlow()
        break
      case IDX.vehicle: // 5: destroy the gun truck (event-driven; also catches pre-destroyed)
        if (mapRefs.truckDestroyed) completeObjectiveFlow()
        break
      case IDX.comms: // 6: inside the comms building zone
        if (Math.abs(p.x) < 6 && p.z < -52 && p.z > -64) completeObjectiveFlow()
        break
      case IDX.plant: // 7: wait for the 12s countdown (handled above)
        break
      case IDX.escape: // 8: back to the south gate extraction
        if (p.z > 42) completeObjectiveFlow() // -> MISSION COMPLETE flow in GameState
        break
      default:
        break
    }

    // ---- adaptive music (every 0.5s) ----
    musicT.current += dt
    if (musicT.current >= 0.5) {
      musicT.current = 0
      const st = useGame.getState()
      if (st.status === 'complete') {
        audio.setMusicMode('complete')
      } else if (st.status === 'playing') {
        let mode = 'explore'
        if (st.hp < 35) {
          mode = 'critical'
        } else {
          const pp = playerRef.position
          const list = enemyRegistry.alive()
          for (let i = 0; i < list.length; i++) {
            if (list[i].getPosition().distanceToSquared(pp) < 3600) {
              mode = 'combat'
              break
            }
          }
        }
        audio.setMusicMode(mode)
      }
    }

    // ---- mission timer (throttled setState, 1s) ----
    missionTime.current += dt
    timeT.current += dt
    if (timeT.current >= 1) {
      timeT.current = 0
      useGame.setState({ missionTime: missionTime.current })
    }
  })

  if (mission !== 'desert') return null
  return null
}
