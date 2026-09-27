// Original weapon designs. Stats: damage per projectile, rpm, recoil (deg kick),
// spread (radians), magSize, reloadTime (s), range (m), pellets.
export const WEAPONS = {
  AR7: {
    id: 'AR7', name: 'AR-7', desc: 'Assault rifle',
    damage: 26, rpm: 720, recoil: 0.55, spread: 0.014,
    magSize: 30, startReserve: 120, reloadTime: 1.9, range: 130,
    pellets: 1, auto: true, tracer: 0xffd27a,
  },
  KX9: {
    id: 'KX9', name: 'KX-9', desc: 'SMG',
    damage: 19, rpm: 900, recoil: 0.38, spread: 0.030,
    magSize: 32, startReserve: 160, reloadTime: 1.7, range: 65,
    pellets: 1, auto: true, tracer: 0x9adcff,
  },
  M12: {
    id: 'M12', name: 'M12 Tactical', desc: 'Shotgun',
    damage: 12, rpm: 75, recoil: 2.4, spread: 0.055,
    magSize: 6, startReserve: 30, reloadTime: 2.9, range: 30,
    pellets: 8, auto: false, tracer: 0xffb37a,
  },
  VX: {
    id: 'VX', name: 'VX Marksman', desc: 'DMR',
    damage: 85, rpm: 150, recoil: 1.5, spread: 0.0025,
    magSize: 5, startReserve: 25, reloadTime: 2.5, range: 220,
    pellets: 1, auto: false, tracer: 0xd6ff9a,
  },
}

export const WEAPON_ORDER = ['AR7', 'KX9', 'M12', 'VX']
