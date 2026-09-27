// EffectsRenderer — pooled, zero-allocation-per-frame particle effects.
// Consumes fx.consume() requests and renders: explosion, impact (+decals),
// muzzle flash (+single point light), tracers, blood, sparks, dust, smoke.
// All content original; no textures, only a procedural radial-gradient sprite.
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fx } from './fx.js'

// ---------- pool sizes ----------
const SPRITE_POOL = 220
const TRACER_POOL = 24
const RING_POOL = 4
const DECAL_POOL = 24

// ---------- module temps (reused, never allocated in hot loop) ----------
const _q = new THREE.Quaternion()
const _zAxis = new THREE.Vector3(0, 0, 1)
const _mid = new THREE.Vector3()

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[(Math.random() * arr.length) | 0]

let _softTex = null
function softTexture() {
  if (_softTex) return _softTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  _softTex = new THREE.CanvasTexture(c)
  return _softTex
}

const DUST_BY_MATERIAL = {
  concrete: 0x8d8d94,
  metal: 0xb9bec7,
  wood: 0xa98a5f,
  dirt: 0xc2a36b,
  sand: 0xc2a36b,
  default: 0x9a9a9a,
}

// ---------- pool construction (once) ----------
function buildPools() {
  const tex = softTexture()

  const sprites = []
  for (let i = 0; i < SPRITE_POOL; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.visible = false
    sprite.frustumCulled = true
    sprites.push({
      sprite, mat,
      vel: new THREE.Vector3(),
      alive: false, life: 0, maxLife: 1,
      gravity: 0, drag: 0, fadeIn: 0,
      size0: 1, size1: 1, opacity0: 1,
    })
  }

  const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1)
  const tracers = []
  for (let i = 0; i < TRACER_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const mesh = new THREE.Mesh(tracerGeo, mat)
    mesh.visible = false
    mesh.frustumCulled = false
    tracers.push({ mesh, mat, alive: false, life: 0, maxLife: 0.07 })
  }

  const ringGeo = new THREE.TorusGeometry(1, 0.045, 8, 40)
  ringGeo.rotateX(-Math.PI / 2) // lie flat on XZ
  const rings = []
  for (let i = 0; i < RING_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcf7a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const mesh = new THREE.Mesh(ringGeo, mat)
    mesh.visible = false
    mesh.frustumCulled = false
    rings.push({ mesh, mat, alive: false, life: 0, maxLife: 0.45, s0: 1, s1: 10 })
  }

  const decalGeo = new THREE.PlaneGeometry(0.42, 0.42)
  const decals = []
  for (let i = 0; i < DECAL_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x100c08, transparent: true, opacity: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    })
    const mesh = new THREE.Mesh(decalGeo, mat)
    mesh.visible = false
    decals.push({ mesh, mat, alive: false, life: 0, maxLife: 14 })
  }

  return { sprites, tracers, rings, decals }
}

// ---------- spawning ----------
// Steals the oldest (least life left) particle when the pool is exhausted.
function spawnSprite(P, o) {
  let idx = -1
  let oldestLife = Infinity
  let oldestIdx = 0
  for (let i = 0; i < P.sprites.length; i++) {
    const p = P.sprites[i]
    if (!p.alive) { idx = i; break }
    if (p.life < oldestLife) { oldestLife = p.life; oldestIdx = i }
  }
  const p = P.sprites[idx === -1 ? oldestIdx : idx]
  p.alive = true
  p.life = p.maxLife = o.maxLife
  p.sprite.position.copy(o.pos)
  p.vel.copy(o.vel || ZERO)
  p.gravity = o.gravity || 0
  p.drag = o.drag || 0
  p.fadeIn = o.fadeIn || 0
  p.size0 = o.size0
  p.size1 = o.size1
  p.opacity0 = o.opacity !== undefined ? o.opacity : 1
  p.mat.color.set(o.color)
  p.mat.opacity = p.opacity0
  p.mat.blending = o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending
  p.mat.depthWrite = false
  p.sprite.visible = true
  const s = o.size0
  p.sprite.scale.set(s, s, 1)
}
const ZERO = new THREE.Vector3(0, 0, 0)

function spawnRing(P, pos, s1, maxLife, color) {
  let r = P.rings.find((x) => !x.alive)
  if (!r) { r = P.rings.reduce((a, b) => (a.life < b.life ? a : b)) }
  r.alive = true
  r.life = r.maxLife = maxLife
  r.s0 = 1
  r.s1 = s1
  r.mesh.position.copy(pos)
  r.mesh.position.y += 0.15
  r.mat.color.set(color)
  r.mesh.visible = true
}

function spawnTracer(P, from, to, color) {
  let t = P.tracers.find((x) => !x.alive)
  if (!t) { t = P.tracers.reduce((a, b) => (a.life < b.life ? a : b)) }
  const len = _mid.subVectors(to, from).length()
  if (len < 0.1) return
  t.alive = true
  t.life = t.maxLife = 0.07
  t.mesh.position.copy(from).add(to).multiplyScalar(0.5)
  t.mesh.lookAt(to)
  t.mesh.scale.set(1, 1, len)
  t.mat.color.set(color)
  t.mesh.visible = true
}

