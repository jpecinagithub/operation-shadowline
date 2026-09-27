// Logic test: ammo smart-targeting + zone helpers (no browser needed).
globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null },
  setItem(k, v) { this._s[k] = String(v) },
  removeItem(k) { delete this._s[k] },
}
globalThis.performance = globalThis.performance || { now: () => Date.now() }

const { useGame } = await import('../src/systems/GameState.js')
const { pickups, collectPickup } = await import('../src/systems/pickups.js')
const { enemiesInZone } = await import('../src/systems/radar.js')
const { enemyRegistry } = await import('../src/enemies/enemyRegistry.js')

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log('  ok:', name) }
  else { fail++; console.log('  FAIL:', name) }
}

// --- 1. drop goes to the neediest weapon (KX9 empty, AR7 full)
useGame.setState({
  weapons: ['AR7', 'KX9'],
  currentWeapon: 'AR7',
  ammo: { AR7: { mag: 30, reserve: 240 }, KX9: { mag: 32, reserve: 0 } },
})
pickups.clear()
pickups.spawn({ kind: 'ammo', pos: [0, 0, 0] })
check('collect returns ok', collectPickup(pickups.list[0]) === 'ok')
check('KX9 got a full mag (32)', useGame.getState().ammo.KX9.reserve === 32)
check('AR7 untouched', useGame.getState().ammo.AR7.reserve === 240)
check('box consumed', pickups.list.length === 0)

// --- 2. tie -> current weapon wins
useGame.setState({
  weapons: ['AR7', 'KX9'],
  currentWeapon: 'KX9',
  ammo: { AR7: { mag: 30, reserve: 0 }, KX9: { mag: 32, reserve: 0 } },
})
pickups.spawn({ kind: 'ammo', pos: [0, 0, 0] })
collectPickup(pickups.list[0])
check('tie goes to current weapon (KX9)', useGame.getState().ammo.KX9.reserve === 32)

// --- 3. all full -> 'full', box stays
useGame.setState({
  ammo: { AR7: { mag: 30, reserve: 240 }, KX9: { mag: 32, reserve: 320 } },
})
pickups.spawn({ kind: 'ammo', pos: [0, 0, 0] })
check("collect returns 'full'", collectPickup(pickups.list[0]) === 'full')
check('box stays on ground', pickups.list.length === 1)

// --- 4. zones
enemyRegistry.clear()
const reg = (x, y, z) => enemyRegistry.register({ getPosition: () => ({ x, y, z }), alive: true, hp: 100 })
reg(0, 8.2, -40) // office floor
reg(5, 0.2, 10) // street
reg(-3, 0.2, 40) // avenue (behind)
reg(2, -10, 0) // fell through world
check('offices zone finds 1', enemiesInZone({ yMin: 6.5 }).length === 1)
check('street zone finds 1 (excludes avenue + glitched)',
  enemiesInZone({ yMin: -2, yMax: 3, zMin: -20, zMax: 28 }).length === 1)
enemyRegistry.clear()
check('empty offices zone -> objective would complete', enemiesInZone({ yMin: 6.5 }).length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
