# OPERATION SHADOWLINE — Build Contracts

Original military FPS. **No Call of Duty names, assets, sounds, or UI.** Everything original.
Stack: Vite + React 18 + three + @react-three/fiber@8 + @react-three/drei@9 + @react-three/rapier + zustand.
`npm run dev` / `npm run build` must stay green.

## Already written (DO NOT rewrite these — import from them)
- `src/systems/GameState.js` → `useGame` zustand store (screen, mission, status, hp, weapons,
  currentWeapon, ammo, grenades, ads/sprint/crouch/reloading, objectives/objectiveIndex,
  kills, ev counters, banner, actions: setScreen, setMission, startMission, damagePlayer,
  healPlayer, consumeAmmo, doReload, switchWeapon, throwGrenade, addKill, completeObjective,
  pause, resume, quitToMenu, showBanner, emit, setSettings)
- `src/systems/AudioManager.js` → `audio` singleton. Call `audio.init()` on first user gesture.
  Methods: shoot(id), enemyShoot(dist), reload(), dryFire(), explosion(big), impact(material),
  ricochet(), footstep(run), hurt(), heartbeat(), uiClick/uiHover, objective(), alarm(),
  plantBeep(), downloadTick(), helicopter()/stopHeli(), setMusicMode('explore'|'combat'|'critical'|'complete'), setVolume(v)
- `src/player/playerRef.js` → `playerRef` mutable: position, velocity, yaw, pitch, onGround,
  crouching, sprinting, ads, adsBlend, alive, recoilPitch, recoilYaw, shake, eyeHeight, reset()
- `src/weapons/weaponData.js` → `WEAPONS` {AR7,KX9,M12,VX} stats + `WEAPON_ORDER`
- `src/missions/missionData.js` → `MISSIONS` {desert, arctic, urban}; desert.playable=true
- `src/enemies/enemyRegistry.js` → `enemyRegistry`: register/unregister/clear,
  damage(id,amount,point,dir), raycast(origin,dir,maxDist)→{id,dist,point,enemy}|null,
  alive(), aliveCount(), alertNear(pos,radius), requestSpawn(cfg), consumeSpawns()
- `src/systems/interactables.js` → `interactables`: register({position:[x,y,z],radius,prompt,onInteract}), unregister, clear, nearest(pos)
- `src/systems/damageables.js` → `damageables`: register({position,radius,hp,onDeath,onDamaged}), damage(id,amount), raycast(...), radial(pos,radius,amount), clear
- `src/effects/fx.js` → `fx`: explosion(pos,scale), impact(pos,normal,material), muzzle(pos,dir),
  tracer(from,to,color), smoke(pos,scale,duration), blood(pos,dir), sparks(pos,dir), dust(pos,scale), consume(), clear()

## File ownership (each agent writes ONLY its files)
Agent SCAFFOLD: package.json(deps already installed—do not edit), index.html(done), vite.config.js(done),
  `src/main.jsx`, `src/App.jsx`, `src/components/Game.jsx`,
  `src/components/MainMenu.jsx`, `MissionSelect.jsx`, `Controls.jsx`, `Settings.jsx`,
  `src/components/HUD.jsx`, `PauseMenu.jsx`, `EndScreens.jsx`,
  `src/styles/game.css`, `README.md`
Agent PLAYER: `src/player/PlayerController.jsx`, `src/weapons/WeaponSystem.jsx`,
  `src/weapons/WeaponView.jsx`, `src/weapons/Grenades.jsx`
Agent ENEMIES: `src/enemies/EnemyManager.jsx`, `src/enemies/Enemy.jsx`, `src/enemies/ai.js` (optional helper)
Agent EFFECTS: `src/effects/Effects.jsx` (default export EffectsRenderer), `src/effects/Weather.jsx`
Agent MAP: `src/maps/DesertStrike.jsx`, `src/missions/MissionManager.jsx`

## Integration contract — `src/components/Game.jsx` (SCAFFOLD writes)
```jsx
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import PlayerController from '../player/PlayerController.jsx'
import WeaponSystem from '../weapons/WeaponSystem.jsx'
import WeaponView from '../weapons/WeaponView.jsx'
import Grenades from '../weapons/Grenades.jsx'
import EnemyManager from '../enemies/EnemyManager.jsx'
import EffectsRenderer from '../effects/Effects.jsx'
import Weather from '../effects/Weather.jsx'
import DesertStrike from '../maps/DesertStrike.jsx'
import MissionManager from '../missions/MissionManager.jsx'
// inside <Canvas shadows camera={{fov:75, near:0.05, far:600}}>:
//   <color attach="background" args={['#1a0f08']} /> + <fog> per mission inside map
//   <Physics gravity={[0,-22,0]}> ... all of the above, map by mission ...
//   MissionManager + EnemyManager rendered by the MAP component itself is also OK,
//   but Game.jsx rendering them is the default plan.
```
Order inside Physics does not matter. Map component includes its own lights (keep ≤3 shadow-casting).

