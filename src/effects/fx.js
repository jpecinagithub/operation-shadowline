// FX request queue. Gameplay code pushes requests; <EffectsRenderer/> (effects/Effects.jsx)
// consumes them each frame and renders pooled particles. Positions as THREE.Vector3.
const queue = []

export const fx = {
  explosion(pos, scale = 1) { queue.push({ type: 'explosion', pos: pos.clone(), scale }) },
  impact(pos, normal, material = 'concrete') {
    queue.push({ type: 'impact', pos: pos.clone(), normal: normal ? normal.clone() : null, material })
  },
  muzzle(pos, dir) { queue.push({ type: 'muzzle', pos: pos.clone(), dir: dir.clone() }) },
  tracer(from, to, color = 0xffd27a) { queue.push({ type: 'tracer', from: from.clone(), to: to.clone(), color }) },
  smoke(pos, scale = 1, duration = 6) { queue.push({ type: 'smoke', pos: pos.clone(), scale, duration }) },
  blood(pos, dir) { queue.push({ type: 'blood', pos: pos.clone(), dir: dir.clone() }) },
  sparks(pos, dir) { queue.push({ type: 'sparks', pos: pos.clone(), dir: dir.clone() }) },
  dust(pos, scale = 1) { queue.push({ type: 'dust', pos: pos.clone(), scale }) },
  consume() { const q = queue.slice(); queue.length = 0; return q; },
  clear() { queue.length = 0 },
}
