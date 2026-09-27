import { useGame } from '../systems/GameState.js'
import { audio } from '../systems/AudioManager.js'

export default function Settings() {
  const settings = useGame((s) => s.settings)
  const setSettings = useGame((s) => s.setSettings)
  const setScreen = useGame((s) => s.setScreen)

  const onSensitivity = (e) => {
    const v = parseFloat(e.target.value)
    setSettings({ sensitivity: v })
  }

  const onVolume = (e) => {
    const v = parseFloat(e.target.value)
    setSettings({ volume: v })
    try {
      audio.init()
      audio.setVolume(v) // live preview
    } catch {}
  }

  const onQuality = (e) => {
    try {
      audio.uiClick()
    } catch {}
    setSettings({ quality: e.target.value })
  }

  const back = () => {
    try {
      audio.uiClick()
    } catch {}
    setScreen('menu')
  }

  return (
    <div className="menu-root">
      <div className="panel narrow">
        <div className="panel-kicker">SYSTEMS</div>
        <h2 className="panel-title">SETTINGS</h2>

        <div className="settings-row">
          <label htmlFor="sens">MOUSE SENSITIVITY</label>
          <input
            id="sens"
            type="range"
            min="0.3"
            max="2.5"
            step="0.05"
            value={settings.sensitivity}
            onChange={onSensitivity}
          />
          <span className="settings-value">{settings.sensitivity.toFixed(2)}</span>
        </div>

        <div className="settings-row">
          <label htmlFor="vol">VOLUME</label>
          <input
            id="vol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={onVolume}
          />
          <span className="settings-value">{Math.round(settings.volume * 100)}%</span>
        </div>

        <div className="settings-row">
          <label htmlFor="quality">QUALITY</label>
          <select id="quality" value={settings.quality} onChange={onQuality}>
            <option value="low">LOW</option>
            <option value="high">HIGH</option>
          </select>
        </div>

        <button className="back-btn" onClick={back}>
          ◂ BACK
        </button>
      </div>
      <div className="scanlines" />
      <div className="vignette" />
    </div>
  )
}
