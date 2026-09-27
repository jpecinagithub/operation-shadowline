import { useEffect, useState } from 'react'
import { useGame } from '../systems/GameState.js'
import { checkpointApi } from '../missions/MissionManager.jsx'
import { audio } from '../systems/AudioManager.js'

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function DeathScreen({ onRestartMission, onRestartCheckpoint }) {
  const status = useGame((s) => s.status)
  const quitToMenu = useGame((s) => s.quitToMenu)
  const [hasCheckpoint, setHasCheckpoint] = useState(false)

  // checkpointApi.saved is module state (not reactive) — poll while visible.
  useEffect(() => {
    if (status !== 'dead') return
    const check = () => {
      try {
        setHasCheckpoint(!!checkpointApi.saved)
      } catch {
        setHasCheckpoint(false)
      }
    }
    check()
    const t = setInterval(check, 500)
    return () => clearInterval(t)
  }, [status])

  if (status !== 'dead') return null

  const click = (fn) => () => {
    try {
      audio.uiClick()
    } catch {}
    fn()
  }

  return (
    <div className="overlay">
      <div className="overlay-panel">
        <div className="panel-kicker red">KIA — OPERATOR DOWN</div>
        <h2 className="panel-title red">MISSION FAILED</h2>
        <nav className="overlay-buttons">
          <button
            className="pbtn primary"
            onClick={click(onRestartCheckpoint)}
            disabled={!hasCheckpoint}
            title={hasCheckpoint ? '' : 'No checkpoint saved yet'}
          >
            RESTART CHECKPOINT
          </button>
          <button className="pbtn" onClick={click(onRestartMission)}>
            RESTART MISSION
          </button>
          <button className="pbtn danger" onClick={click(quitToMenu)}>
            MAIN MENU
          </button>
        </nav>
      </div>
    </div>
  )
}

export function CompleteScreen({ onRestartMission }) {
  const status = useGame((s) => s.status)
  const missionTime = useGame((s) => s.missionTime)
  const kills = useGame((s) => s.kills)
  const lastScore = useGame((s) => s.lastScore)
  const quitToMenu = useGame((s) => s.quitToMenu)

  if (status !== 'complete') return null

  const click = (fn) => () => {
    try {
      audio.uiClick()
    } catch {}
    fn()
  }

  return (
    <div className="overlay">
      <div className="overlay-panel">
        <div className="panel-kicker green">OBJECTIVES SECURED</div>
        <h2 className="panel-title green">MISSION COMPLETE</h2>
        <div className="stats-row">
          <div className="stat">
            <div className="stat-label">TIME</div>
            <div className="stat-value">{fmtTime(missionTime)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">KILLS</div>
            <div className="stat-value">{kills}</div>
          </div>
          {lastScore && (
            <div className="stat">
              <div className="stat-label">SCORE</div>
              <div className="stat-value gold">{lastScore.score.toLocaleString('en-US')}</div>
            </div>
          )}
        </div>
        {lastScore && lastScore.rank > 0 && (
          <div className={`score-note ${lastScore.isRecord ? 'record' : ''}`}>
            {lastScore.isRecord
              ? '★ NEW RECORD — TOP OF THE LEADERBOARD'
              : `RANKED #${lastScore.rank} ON THE LEADERBOARD`}
          </div>
        )}
        <nav className="overlay-buttons">
          <button className="pbtn primary" onClick={click(onRestartMission)}>
            REPLAY
          </button>
          <button className="pbtn danger" onClick={click(quitToMenu)}>
            MAIN MENU
          </button>
        </nav>
      </div>
    </div>
  )
}

export default function EndScreens(props) {
  return (
    <>
      <DeathScreen {...props} />
      <CompleteScreen {...props} />
    </>
  )
}
