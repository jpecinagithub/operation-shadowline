// 100% procedural audio via Web Audio API. No samples, no external assets.
// Singleton: import { audio } from './AudioManager.js'
class AudioManager {
  constructor() {
    this.ctx = null
    this.master = null
    this.musicGain = null
    this.sfxGain = null
    this.noiseBuf = null
    this.musicMode = 'explore' // explore | combat | critical | complete
    this.musicTimer = null
    this.step = 0
    this.volume = 0.8
    this.initialized = false
  }

  init() {
    if (this.initialized) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(this.ctx.destination)
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master)
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.35; this.musicGain.connect(this.master)
    // shared noise buffer (2s)
    const len = this.ctx.sampleRate * 2
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.initialized = true
    this.startMusic()
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume() }

  setVolume(v) {
    this.volume = v
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  // ---------- helpers ----------
  _noise(dur, { freq = 1000, q = 1, type = 'lowpass', gain = 0.5, decay = 0.1, at = 0 } = {}) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + at
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + decay)
    src.connect(f); f.connect(g); g.connect(this.sfxGain)
    src.start(t); src.stop(t + dur + decay + 0.05)
  }

  _tone(freq, dur, { type = 'sine', gain = 0.3, slideTo = null, at = 0, dest = null } = {}) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + at
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g); g.connect(dest || this.sfxGain)
    o.start(t); o.stop(t + dur + 0.05)
  }

  // ---------- SFX ----------
  shoot(id) {
    if (!this.ctx) return
    switch (id) {
      case 'AR7':
        this._noise(0.12, { freq: 1800, type: 'lowpass', gain: 0.7, decay: 0.08 })
        this._tone(160, 0.1, { type: 'square', gain: 0.25, slideTo: 60 })
        break
      case 'KX9':
        this._noise(0.09, { freq: 2400, type: 'lowpass', gain: 0.55, decay: 0.06 })
        this._tone(220, 0.08, { type: 'square', gain: 0.2, slideTo: 90 })
        break
      case 'M12':
        this._noise(0.25, { freq: 900, type: 'lowpass', gain: 0.9, decay: 0.2 })
        this._tone(110, 0.22, { type: 'square', gain: 0.35, slideTo: 40 })
        break
      case 'VX':
        this._noise(0.2, { freq: 3200, type: 'bandpass', gain: 0.7, decay: 0.15 })
        this._tone(300, 0.12, { type: 'sawtooth', gain: 0.22, slideTo: 80 })
        this._noise(0.4, { freq: 500, type: 'lowpass', gain: 0.4, decay: 0.3, at: 0.02 })
        break
      default:
        this._noise(0.1, { freq: 1500, gain: 0.5, decay: 0.08 })
    }
  }

  enemyShoot(dist = 20) {
    const g = Math.max(0.05, 0.5 - dist * 0.012)
    this._noise(0.1, { freq: 1200, type: 'lowpass', gain: g, decay: 0.08 })
    this._tone(140, 0.09, { type: 'square', gain: g * 0.5, slideTo: 55 })
  }

  reload() {
    this._tone(900, 0.05, { type: 'square', gain: 0.12 })
    this._tone(500, 0.05, { type: 'square', gain: 0.12, at: 0.18 })
    this._tone(1200, 0.06, { type: 'square', gain: 0.14, at: 0.55 })
  }

  dryFire() { this._tone(1400, 0.04, { type: 'square', gain: 0.1 }) }

  explosion(big = 1) {
    this._noise(1.2 * big, { freq: 300, type: 'lowpass', gain: 1.0, decay: 0.8 })
    this._tone(70, 0.9 * big, { type: 'sine', gain: 0.7, slideTo: 28 })
    this._noise(0.3, { freq: 4000, type: 'highpass', gain: 0.35, decay: 0.2 })
  }

  impact(material = 'concrete') {
    const f = { concrete: 2500, metal: 3800, wood: 1400, dirt: 700, flesh: 500 }[material] || 2000
    this._noise(0.07, { freq: f, type: 'bandpass', q: 2, gain: 0.35, decay: 0.05 })
  }

  ricochet() { this._tone(2800, 0.18, { type: 'sine', gain: 0.08, slideTo: 4200 }) }

  footstep(run = false) {
    this._noise(0.06, { freq: 400 + Math.random() * 200, type: 'lowpass', gain: run ? 0.22 : 0.14, decay: 0.05 })
  }

  hurt() {
    this._tone(180, 0.25, { type: 'sawtooth', gain: 0.3, slideTo: 90 })
    this._noise(0.2, { freq: 600, type: 'lowpass', gain: 0.3, decay: 0.15 })
  }

  heartbeat() {
    this._tone(55, 0.12, { type: 'sine', gain: 0.5 })
    this._tone(50, 0.12, { type: 'sine', gain: 0.4, at: 0.18 })
  }

  uiClick() { this._tone(700, 0.05, { type: 'square', gain: 0.12 }) }
  uiHover() { this._tone(500, 0.03, { type: 'square', gain: 0.05 }) }

  objective() {
    this._tone(523, 0.15, { type: 'sine', gain: 0.25 })
    this._tone(784, 0.25, { type: 'sine', gain: 0.25, at: 0.14 })
  }

  alarm() {
    for (let i = 0; i < 3; i++) {
      this._tone(660, 0.3, { type: 'square', gain: 0.15, at: i * 0.7 })
      this._tone(520, 0.3, { type: 'square', gain: 0.15, at: i * 0.7 + 0.35 })
    }
  }

  plantBeep() { this._tone(1200, 0.08, { type: 'square', gain: 0.15 }) }
  downloadTick() { this._tone(1500, 0.03, { type: 'square', gain: 0.07 }) }

  helicopter() {
    // looping chop while active; caller should call stopHeli()
    if (this._heli) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 28
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 13
    const lg = this.ctx.createGain(); lg.gain.value = 0.25
    lfo.connect(lg); lg.connect(o.frequency)
    const g = this.ctx.createGain(); g.gain.value = 0.12
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400
    o.connect(f); f.connect(g); g.connect(this.sfxGain)
    o.start(t); lfo.start(t)
    this._heli = { o, lfo, g }
  }
  stopHeli() {
    if (!this._heli) return
    const { o, lfo, g } = this._heli
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5)
    setTimeout(() => { try { o.stop(); lfo.stop() } catch {} }, 1500)
    this._heli = null
  }

  // ---------- adaptive music ----------
  setMusicMode(mode) { this.musicMode = mode }

  startMusic() {
    if (this.musicTimer || !this.ctx) return
    // D minor-ish dark military pulse. 8th-note scheduler.
    const bassLine = [73.4, 73.4, 87.3, 73.4, 65.4, 73.4, 98, 87.3] // D D F D C D G F
    const padChords = [[146.8, 174.6, 220], [138.6, 164.8, 207.7]] // Dm, Cm-ish
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return
      const mode = this.musicMode
      const s = this.step++
      const bar = Math.floor(s / 8) % 2
      if (mode === 'explore') {
        if (s % 16 === 0) padChords[bar].forEach(f => this._tone(f, 3.5, { type: 'triangle', gain: 0.05, dest: this.musicGain }))
        if (s % 8 === 4 && Math.random() < 0.4) this._tone(bassLine[s % 8] / 2, 1.2, { type: 'sine', gain: 0.08, dest: this.musicGain })
      } else if (mode === 'combat' || mode === 'critical') {
        const fast = mode === 'critical'
        if (s % 2 === 0) this._tone(bassLine[(s / 2) % 8 | 0], 0.22, { type: 'sawtooth', gain: fast ? 0.11 : 0.08, dest: this.musicGain })
        if (s % 4 === 2) this._noise(0.08, { freq: 6000, type: 'highpass', gain: 0.10, decay: 0.05 })
        if (s % 8 === 0) this._tone(36.7, 0.4, { type: 'sine', gain: 0.22, dest: this.musicGain })
        if (fast && s % 2 === 1) this._tone(bassLine[(s % 8)] * 2, 0.12, { type: 'square', gain: 0.04, dest: this.musicGain })
      } else if (mode === 'complete') {
        if (s % 8 === 0) [293.7, 369.9, 440, 587.3].forEach((f, i) => this._tone(f, 1.5, { type: 'triangle', gain: 0.07, at: i * 0.12, dest: this.musicGain }))
      }
    }, 240)
  }
}

export const audio = new AudioManager()
