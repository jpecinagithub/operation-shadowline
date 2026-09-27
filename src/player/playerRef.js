// Mutable per-frame player state. Written by PlayerController, read by everyone else.
// Avoids zustand churn at 60fps.
import * as THREE from 'three'

export const playerRef = {
  position: new THREE.Vector3(0, 1.7, 10),
  velocity: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  onGround: true,
  crouching: false,
  sprinting: false,
  ads: false,
  adsBlend: 0, // 0..1 smoothed
  alive: true,
  recoilPitch: 0, // accumulated by WeaponSystem, consumed+decayed by PlayerController
  recoilYaw: 0,
  shake: 0, // screen shake trauma 0..1, decays in PlayerController
  eyeHeight: 1.62,
  reset(x = 0, y = 1.7, z = 10, yaw = Math.PI) {
    this.position.set(x, y, z)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw; this.pitch = 0
    this.onGround = true; this.crouching = false; this.sprinting = false
    this.ads = false; this.adsBlend = 0; this.alive = true
    this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0
  },
}
