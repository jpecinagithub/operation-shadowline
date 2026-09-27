import { useGame } from '../systems/GameState.js'
import { audio } from '../systems/AudioManager.js'

const ROWS = [
  ['W A S D', 'Move'],
  ['MOUSE', 'Look / aim'],
  ['LEFT CLICK', 'Fire'],
  ['RIGHT CLICK', 'Aim down sights'],
  ['SHIFT', 'Sprint'],
  ['C / CTRL', 'Crouch'],
  ['SPACE', 'Jump'],
  ['R', 'Reload'],
  ['F', 'Interact'],
  ['1 – 4', 'Switch weapon'],
  ['G', 'Throw grenade'],
  ['ESC', 'Pause'],
  ['P / M', 'Mute (optional)'],
]

export default function Controls() {
  const setScreen = useGame((s) => s.setScreen)

  const back = () => {
    try {
      audio.uiClick()
    } catch {}
    setScreen('menu')
  }

  return (
    <div className="menu-root">
      <div className="panel narrow">
        <div className="panel-kicker">FIELD MANUAL</div>
        <h2 className="panel-title">CONTROLS</h2>
        <table className="controls-table">
          <tbody>
            {ROWS.map(([key, action]) => (
              <tr key={key}>
                <td className="key-cell">{key}</td>
                <td className="action-cell">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="back-btn" onClick={back}>
          ◂ BACK
        </button>
      </div>
      <div className="scanlines" />
      <div className="vignette" />
    </div>
  )
}