## Input map (PLAYER implements; others read playerRef)
WASD move · mouse look (pointer lock) · Shift sprint · C or ControlLeft crouch · Space jump ·
R reload · F interact · 1/2/3/4 weapons · LMB fire · RMB ADS · G grenade · Esc pause ·
P or M mute (optional). Pointer lock requested on canvas click when status==='playing'.
Esc automatically exits pointer lock → PLAYER sets paused.

## Cross-module rules
- Player damage FROM enemies: enemies call `useGame.getState().damagePlayer(n)`.
- Enemy damage FROM player: WeaponSystem/Grenades use `enemyRegistry.damage(...)` and
  `damageables.damage(...)`. On enemy death Enemy.jsx calls `useGame.getState().addKill()`
  and `emit('kill')`.
- Gunshot noise: WeaponSystem calls `enemyRegistry.alertNear(playerPos, 45)`.
- Music intensity: MissionManager sets `audio.setMusicMode()` based on alive enemies near player
  ('combat' if any alive enemy within 60m and alerted, 'critical' if hp<35, else 'explore'; 'complete' on mission complete).
- Player regen: PLAYER implements — after 5s without damage, +8 hp/s to 100.
- Checkpoint: MissionManager stores checkpoint {objectiveIndex, playerPos, playerYaw} in a module
  var + useGame; "RESTART CHECKPOINT" (EndScreens) calls a `window.__restartCheckpoint()` hook
  that MAP/MissionManager registers. Keep simple: full mission restart is acceptable for
  checkpoint too in Phase A, but implement true checkpoint if easy (respawn player at saved
  transform, reset objectiveIndex, respawn enemies via EnemyManager remount key).
- EnemyManager: default export; props `{ spawns }` where spawn = {pos:[x,y,z], patrol:[[x,z]...], type}.
  Also consumes `enemyRegistry.consumeSpawns()` each frame for reinforcements.
  Remount via `key={checkpointKey}` to reset.
- Enemy.jsx registers in enemyRegistry with {getPosition(), getCenter(), radius, hp, alive, onDamaged, onDeath, onAlerted}.
- WeaponSystem does the hitscan: rapier `world.castRay` for world geometry; `enemyRegistry.raycast`
  and `damageables.raycast` for targets; nearest hit wins. Apply falloff by range stat.
- WeaponView: positions gun from camera every frame (useThree camera), no parent tricks needed.
  Animations via useFrame lerps: idle sway/bob, recoil kick (from playerRef/adsBlend), reload dip+tilt
  (read useGame reloading), sprint lowered pose, ADS centered (adsBlend 0..1, ~200ms).
- EffectsRenderer: useFrame consumes `fx.consume()`, renders pooled instanced particles:
  explosion (flash sprite + fire + smoke + shockwave ring), impact (spark burst + dust puff + decal quad fading),
  muzzle (2-frame flash quad at gun), tracer (stretched additive box/line fading), blood, sparks, dust, smoke.
  Cap ~400 live particles. No per-frame allocations in hot loop (reuse Vector3 temps).
- Weather: `<Weather/>` reads mission from useGame; desert = drifting dust motes + heat shimmer skip;
  arctic/urban stubs (Phase B) — render nothing for now but keep component.
- Grenades: G key → if useGame.getState().throwGrenade() spawn rapier dynamic ball at camera pos
  with forward+up velocity, restitution 0.4; fuse 3s → fx.explosion + audio.explosion + radial damage
  (enemies via registry within 7m falloff, player self-damage within 4m, damageables.radial).
- HUD reads useGame; shows ammo `${mag} / ${reserve}`, hp bar, crosshair (hidden when ads? show dot),
  objective title top-center, hitmarker on ev.hit change, damage vignette on ev.hurt, low-hp pulse,
  grenade count, weapon name, interact prompt (from interactables.nearest(playerRef.position)).
