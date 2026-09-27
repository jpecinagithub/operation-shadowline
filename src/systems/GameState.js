// Global game state (zustand). Single source of truth for UI + gameplay.
// Per-frame mutable data (position, yaw/pitch) lives in playerRef.js instead.
import { create } from 'zustand'
import { WEAPONS } from '../weapons/weaponData.js'
import { MISSIONS } from '../missions/missionData.js'
import { playerRef } from '../player/playerRef.js'
import { computeScore, saveScore, getPlayerName, setPlayerName as persistName } from './scores.js'

const freshAmmo = () => {
  const a = {}
  for (const id of Object.keys(WEAPONS)) a[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].startReserve }
  return a
}

export const useGame = create((set, get) => ({
  // ---- navigation ----
  screen: 'menu', // menu | missions | controls | settings | game
  mission: 'desert', // desert | arctic | urban
  status: 'playing', // playing | paused | dead | complete

  // ---- settings ----
  settings: { sensitivity: 1.0, volume: 0.8, quality: 'high' },
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  // ---- operator identity + score registry ----
  playerName: getPlayerName(),
  nameModal: null, // null | { missionId } | { rename: true }
  lastScore: null, // { score, rank, isRecord, kills, time } of the last completed mission

  setPlayerName: (name) => {
    const clean = (name || '').trim().slice(0, 12) || 'OPERATOR'
    persistName(clean)
    set({ playerName: clean })
  },
  // Deploy flow: ask for callsign first if we don't have one yet.
  requestDeploy: (missionId) => {
    if (!get().playerName) set({ nameModal: { missionId } })
    else get().startMission(missionId, MISSIONS[missionId])
  },
  submitName: (name) => {
    get().setPlayerName(name)
    const m = get().nameModal
    set({ nameModal: null })
    if (m && m.missionId) get().startMission(m.missionId, MISSIONS[m.missionId])
  },
  cancelNameModal: () => set({ nameModal: null }),
  openRename: () => set({ nameModal: { rename: true } }),

  // ---- player ----
  hp: 100,
  maxHp: 100,
  lastDamageAt: 0,
  weapons: ['AR7', 'KX9'],
  currentWeapon: 'AR7',
  ammo: freshAmmo(),
  grenades: 2,
  ads: false,
  sprint: false,
  crouch: false,
  reloading: false,

  // ---- mission ----
  objectives: [],
  objectiveIndex: 0,
  kills: 0,
  missionTime: 0,

  // ---- events: incrementing counters, consumed via subscribe ----
  ev: { shoot: 0, hit: 0, kill: 0, hurt: 0, reload: 0, explosion: 0, objective: 0, interact: 0, checkpoint: 0, pickup: 0 },
  emit: (name) => set((s) => ({ ev: { ...s.ev, [name]: (s.ev[name] || 0) + 1 } })),

  // ---- banner (OBJECTIVE COMPLETE etc): {title, sub} | null ----
  banner: null,
  showBanner: (title, sub = '', ms = 2600) => {
    set({ banner: { title, sub, key: Date.now() } })
    clearTimeout(get()._bannerT)
    set({ _bannerT: setTimeout(() => set({ banner: null }), ms) })
  },
  _bannerT: null,

  // ---- actions ----
  setScreen: (screen) => set({ screen }),
  setMission: (mission) => set({ mission }),

  startMission: (missionId, missionDef) => {
    const def = MISSIONS[missionId] || missionDef
    // Synchronous player reset: avoids a race where the first frame's mission logic
    // could read the stale default playerRef position before PlayerController mounts.
    if (def && def.spawn) playerRef.reset(def.spawn[0], def.spawn[1], def.spawn[2], def.spawnYaw)
    set({
      screen: 'game', mission: missionId, status: 'playing',
      hp: 100, lastDamageAt: 0,
      weapons: missionDef.weapons, currentWeapon: missionDef.weapons[0],
      ammo: freshAmmo(), grenades: 2,
      ads: false, sprint: false, crouch: false, reloading: false,
      objectives: missionDef.objectives, objectiveIndex: 0,
      kills: 0, missionTime: 0,
      banner: null, lastScore: null,
      ev: { shoot: 0, hit: 0, kill: 0, hurt: 0, reload: 0, explosion: 0, objective: 0, interact: 0, checkpoint: 0, pickup: 0 },
    })
  },

  damagePlayer: (amount) => {
    const s = get()
    if (s.status !== 'playing' || s.hp <= 0) return
    const hp = Math.max(0, s.hp - amount)
    set({ hp, lastDamageAt: performance.now() })
    s.emit('hurt')
    if (hp <= 0) set({ status: 'dead' })
  },

  healPlayer: (amount) => set((s) => ({ hp: Math.min(s.maxHp, s.hp + amount) })),

  consumeAmmo: (weaponId, n = 1) => {
    const s = get()
    const a = s.ammo[weaponId]
    if (!a || a.mag < n) return false
    set({ ammo: { ...s.ammo, [weaponId]: { ...a, mag: a.mag - n } } })
    return true
  },

  doReload: (weaponId) => {
    const s = get()
    const a = s.ammo[weaponId]
    const w = WEAPONS[weaponId]
    if (!a || s.reloading || a.mag >= w.magSize || a.reserve <= 0) return false
    set({ reloading: true })
    s.emit('reload')
    const need = w.magSize - a.mag
    const take = Math.min(need, a.reserve)
    setTimeout(() => {
      const cur = get()
      const ca = cur.ammo[weaponId]
      set({
        reloading: false,
        ammo: { ...cur.ammo, [weaponId]: { mag: ca.mag + take, reserve: ca.reserve - take } },
      })
    }, w.reloadTime * 1000)
    return true
  },

  switchWeapon: (weaponId) => {
    const s = get()
    if (!s.weapons.includes(weaponId) || s.currentWeapon === weaponId || s.reloading) return
    set({ currentWeapon: weaponId, ads: false })
  },

  throwGrenade: () => {
    const s = get()
    if (s.grenades <= 0) return false
    set({ grenades: s.grenades - 1 })
    return true
  },

  addKill: () => set((s) => ({ kills: s.kills + 1 })),

  // Add reserve ammo for a weapon, capped at maxReserve. Returns amount added.
  addReserveAmmo: (weaponId, amount) => {
    const s = get()
    const w = WEAPONS[weaponId]
    const a = s.ammo[weaponId]
    if (!w || !a || amount <= 0) return 0
    const add = Math.min(amount, Math.max(0, w.maxReserve - a.reserve))
    if (add > 0) set({ ammo: { ...s.ammo, [weaponId]: { ...a, reserve: a.reserve + add } } })
    return add
  },

  // Resupply crates: refill every carried weapon's reserve + grenades.
  resupplyAll: () => {
    const s = get()
    const ammo = { ...s.ammo }
    for (const id of s.weapons) {
      const w = WEAPONS[id]
      if (w && ammo[id]) ammo[id] = { ...ammo[id], reserve: w.maxReserve }
    }
    set({ ammo, grenades: 2 })
  },

  completeObjective: () => {
    const s = get()
    const idx = s.objectiveIndex
    if (idx >= s.objectives.length) return
    const done = s.objectives[idx]
    const next = idx + 1
    set({ objectiveIndex: next })
    s.emit('objective')
    if (next >= s.objectives.length) {
      s.showBanner('MISSION COMPLETE', done.title, 4000)
      // Record the score once (completeObjective can't fire twice for the same
      // run: objectiveIndex stays at objectives.length afterwards).
      try {
        const st = get()
        const score = computeScore({
          kills: st.kills,
          objectives: st.objectives.length,
          missionTime: st.missionTime,
          mission: st.mission,
        })
        const res = saveScore(st.mission, {
          name: st.playerName || 'OPERATOR',
          score,
          kills: st.kills,
          time: Math.round(st.missionTime),
          date: Date.now(),
        })
        set({ lastScore: { score, kills: st.kills, time: st.missionTime, rank: res.rank, isRecord: res.isRecord } })
      } catch {
        /* score registry optional */
      }
      setTimeout(() => set({ status: 'complete' }), 2500)
    } else {
      s.showBanner('OBJECTIVE COMPLETE', done.title)
      setTimeout(() => {
        const n = get().objectives[get().objectiveIndex]
        if (n && get().status === 'playing') get().showBanner('NEW OBJECTIVE', n.title + ' — ' + n.desc, 3200)
      }, 2800)
    }
  },

  pause: () => { if (get().status === 'playing') set({ status: 'paused' }) },
  resume: () => { if (get().status === 'paused') set({ status: 'playing' }) },
  quitToMenu: () => set({ screen: 'menu', status: 'playing', banner: null }),
}))
