import { useEffect } from 'react'
import { useGame } from './systems/GameState.js'
import { audio } from './systems/AudioManager.js'
import MainMenu from './components/MainMenu.jsx'
import MissionSelect from './components/MissionSelect.jsx'
import Controls from './components/Controls.jsx'
import Settings from './components/Settings.jsx'
import Game from './components/Game.jsx'

// Screen router. First user click anywhere initializes the Web Audio context
// (browsers require a user gesture before AudioContext can start).
export default function App() {
  const screen = useGame((s) => s.screen)

  useEffect(() => {
    const onFirstGesture = () => {
      try {
        audio.init()
        audio.resume()
      } catch {
        /* audio optional */
      }
    }
    document.addEventListener('click', onFirstGesture, { once: true })
    return () => document.removeEventListener('click', onFirstGesture)
  }, [])

  switch (screen) {
    case 'missions':
      return <MissionSelect />
    case 'controls':
      return <Controls />
    case 'settings':
      return <Settings />
    case 'game':
      return <Game />
    case 'menu':
    default:
      return <MainMenu />
  }
}
