# OPERATION SHADOWLINE

An original military first-person shooter for the browser. 100% original content —
no Call of Duty names, assets, sounds, or UI. Everything (geometry, audio, effects)
is generated in-engine at runtime: flat low-poly geometry, vertex colors, and a
fully procedural Web Audio API soundscape.

Built with **Vite + React 18 + three + @react-three/fiber + @react-three/rapier + zustand**.

## Run it

```bash
npm install
npm run dev      # dev server
npm run build    # production build
```

## Missions

Three fully playable scenarios, all sharing the same core systems (FPS controller,
weapons, enemy AI, grenades, HUD, procedural audio, checkpoints):

- **DESERT STRIKE** (Medium) — fight through a desert town at sunset and destroy the
  enemy communications post. 9 objectives, rooftop enemies, gun truck, planted
  explosive with 12s countdown, car-ambush + relay-detonation cinematics.
- **ARCTIC OUTPOST** (Hard) — infiltrate a secret mountain base at night and steal
  military intel. 8 objectives: stealth approach, perimeter guards, hangar combat,
  data-center download, then a base-wide **alarm turns every light red** while you
  escape through a fuel-depot explosion and reinforcement waves.
- **URBAN BLACKOUT** (Hard) — rescue a trapped allied team in a rain-soaked ruined
  city at night. 8 objectives: avenue firefight (fuel-truck ambush), 3-floor office
  tower climb, allied-team rescue, a **90-second hold** against reinforcement waves,
  and helicopter evacuation.

## Controls

| Key           | Action              |
| ------------- | ------------------- |
| W A S D       | Move                |
| Mouse         | Look / aim          |
| Left click    | Fire                |
| Right click   | Aim down sights     |
| Shift         | Sprint              |
| C / Ctrl      | Crouch              |
| Space         | Jump                |
| R             | Reload              |
| F             | Interact            |
| 1 – 4         | Switch weapon       |
| G             | Throw grenade       |
| Esc           | Pause               |
| P / M         | Mute (optional)     |

## Project structure

```
src/
  main.jsx                  # ReactDOM root (no StrictMode)
  App.jsx                   # screen router: menu | missions | controls | settings | game
  styles/game.css           # full dark-military theme, no webfonts
  components/
    Game.jsx                # 3D session: Canvas + Physics + HUD + overlays + restart wiring
    MainMenu.jsx            # title screen + animated dust/silhouette backdrop
    MissionSelect.jsx       # mission cards (all three missions playable)
    Controls.jsx            # control table
    Settings.jsx            # sensitivity / volume / quality
    HUD.jsx                 # ammo, hp, crosshair, objective, hitmarker, prompts
    PauseMenu.jsx           # resume / restart / mute / quit
    EndScreens.jsx          # death + mission-complete screens, checkpoint restart
  systems/
    GameState.js            # zustand store: single source of truth for UI + gameplay
    AudioManager.js         # procedural Web Audio SFX + adaptive music (init on gesture)
    interactables.js        # press-F world interactions registry
    damageables.js          # destructible objects registry
  missions/
    missionData.js          # DESERT STRIKE / ARCTIC OUTPOST / URBAN BLACKOUT defs
    MissionManager.jsx      # objectives, checkpoints, spawn/checkpoint API (all missions)
  maps/
    DesertStrike.jsx        # desert town at sunset
    ArcticOutpost.jsx       # night snow base with alarm red-light cinematic
    UrbanBlackout.jsx       # rainy ruined city + 3-floor tower + helicopter evac
  player/
    playerRef.js            # mutable per-frame player state (no zustand churn)
    PlayerController.jsx    # movement, look, pointer lock, pause on Esc (PLAYER agent)
  weapons/
    weaponData.js           # AR-7, KX-9, M12 Tactical, VX Marksman stats
    WeaponSystem.jsx        # hitscan, recoil, reload, ammo (PLAYER agent)
    WeaponView.jsx          # first-person gun view + animations (PLAYER agent)
    Grenades.jsx            # thrown physics grenades (PLAYER agent)
  enemies/
    enemyRegistry.js        # enemy registration + raycast + spawn queue
    EnemyManager.jsx        # spawn/cap management (ENEMIES agent)
    Enemy.jsx               # enemy actor (ENEMIES agent)
  effects/
    fx.js                   # pooled particle event queue (explosion, tracers, blood…)
    Effects.jsx             # instanced particle renderer (EFFECTS agent)
    Weather.jsx             # per-mission weather (EFFECTS agent)
```

## Notes

- **Original content only.** All weapons, missions, characters, sounds and music are
  original designs — nothing from existing franchises.
- **Procedural audio.** No audio files: gunshots, explosions, footsteps, UI and the
  adaptive combat/exploration soundtrack are synthesized with the Web Audio API.
  The context is created on the first user click (browser gesture requirement).
- **Checkpoint system.** `checkpointApi` (exported by MissionManager) stores
  `{ objectiveIndex, pos, yaw }` after each objective; "RESTART CHECKPOINT" respawns
  the player there and remounts enemies/map via the `runId` key.
- **Cross-module contracts** are defined in `CONTRACTS.md` — read it before touching
  any shared file. Each agent owns only its files.
- `npm run dev` must stay green; never add dependencies without agreement.
