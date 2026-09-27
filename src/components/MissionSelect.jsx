import { useGame } from '../systems/GameState.js'
import { MISSIONS } from '../missions/missionData.js'
import { audio } from '../systems/AudioManager.js'

const DIFFICULTY_COLORS = {
  Easy: '#7bc96f',
  Medium: '#d8a13d',
  Hard: '#d84d3d',
}

export default function MissionSelect() {
  const startMission = useGame((s) => s.startMission)
  const setScreen = useGame((s) => s.setScreen)

  const deploy = (id) => {
    try {
      audio.init()
      audio.uiClick()
    } catch {}
    startMission(id, MISSIONS[id]) // also sets screen to 'game'
  }

  const back = () => {
    try {
      audio.uiClick()
    } catch {}
    setScreen('menu')
  }

  return (
    <div className="menu-root">
      <div className="panel">
        <div className="panel-kicker">OPERATION BRIEFING</div>
        <h2 className="panel-title">SELECT MISSION</h2>
        <div className="card-grid">
          {Object.values(MISSIONS).map((m) => (
            <div
              key={m.id}
              className={`mission-card ${m.playable ? '' : 'disabled'}`}
              onClick={m.playable ? () => deploy(m.id) : undefined}
              role={m.playable ? 'button' : undefined}
              tabIndex={m.playable ? 0 : undefined}
              onKeyDown={m.playable ? (e) => e.key === 'Enter' && deploy(m.id) : undefined}
            >
              {!m.playable && <div className="dev-badge">IN DEVELOPMENT</div>}
              <div className="mission-name">{m.name}</div>
              <div className="mission-desc">{m.desc}</div>
              <div className="mission-meta">
                <span
                  className="difficulty"
                  style={{ color: DIFFICULTY_COLORS[m.difficulty] || '#d8a13d' }}
                >
                  {m.difficulty.toUpperCase()}
                </span>
                <span className="mission-objectives">{m.objectives.length} OBJECTIVES</span>
              </div>
              {m.playable && <button className="deploy-btn">DEPLOY ▸</button>}
            </div>
          ))}
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
