import { useGame } from '../systems/GameState.js'
import { audio } from '../systems/AudioManager.js'

// Overlay shown when status === 'paused'.
export default function PauseMenu({ onRestartMission }) {
  const status = useGame((s) => s.status)
  const volume = useGame((s) => s.settings.volume)
  const setSettings = useGame((s) => s.setSettings)
  const resume = useGame((s) => s.resume)
  const quitToMenu = useGame((s) => s.quitToMenu)

  if (status !== 'paused') return null

  const click = (fn) => () => {
    try {
      audio.uiClick()
    } catch {}
    fn()
  }

  const onResume = () => {
    resume()
    // Re-acquire pointer lock on the game canvas (PLAYER handles loss → pause).
    try {
      const c = document.querySelector('canvas')
      if (c && c.requestPointerLock) {
        const p = c.requestPointerLock()
        if (p && p.catch) p.catch(() => {})
      }
    } catch {}
  }

  const muted = volume <= 0
  const onMute = () => {
    const v = muted ? 0.8 : 0
    setSettings({ volume: v })
    try {
      audio.setVolume(v)
    } catch {}
  }

  return (
    <div className="overlay">
      <div className="overlay-panel">
        <div className="panel-kicker">TACTICAL PAUSE</div>
        <h2 className="panel-title">PAUSED</h2>
        <nav className="overlay-buttons">
          <button className="pbtn primary" onClick={click(onResume)}>
            RESUME
          </button>
          <button className="pbtn" onClick={click(onRestartMission)}>
            RESTART MISSION
          </button>
          <button className="pbtn" onClick={click(onMute)}>
            {muted ? 'UNMUTE' : 'MUTE'}
          </button>
          <button className="pbtn danger" onClick={click(quitToMenu)}>
            QUIT TO MENU
          </button>
        </nav>
      </div>
    </div>
  )
}
