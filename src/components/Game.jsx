import { useEffect } from 'react'
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
import ArcticOutpost from '../maps/ArcticOutpost.jsx'
import UrbanBlackout from '../maps/UrbanBlackout.jsx'
import MissionManager, { checkpointApi } from '../missions/MissionManager.jsx'
import { useGame } from '../systems/GameState.js'
import { MISSIONS } from '../missions/missionData.js'
import { playerRef } from '../player/playerRef.js'
import { enemyRegistry } from '../enemies/enemyRegistry.js'
import { damageables } from '../systems/damageables.js'
import { interactables } from '../systems/interactables.js'
import { fx } from '../effects/fx.js'
import { audio } from '../systems/AudioManager.js'
import HUD from './HUD.jsx'
import PauseMenu from './PauseMenu.jsx'
import EndScreens from './EndScreens.jsx'

// The 3D session. Renders Canvas + Physics with all session components,
// plus HUD / PauseMenu / EndScreens / banner overlays outside the Canvas.
export default function Game() {
  const mission = useGame((s) => s.mission)
  const runId = useGame((s) => s.runId || 0)
  const banner = useGame((s) => s.banner)

  const resetPlayerToSpawn = (missionId) => {
    const def = MISSIONS[missionId]
    if (!def) return
    try {
      playerRef.reset(def.spawn[0], def.spawn[1], def.spawn[2], def.spawnYaw)
    } catch {
      /* playerRef not yet active */
    }
  }

  const restartMission = () => {
    try {
      audio.uiClick()
    } catch {}
    try {
      checkpointApi.clear()
    } catch {}
    try {
      audio.setMusicMode('explore')
    } catch {}
    const st = useGame.getState()
    const m = st.mission
    if (MISSIONS[m]) {
      st.startMission(m, MISSIONS[m])
      resetPlayerToSpawn(m)
    }
    useGame.setState((s) => ({ runId: (s.runId || 0) + 1 }))
  }

  const restartCheckpoint = () => {
    try {
      audio.uiClick()
    } catch {}
    let saved = null
    try {
      saved = checkpointApi.saved
      checkpointApi.clear()
      // Set pending AFTER clear(), in case clear() also resets pending.
      checkpointApi.pending = saved
    } catch {}
    try {
      audio.setMusicMode('explore')
    } catch {}
    const st = useGame.getState()
    const m = st.mission
    if (MISSIONS[m]) {
      st.startMission(m, MISSIONS[m])
      // If no checkpoint was saved, fall back to the mission spawn.
      if (!saved) resetPlayerToSpawn(m)
    }
    useGame.setState((s) => ({ runId: (s.runId || 0) + 1 }))
  }

  // Full cleanup when the session unmounts (quit to menu / mission change).
  useEffect(() => {
    return () => {
      try {
        enemyRegistry.clear()
      } catch {}
      try {
        damageables.clear()
      } catch {}
      try {
        interactables.clear()
      } catch {}
      try {
        fx.clear()
      } catch {}
      try {
        checkpointApi.clear()
      } catch {}
    }
  }, [])

  return (
    <div className="game-root">
      <Canvas shadows camera={{ fov: 75, near: 0.05, far: 600 }} dpr={[1, 1.75]}>
        <color attach="background" args={['#1a0f08']} />
        <Physics gravity={[0, -22, 0]}>
          <PlayerController />
          <WeaponSystem />
          <WeaponView />
          <Grenades />
          <EnemyManager key={`enemies-${runId}`} />
          <EffectsRenderer />
          <Weather />
          {mission === 'desert' && <DesertStrike key={`map-${runId}`} />}
          {mission === 'arctic' && <ArcticOutpost key={`map-${runId}`} />}
          {mission === 'urban' && <UrbanBlackout key={`map-${runId}`} />}
          <MissionManager key={`mission-${runId}`} />
        </Physics>
      </Canvas>
      <HUD />
      <PauseMenu onRestartMission={restartMission} />
      <EndScreens onRestartMission={restartMission} onRestartCheckpoint={restartCheckpoint} />
      {banner && (
        <div className="banner-overlay" key={banner.key}>
          <div className="banner-title">{banner.title}</div>
          {banner.sub ? <div className="banner-sub">{banner.sub}</div> : null}
        </div>
      )}
      <div className="scanlines" />
      <div className="vignette" />
    </div>
  )
}
