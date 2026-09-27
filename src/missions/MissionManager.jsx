// OPERATION SHADOWLINE — mission flow for all three missions (desert / arctic / urban).
// Watches player zones + kill deltas, advances objectives, runs cinematics,
// countdowns, reinforcements, checkpoints, adaptive music and mission timer.
// NOTE: each map file imports { missionEvents, spawnApi } from this file, and this file
// imports { ...MapRefs } from each map file. The cycle is safe: neither module touches the
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
import { arcticMapRefs } from '../maps/ArcticOutpost.jsx'
import { urbanMapRefs } from '../maps/UrbanBlackout.jsx'

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
// arctic.objectives: approach, guards, enter, hangar, data, download, alarm, exfil
const AIDX = { approach: 0, guards: 1, enter: 2, hangar: 3, data: 4, download: 5, alarm: 6, exfil: 7 }
// urban.objectives: avenue, street, enter, climb, offices, rescue, defend, evac
const UIDX = { avenue: 0, street: 1, enter: 2, climb: 3, offices: 4, rescue: 5, defend: 6, evac: 7 }
const DEFEND_TIME = 90 // seconds to hold during urban 'defend'

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
  // per-mission one-shot state (reset on mount)
  const arc = useRef({ depotDone: false, dl: null, alarmApplied: false })
  const urb = useRef({ fuelDone: false, climbStage: 0, def: null, departed: false, heliSent: false })

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

  const onObjectiveStart = (m, idx) => {
    const kills = useGame.getState().kills
    killsAtStart.current = kills
    if (m === 'desert') {
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
    } else if (m === 'arctic') {
      if (idx === AIDX.guards) {
        needKills.current = Math.max(1, Math.min(4, enemyRegistry.aliveCount()))
      } else if (idx === AIDX.hangar) {
        needKills.current = Math.max(1, Math.min(2, enemyRegistry.aliveCount()))
      } else if (idx === AIDX.alarm) {
        // Lockdown reinforcements converging on the yard / data center.
        enemyRegistry.requestSpawn({ pos: [-4, 0.6, -36], patrol: [[-4, -34], [-4, -40]] })
        enemyRegistry.requestSpawn({ pos: [6, 0.6, -30], patrol: [[6, -28], [6, -34]] })
      } else if (idx === AIDX.exfil) {
        // Gate ambush on the way out.
        enemyRegistry.requestSpawn({ pos: [-8, 0.6, 30], patrol: [[-8, 28], [-8, 34]] })
        enemyRegistry.requestSpawn({ pos: [8, 0.6, 34], patrol: [[8, 32], [8, 38]] })
      }
    } else if (m === 'urban') {
      if (idx === UIDX.street) {
        needKills.current = Math.max(1, Math.min(3, enemyRegistry.aliveCount()))
      } else if (idx === UIDX.offices) {
        needKills.current = Math.max(1, Math.min(4, enemyRegistry.aliveCount()))
      } else if (idx === UIDX.defend) {
        urb.current.def = { t: 0, wave: 0, b60: false, b30: false, b10: false }
        useGame.getState().showBanner('DEFEND THE POSITION', 'Hold 90 seconds', 3500)
      } else if (idx === UIDX.evac) {
        useGame.getState().showBanner('EVAC INBOUND', 'Board the helicopter', 3500)
      }
    }
  }

  // ---- mount: checkpoint restore, event subs, restart hook ----
  useEffect(() => {
    if (!MISSIONS[mission]) return
    // reset per-mission one-shot state (maps remount with runId, so their
    // module-level refs may still hold values from the previous run)
    arc.current = { depotDone: false, dl: null, alarmApplied: false }
    urb.current = { fuelDone: false, climbStage: 0, def: null, departed: false, heliSent: false }
    if (arcticMapRefs) arcticMapRefs.alarmFired = false
    if (urbanMapRefs) urbanMapRefs.heliArrived = false

    if (checkpointApi.pending) {
      const cp = checkpointApi.pending
      useGame.setState({ objectiveIndex: cp.objectiveIndex })
      playerRef.position.set(cp.pos[0], cp.pos[1], cp.pos[2])
      playerRef.yaw = cp.yaw
      checkpointApi.pending = null
      onObjectiveStart(mission, cp.objectiveIndex)
      prevIdx.current = cp.objectiveIndex
    } else {
      prevIdx.current = -1 // first useFrame tick fires onObjectiveStart(mission, 0)
    }
    killsAtStart.current = useGame.getState().kills
    needKills.current = 3
    missionTime.current = useGame.getState().missionTime || 0
    cineDone.current = false
    plant.current = null

    const unsubs = []
    if (mission === 'desert') {
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
      unsubs.push(missionEvents.on('truckDestroyed', onTruck))
      unsubs.push(missionEvents.on('relayPlanted', onPlanted))
    } else if (mission === 'arctic') {
      const onDlStart = () => {
        if (useGame.getState().objectiveIndex === AIDX.download && !arc.current.dl) {
          arc.current.dl = { t: 0, tickT: 0, done: false }
          useGame.getState().showBanner('DOWNLOADING INTEL', 'Stay by the terminal', 3200)
        }
      }
      unsubs.push(missionEvents.on('downloadStart', onDlStart))
    }
    // urban needs no event subs (fuelDestroyed is spectacle-only)

    // "RESTART CHECKPOINT" (EndScreens) calls this hook.
    window.__restartCheckpoint = () => {
      checkpointApi.pending = checkpointApi.saved
      const st = useGame.getState()
      const m = st.mission
      if (MISSIONS[m]) st.startMission(m, MISSIONS[m])
      useGame.setState((s) => ({ runId: (s.runId || 0) + 1 }))
    }
    return () => {
      unsubs.forEach((u) => u())
      if (window.__restartCheckpoint) delete window.__restartCheckpoint
    }
  }, [mission])

  // ---- arctic per-frame flow ----
  const tickArctic = (dt, g, idx, p) => {
    const A = arc.current
    // keep the alarm state applied (also after checkpoint restores mid-escape)
    if (idx >= AIDX.alarm && !A.alarmApplied) {
      A.alarmApplied = true
      missionEvents.emit('alarmOn')
    }
    // 10s download at the terminal
    const dl = A.dl
    if (dl && !dl.done) {
      dl.t += dt
      dl.tickT += dt
      if (dl.tickT >= 1) {
        dl.tickT = 0
        audio.downloadTick()
      }
      if (dl.t >= 10) {
        dl.done = true
        missionEvents.emit('alarmOn')
        A.alarmApplied = true
        if (arcticMapRefs) arcticMapRefs.alarmFired = true
        useGame.getState().showBanner('ALARM TRIGGERED', 'Lockdown — run!', 4000)
        if (useGame.getState().objectiveIndex === AIDX.download) completeObjectiveFlow()
      }
    }
    switch (idx) {
      case AIDX.approach: // 0: reach the outer fence
        if (p.z < 38) completeObjectiveFlow()
        break
      case AIDX.guards: // 1: eliminate the perimeter guards
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case AIDX.enter: // 2: through the main gate
        if (p.z < 23) completeObjectiveFlow()
        break
      case AIDX.hangar: // 3: clear the hangar
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case AIDX.data: // 4: reach the terminal room
        if (Math.abs(p.x) < 6 && p.z < -39 && p.z > -51) completeObjectiveFlow()
        break
      case AIDX.download: // 5: download timer handled above
        break
      case AIDX.alarm: // 6: run south — fuel depot cinematic in the yard
        if (!A.depotDone && p.x > -16 && p.x < 16 && p.z > -5 && p.z < 12) {
          A.depotDone = true
          if (arcticMapRefs.depotId) damageables.damage(arcticMapRefs.depotId, 999)
          useGame.getState().showBanner('FUEL DEPOT DESTROYED', 'Enemy fuel reserves burning', 3000)
        }
        if (p.z > 20) completeObjectiveFlow()
        break
      case AIDX.exfil: // 7: extraction pads near the south spawn
        if (p.z > 53 && Math.abs(p.x) < 6) completeObjectiveFlow()
        break
      default:
        break
    }
  }

  // ---- urban per-frame flow ----
  const urbanWave = (n) => {
    const W = [
      [
        { pos: [-6, 0.2, -33], patrol: [[-6, -33], [6, -33]], type: 'roof' },
        { pos: [6, 4.2, -40], patrol: [[6, -40], [-6, -40]], type: 'roof' },
      ],
      [
        { pos: [-6, 4.2, -38], patrol: [[-6, -38], [6, -42]], type: 'roof' },
        { pos: [5, 8.2, -45], patrol: [[5, -45], [-5, -47]], type: 'roof' },
      ],
      [
        { pos: [-5, 8.2, -44], patrol: [[-5, -44], [5, -46]], type: 'roof' },
        { pos: [8, 8.2, -47], patrol: [[8, -47], [-2, -48]], type: 'roof' },
      ],
    ]
    ;(W[n - 1] || []).forEach((s) => enemyRegistry.requestSpawn(s))
  }

  const tickUrban = (dt, g, idx, p) => {
    const U = urb.current
    // helicopter fly-in covers defend + evac (also re-armed after checkpoint restores)
    if (idx >= UIDX.defend && !U.heliSent && !urbanMapRefs.heliArrived) {
      U.heliSent = true
      missionEvents.emit('heliInbound')
    }
    switch (idx) {
      case UIDX.avenue: // 0: push up the avenue
        if (p.z < 28) completeObjectiveFlow()
        break
      case UIDX.street: // 1: fight between the vehicles — fuel truck cinematic
        if (!U.fuelDone && p.z < 14) {
          U.fuelDone = true
          if (urbanMapRefs.fuelId) damageables.damage(urbanMapRefs.fuelId, 999)
          useGame.getState().showBanner('AMBUSH', 'Fuel truck detonated', 3200)
        }
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case UIDX.enter: // 2: breach the tower lobby
        if (Math.abs(p.x) < 4 && p.z < -28 && p.z > -36) completeObjectiveFlow()
        break
      case UIDX.climb: // 3: floor 2, then floor 3
        if (U.climbStage === 0 && p.y > 3) {
          U.climbStage = 1
          useGame.getState().showBanner('FLOOR 2', 'Keep climbing', 2500)
        } else if (U.climbStage === 1 && p.y > 7) {
          completeObjectiveFlow()
        }
        break
      case UIDX.offices: // 4: clear floor hostiles
        if (g.kills - killsAtStart.current >= needKills.current) completeObjectiveFlow()
        break
      case UIDX.rescue: // 5: reach the allied-team room
        if (p.y > 7.5 && p.x > 4 && p.x < 12 && p.z < -42 && p.z > -50) completeObjectiveFlow()
        break
      case UIDX.defend: { // 6: 90s hold with reinforcement waves
        const d = U.def
        if (!d) break
        d.t += dt
        const left = Math.ceil(DEFEND_TIME - d.t)
        if (d.wave === 0) {
          d.wave = 1
          urbanWave(1)
        }
        if (d.t >= 30 && d.wave === 1) {
          d.wave = 2
          urbanWave(2)
        }
        if (d.t >= 60 && d.wave === 2) {
          d.wave = 3
          urbanWave(3)
        }
        if (!d.b60 && left <= 60) {
          d.b60 = true
          useGame.getState().showBanner('60 SECONDS', 'Hold the line', 2500)
        }
        if (!d.b30 && left <= 30) {
          d.b30 = true
          useGame.getState().showBanner('30 SECONDS', '', 2500)
        }
        if (!d.b10 && left <= 10) {
          d.b10 = true
          useGame.getState().showBanner('10 SECONDS', 'Evac inbound', 2500)
        }
        if (d.t >= DEFEND_TIME) completeObjectiveFlow()
        break
      }
      case UIDX.evac: { // 7: board the helicopter on the avenue
        const dx = p.x
        const dz = p.z + 20
        if (p.y < 2 && dx * dx + dz * dz < 25) {
          if (!U.departed) {
            U.departed = true
            missionEvents.emit('heliDepart')
          }
          completeObjectiveFlow()
        }
        break
      }
      default:
        break
    }
  }

  // ---- per-frame mission logic ----
  useFrame((_, rawDt) => {
    if (mission !== 'desert' && mission !== 'arctic' && mission !== 'urban') return
    const dt = Math.min(rawDt, 0.1)
    const g = useGame.getState()
    if (g.status !== 'playing') {
      if (g.status === 'complete') audio.setMusicMode('complete')
      return
    }
    const idx = g.objectiveIndex
    const p = playerRef.position

    if (idx !== prevIdx.current) {
      onObjectiveStart(mission, idx)
      prevIdx.current = idx
    }

    if (mission === 'arctic') {
      tickArctic(dt, g, idx, p)
    } else if (mission === 'urban') {
      tickUrban(dt, g, idx, p)
    } else {
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
    } // end desert branch

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

  // logic-only component (no visuals)
  return null
}
