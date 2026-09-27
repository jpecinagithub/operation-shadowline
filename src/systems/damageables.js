// Destructible props (vehicles etc). Map registers; weapons/grenades damage via id.
const items = new Map()
let seq = 1

export const damageables = {
  register(cfg) { // {position:[x,y,z], radius, hp, onDeath(pos), onDamaged(hpLeft)}
    const id = `d${seq++}`
    items.set(id, { id, alive: true, ...cfg })
    return id
  },
  unregister(id) { items.delete(id) },
  clear() { items.clear(); seq = 1 },
  damage(id, amount) {
    const d = items.get(id)
    if (!d || !d.alive) return false
    d.hp -= amount
    d.onDamaged && d.onDamaged(Math.max(0, d.hp))
    if (d.hp <= 0) { d.alive = false; d.onDeath && d.onDeath() }
    return true
  },
  /** ray-sphere against destructibles; returns {id, dist, point} or null */
  raycast(origin, dir, maxDist) {
    let best = null
    for (const d of items.values()) {
      if (!d.alive) continue
      const cx = d.position[0] - origin.x, cy = d.position[1] - origin.y, cz = d.position[2] - origin.z
      const t = cx * dir.x + cy * dir.y + cz * dir.z
      if (t < 0 || t > maxDist) continue
      const px = origin.x + dir.x * t - d.position[0]
      const py = origin.y + dir.y * t - d.position[1]
      const pz = origin.z + dir.z * t - d.position[2]
      const dist2 = px * px + py * py + pz * pz
      const r = d.radius || 1.5
      if (dist2 < r * r && (!best || t < best.dist)) {
        best = { id: d.id, dist: t, point: [origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t] }
      }
    }
    return best
  },
  /** radial damage around pos */
  radial(pos, radius, amount) {
    for (const d of items.values()) {
      if (!d.alive) continue
      const dx = d.position[0] - pos.x, dy = d.position[1] - pos.y, dz = d.position[2] - pos.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < radius) this.damage(d.id, amount * (1 - dist / radius))
    }
  },
}
