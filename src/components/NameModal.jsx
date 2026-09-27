// Operator name prompt. Rendered globally from App so it works over any screen.
// Two modes: { missionId } -> deploy after confirm; { rename: true } -> just save.
import { useEffect, useRef, useState } from 'react'
import { useGame } from '../systems/GameState.js'
import { audio } from '../systems/AudioManager.js'

export default function NameModal() {
  const nameModal = useGame((s) => s.nameModal)
  const playerName = useGame((s) => s.playerName)
  const submitName = useGame((s) => s.submitName)
  const cancelNameModal = useGame((s) => s.cancelNameModal)
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (nameModal) {
      setValue(playerName || '')
      const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 60)
      return () => clearTimeout(t)
    }
  }, [nameModal]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!nameModal) return null

  const deployMode = !!nameModal.missionId
  const go = () => {
    try {
      audio.uiClick()
    } catch {}
    submitName(value)
  }

  return (
    <div className="overlay name-overlay" onClick={cancelNameModal}>
      <div className="overlay-panel name-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-kicker">IDENTIFICATION</div>
        <h2 className="panel-title small">OPERATOR CALLSIGN</h2>
        <p className="name-hint">
          {deployMode
            ? 'Enter your callsign before deployment. Scores are recorded under this name.'
            : 'Enter your callsign. It will be used for the leaderboard.'}
        </p>
        <input
          ref={inputRef}
          className="name-input"
          value={value}
          maxLength={12}
          placeholder="e.g. VIPER"
          onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') cancelNameModal()
          }}
        />
        <nav className="overlay-buttons">
          <button className="pbtn primary" onClick={go}>
            {deployMode ? 'DEPLOY ▸' : 'CONFIRM'}
          </button>
          <button className="pbtn" onClick={cancelNameModal}>
            CANCEL
          </button>
        </nav>
      </div>
    </div>
  )
}