function spawnDecal(P, pos, normal) {
  let d = P.decals.find((x) => !x.alive)
  if (!d) { d = P.decals.reduce((a, b) => (a.life < b.life ? a : b)) }
  d.alive = true
  d.life = d.maxLife = 14
  d.mesh.position.copy(pos).addScaledVector(normal, 0.02)
  _q.setFromUnitVectors(_zAxis, normal)
  d.mesh.quaternion.copy(_q)
  d.mesh.visible = true
}

// ---------- effect emitters (called from the consume loop) ----------
const EMIT = {
  explosion(P, q) {
    const s = q.scale
    // flash
    spawnSprite(P, { pos: q.pos, maxLife: 0.12, color: 0xfff3c4, size0: 6 * s, size1: 7.5 * s, opacity: 1 })
    // fire
    for (let i = 0; i < 10; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(0.55, 0.8),
        color: pick([0xffb347, 0xff8c2e, 0xff6b1a, 0xffd76a]),
        vel: _mid.set(rand(-2.5, 2.5), rand(1.5, 4.5), rand(-2.5, 2.5)),
        gravity: 1.5, drag: 2.2, fadeIn: 0.02,
        size0: rand(1.0, 1.6) * s, size1: 0.4 * s, opacity: 1,
      })
    }
    // smoke — soft billows, never hard black cards: fade in gently, modest
    // opacity, lighter grays, capped growth (at close range a huge dark quad
    // reads as a "black panel" instead of smoke)
    for (let i = 0; i < 8; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(2.8, 3.8), additive: false,
        color: pick([0x55555e, 0x62626a, 0x4c4c55]),
        vel: _mid.set(rand(-1.2, 1.2), rand(1.2, 2.8), rand(-1.2, 1.2)),
        gravity: 1.2, drag: 1.1, fadeIn: 0.45,
        size0: rand(1.2, 1.8) * s, size1: rand(3.8, 4.8) * s, opacity: 0.38,
      })
    }
    // sparks
    for (let i = 0; i < 14; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(0.6, 0.9),
        color: pick([0xffd76a, 0xffb347, 0xfff3c4]),
        vel: _mid.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(6, 14) * Math.sqrt(s)),
        gravity: -18, drag: 0.8,
        size0: 0.32, size1: 0.12, opacity: 1,
      })
    }
    // shockwave
    spawnRing(P, q.pos, 10 * s, 0.45, 0xffcf7a)
  },

  impact(P, q) {
    const n = q.normal || UP
    const dustColor = DUST_BY_MATERIAL[q.material] ?? DUST_BY_MATERIAL.default
    // sparks, biased along the surface normal
    for (let i = 0; i < 5; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(0.25, 0.45),
        color: pick([0xffd76a, 0xffb347, 0xffffff]),
        vel: _mid.copy(n).multiplyScalar(rand(3, 7)).add(_rndVec.set(rand(-3, 3), rand(0, 3), rand(-3, 3))),
        gravity: -12, drag: 0.6,
        size0: 0.22, size1: 0.1, opacity: 1,
      })
    }
    // dust puff
    spawnSprite(P, {
      pos: q.pos, maxLife: rand(0.8, 1.1), additive: false,
      color: dustColor,
      vel: _mid.copy(n).multiplyScalar(1.2),
      gravity: 0.8, drag: 2.5,
      size0: 0.7, size1: 2.4, opacity: 0.55,
    })
    // decal
    spawnDecal(P, q.pos, n)
  },

  muzzle(P, q, sys) {
    spawnSprite(P, {
      pos: q.pos, maxLife: 0.08, color: 0xffd27a,
      size0: 1.1, size1: 1.7, opacity: 1,
    })
    sys.lightPos.copy(q.pos)
    sys.lightLife = 0.08
  },

  tracer(P, q) {
    spawnTracer(P, q.from, q.to, q.color)
  },

  blood(P, q) {
    for (let i = 0; i < 8; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(0.5, 0.7), additive: false,
        // bright arterial red: must read as blood even in the night map
        // (dark reds rendered as near-black quads and confused players)
        color: pick([0xc21616, 0xd41e1e, 0xa81212]),
        vel: _mid.copy(q.dir).multiplyScalar(rand(2, 6)).add(_rndVec.set(rand(-2.5, 2.5), rand(0, 3), rand(-2.5, 2.5))),
        gravity: -12, drag: 1.2,
        size0: rand(0.2, 0.3), size1: 0.12, opacity: 1,
      })
    }
  },

  sparks(P, q) {
    for (let i = 0; i < 6; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(0.35, 0.45),
        color: pick([0xffb347, 0xff8c2e]),
        vel: _mid.copy(q.dir).multiplyScalar(rand(4, 9)).add(_rndVec.set(rand(-2, 2), rand(0, 2), rand(-2, 2))),
        gravity: -10, drag: 0.6,
        size0: 0.2, size1: 0.08, opacity: 1,
      })
    }
  },

  dust(P, q) {
    const s = q.scale
    for (let i = 0; i < 4; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: rand(1.0, 1.4), additive: false,
        color: 0xc2a36b,
        vel: _mid.set(rand(-1.4, 1.4), rand(0.8, 1.6), rand(-1.4, 1.4)),
        gravity: 0.6, drag: 1.8,
        size0: 0.8 * s, size1: 2.6 * s, opacity: 0.5,
      })
    }
  },

  smoke(P, q) {
    const s = q.scale
    const d = q.duration
    for (let i = 0; i < 6; i++) {
      spawnSprite(P, {
        pos: q.pos, maxLife: d * rand(0.8, 1.1), additive: false,
        color: pick([0x6a6a70, 0x58585e, 0x76767c]),
        vel: _mid.set(rand(-0.8, 0.8), rand(1.0, 2.0), rand(-0.8, 0.8)),
        gravity: 1.0, drag: 1.0, fadeIn: 0.6,
        size0: rand(1.0, 1.4) * s, size1: rand(3.5, 4.5) * s, opacity: 0.38,
      })
    }
  },
}