- Menus: MainMenu (title, PLAY→missions screen, SELECT MISSION→missions, CONTROLS, SETTINGS, animated 3D
  background — reuse a tiny Canvas with drifting dust + silhouettes, cheap), MissionSelect (3 cards from
  MISSIONS; non-playable show "IN DEVELOPMENT" disabled; playable → startMission + screen 'game'),
  Controls (list), Settings (sensitivity slider, volume slider, quality select → setSettings + audio.setVolume).
  audio.init() must be called on first click anywhere in menus (user gesture).
- PauseMenu: overlay when status==='paused': RESUME, RESTART MISSION, QUIT TO MENU. Also mute toggle.
- EndScreens: when status==='dead' → "MISSION FAILED" + RESTART CHECKPOINT / RESTART MISSION / MAIN MENU.
  when status==='complete' → "MISSION COMPLETE" + stats (time, kills) + REPLAY / MAIN MENU.
- Game.jsx: when screen==='game', render Canvas + HUD + PauseMenu + EndScreens + banner div.
  On unmount of mission (quit), clear registries (enemyRegistry.clear(), damageables.clear(),
  interactables.clear(), fx.clear()).
- DesertStrike map: ~120x140m town, south gate entrance at z≈46 (player spawn), market mid,
  rooftops (enemies on roofs), plaza, gun truck (damageable → explosion objective), comms building
  north (interactable to plant explosive → 12s timer → big explosion cinematic → escape objective →
  reaching extraction zone completes). Two cinematics: (1) scripted truck explosion blocking a street
  when player crosses market trigger; (2) comms building detonation. Colliders: fixed CuboidColliders.
  Keep draw calls sane: reuse geometries/materials, merge where easy.
- MissionManager: watches player position zones + ev counters (kills of tagged enemies) to advance
  objectives via completeObjective(). Registers interactables (plant explosive). Handles checkpoint
  saving. Enemy spawn configs live in MAP file and are passed to EnemyManager.

## Performance
- ≤3 shadow lights total per map. Instanced/merged geometry for repeated props. No textures (vertex colors / flat materials).
- Enemies ≤ 14 alive at once in desert.

## What NOT to do
- Don't edit other agents' files. Don't add deps. Don't import unbuilt Phase-B maps.
- Keep every file syntactically valid; no placeholder `TODO` that breaks runtime.
- All original content only.

## Checkpoint & spawn wiring (amendment)
- `src/missions/MissionManager.jsx` (MAP agent) additionally exports:
  - `checkpointApi = { saved: null, pending: null, save(cp), clear() }`
    where cp = { objectiveIndex, pos: [x,y,z], yaw }.
  - `spawnApi = { spawns: [], covers: [], set(spawns, covers) }` — map calls set() on mount.
  - `missionEvents` — tiny pub/sub: `on(evt, fn)` returns unsub, `emit(evt, data)`.
    Events: 'truckDestroyed', 'relayPlanted', 'relayDetonated', 'cineCar'.
- `src/enemies/EnemyManager.jsx` (ENEMIES agent): NO props. On mount reads
  `spawnApi.spawns` / `spawnApi.covers`, renders <Enemy> per spawn, consumes
  `enemyRegistry.consumeSpawns()` per frame (cap 14 alive).
- `src/components/Game.jsx` (SCAFFOLD): `const runId = useGame(s => s.runId || 0)`.
  Render `<DesertStrike key={runId} />`, `<EnemyManager key={runId} />`,
  `<MissionManager key={runId} />` inside <Physics>. Restart buttons do:
  `checkpointApi.clear(); useGame.getState().startMission(id, MISSIONS[id]); useGame.setState(s => ({ runId: (s.runId||0)+1 }))`.
  Checkpoint restart: `checkpointApi.pending = checkpointApi.saved;` then same as above.
- `MissionManager` on mount: if `checkpointApi.pending`, apply:
  `useGame.setState({ objectiveIndex: pending.objectiveIndex })`,
  `playerRef.position.set(...pending.pos); playerRef.yaw = pending.yaw`,
  then `checkpointApi.pending = null`. Also calls `checkpointApi.save(...)` after each objective completion.
- `DesertStrike` on mount: `spawnApi.set(SPAWNS, COVERS)`; registers damageables
  (gun truck → onDeath emits missionEvents 'truckDestroyed' + big fx), interactables
  (relay console → prompt 'Plant explosive [F]' → missionEvents 'relayPlanted'),
  cinematic trigger zones (it owns them or MissionManager does — MAP agent decides, keep in MissionManager).
- Cleanup on unmount (Game.jsx useEffect return): enemyRegistry.clear(), damageables.clear(),
  interactables.clear(), fx.clear(), checkpointApi.clear().
