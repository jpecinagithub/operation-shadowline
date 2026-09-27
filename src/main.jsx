import ReactDOM from 'react-dom/client'
import './styles/game.css'
import App from './App.jsx'

// No React.StrictMode: R3F + rapier double-mount side effects break the physics session.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
