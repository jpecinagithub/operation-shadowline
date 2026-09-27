import { useEffect } from 'react'
import { useGame } from './systems/GameState.js'
import { audio } from './systems/AudioManager.js'
import MainMenu from './components/MainMenu.jsx'
import MissionSelect from './components/MissionSelect.jsx'
import Controls from './components/Controls.jsx'
import Settings from './components/Settings.jsx'
import Game from './components/Game.jsx'
import NameModal from './components/NameModal.jsx'

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

  let view
  switch (screen) {
    case 'missions':
      view = <MissionSelect />
      break
    case 'controls':
      view = <Controls />
      break
    case 'settings':
      view = <Settings />
      break
    case 'game':
      view = <Game />
      break
    case 'menu':
    default:
      view = <MainMenu />
  }
  return (
    <>
      {view}
      <NameModal />
    </>
  )
}
