// Interactables: press F near one to trigger. Maps register them; PlayerController consumes.
const items = new Map()
let seq = 1

export const interactables = {
  register(cfg) { // {position:Vector3-like [x,y,z], radius, prompt, onInteract}
    const id = `i${seq++}`
    items.set(id, { id, ...cfg })
    return id
  },
  unregister(id) { items.delete(id) },
  clear() { items.clear(); seq = 1 },
  /** nearest interactable within its radius of pos */
  nearest(pos) {
    let best = null; let bd = Infinity
    for (const it of items.values()) {
      const dx = it.position[0] - pos.x, dy = it.position[1] - pos.y, dz = it.position[2] - pos.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < (it.radius || 2.5) && d < bd) { bd = d; best = it }
    }
    return best
  },
}