const UP = new THREE.Vector3(0, 1, 0)
const _rndVec = new THREE.Vector3()

// ---------- per-frame update ----------
function updateSprites(P, dt) {
  const list = P.sprites
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p.alive) continue
    p.life -= dt
    if (p.life <= 0) {
      p.alive = false
      p.sprite.visible = false
      continue
    }
    const age = p.maxLife - p.life
    p.vel.y += p.gravity * dt
    const dr = 1 - p.drag * dt
    if (dr > 0) p.vel.multiplyScalar(dr)
    p.sprite.position.addScaledVector(p.vel, dt)
    const t = age / p.maxLife
    const size = p.size0 + (p.size1 - p.size0) * t
    p.sprite.scale.set(size, size, 1)
    let a = p.opacity0
    if (p.fadeIn > 0 && age < p.fadeIn) a *= age / p.fadeIn
    const fadeOut = p.maxLife * 0.25
    if (p.life < fadeOut) a *= p.life / fadeOut
    p.mat.opacity = a < 0 ? 0 : a
  }
}

function updateTracers(P, dt) {
  for (const t of P.tracers) {
    if (!t.alive) continue
    t.life -= dt
    if (t.life <= 0) {
      t.alive = false
      t.mesh.visible = false
      continue
    }
    t.mat.opacity = t.life / t.maxLife
  }
}

function updateRings(P, dt) {
  for (const r of P.rings) {
    if (!r.alive) continue
    r.life -= dt
    if (r.life <= 0) {
      r.alive = false
      r.mesh.visible = false
      continue
    }
    const t = 1 - r.life / r.maxLife
    const s = r.s0 + (r.s1 - r.s0) * t
    r.mesh.scale.set(s, 1, s)
    r.mat.opacity = 0.85 * (r.life / r.maxLife)
  }
}

function updateDecals(P, dt) {
  for (const d of P.decals) {
    if (!d.alive) continue
    d.life -= dt
    if (d.life <= 0) {
      d.alive = false
      d.mesh.visible = false
      continue
    }
    d.mat.opacity = 0.85 * (d.life / d.maxLife)
  }
}

// ---------- component ----------
export default function EffectsRenderer() {
  const poolsRef = useRef(null)
  if (!poolsRef.current) {
    poolsRef.current = buildPools()
    poolsRef.current.lightPos = new THREE.Vector3(0, -100, 0)
    poolsRef.current.lightLife = 0
  }
  const lightRef = useRef()

  useFrame((_, rawDt) => {
    const dt = rawDt > 0.05 ? 0.05 : rawDt
    const P = poolsRef.current

    // consume requests
    const reqs = fx.consume()
    for (let i = 0; i < reqs.length; i++) {
      const q = reqs[i]
      const fn = EMIT[q.type]
      if (fn) fn(P, q, P)
    }

    updateSprites(P, dt)
    updateTracers(P, dt)
    updateRings(P, dt)
    updateDecals(P, dt)

    // single dynamic muzzle light
    if (P.lightLife > 0) {
      P.lightLife -= dt
      if (lightRef.current) {
        lightRef.current.position.copy(P.lightPos)
        lightRef.current.intensity = P.lightLife > 0 ? 8 : 0
      }
    } else if (lightRef.current && lightRef.current.intensity !== 0) {
      lightRef.current.intensity = 0
    }
  })

  const P = poolsRef.current
  return (
    <group>
      {P.sprites.map((p, i) => (
        <primitive key={`s${i}`} object={p.sprite} />
      ))}
      {P.tracers.map((t, i) => (
        <primitive key={`t${i}`} object={t.mesh} />
      ))}
      {P.rings.map((r, i) => (
        <primitive key={`r${i}`} object={r.mesh} />
      ))}
      {P.decals.map((d, i) => (
        <primitive key={`d${i}`} object={d.mesh} />
      ))}
      <pointLight
        ref={lightRef}
        color="#ffcf7a"
        intensity={0}
        distance={9}
        decay={2}
      />
    </group>
  )
}
