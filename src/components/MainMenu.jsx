import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGame } from '../systems/GameState.js'
import { MISSIONS } from '../missions/missionData.js'
import { loadScores } from '../systems/scores.js'
import { audio } from '../systems/AudioManager.js'

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const RANK_STYLE = ['#ffd75e', '#c9d2dd', '#d08a4e']
const SHORT = { desert: 'DESERT', arctic: 'ARCTIC', urban: 'URBAN' }

// Leaderboard: top-10 per mission, read from the local score registry.
function Leaderboard() {
  const [tab, setTab] = useState('desert')
  const [scores] = useState(() => loadScores())
  const playerName = useGame((s) => s.playerName)
  const openRename = useGame((s) => s.openRename)
  const top = (scores[tab] || []).slice(0, 10)

  return (
    <div className="lb-panel">
      <div className="lb-operator">
        <span className="lb-op-label">OPERATOR</span>
        <span className="lb-op-name">{playerName || '—'}</span>
        <button className="lb-op-edit" onClick={() => { try { audio.uiClick() } catch {}; openRename() }}>
          {playerName ? 'CHANGE' : 'SET'}
        </button>
      </div>
      <div className="panel-kicker">LEADERBOARD</div>
      <div className="lb-tabs">
        {Object.values(MISSIONS).map((m) => (
          <button
            key={m.id}
            className={`lb-tab ${tab === m.id ? 'active' : ''}`}
            onClick={() => { try { audio.uiClick() } catch {}; setTab(m.id) }}
          >
            {SHORT[m.id] || m.name}
          </button>
        ))}
      </div>
      <div className="lb-rows">
        {top.length === 0 && <div className="lb-empty">No recorded runs yet. Deploy, operator.</div>}
        {top.map((e, i) => (
          <div key={i} className={`lb-row ${e.name === playerName ? 'me' : ''}`}>
            <span className="lb-rank" style={RANK_STYLE[i] ? { color: RANK_STYLE[i] } : undefined}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="lb-name">{e.name}</span>
            <span className="lb-sub">{e.kills} K · {fmtTime(e.time)}</span>
            <span className="lb-score">{e.score.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
      <div className="lb-foot">Local registry — top 10 per operation</div>
    </div>
  )
}

// Cheap animated backdrop: drifting dust points + dark building silhouettes.
function DustField({ count = 70 }) {
  const ref = useRef()
  const { pos, speed } = useMemo(() => {
    const p = new Float32Array(count * 3)
    const s = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 26
      p[i * 3 + 1] = Math.random() * 6.5
      p[i * 3 + 2] = (Math.random() - 0.5) * 18 - 6
      s[i] = 0.15 + Math.random() * 0.5
    }
    return { pos: p, speed: s }
  }, [count])

  useFrame((state, dt) => {
    const pts = ref.current
    if (!pts) return
    const t = state.clock.elapsedTime
    const arr = pts.geometry.attributes.position.array
    const step = Math.min(dt, 0.05)
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speed[i] * step * 0.35
      arr[i * 3] += Math.sin(t * 0.4 + i * 1.7) * step * 0.25
      if (arr[i * 3 + 1] > 6.8) arr[i * 3 + 1] = 0
    }
    pts.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        color="#c99a4e"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

function Silhouettes() {
  const group = useRef()
  const items = useMemo(() => {
    const arr = []
    for (let i = 0; i < 9; i++) {
      const w = 2 + Math.random() * 4
      const h = 2.5 + Math.random() * 5
      arr.push({
        x: (Math.random() - 0.5) * 34,
        z: -9 - Math.random() * 15,
        w,
        h,
        d: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
      })
    }
    return arr
  }, [])

  useFrame((state) => {
    if (group.current) group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.02) * 0.1
  })

  return (
    <group ref={group}>
      {items.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2 - 0.2, b.z]} rotation-y={b.rot}>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshBasicMaterial color="#0d0a07" />
        </mesh>
      ))}
    </group>
  )
}

function CameraDrift() {
  useFrame((state) => {
    const t = state.clock.elapsedTime
    state.camera.position.x = Math.sin(t * 0.08) * 1.6
    state.camera.position.y = 2.1 + Math.sin(t * 0.11) * 0.4
    state.camera.lookAt(0, 1.6, -12)
  })
  return null
}

function MenuBackground() {
  return (
    <div className="menu-bg">
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 2.1, 8], fov: 60 }} gl={{ antialias: false }}>
        <color attach="background" args={['#0a0806']} />
        <fog attach="fog" args={['#0a0806', 9, 34]} />
        <ambientLight intensity={0.5} color="#5a4632" />
        <directionalLight position={[-6, 4, -8]} intensity={0.6} color="#c9772e" />
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
          <planeGeometry args={[70, 70]} />
          <meshBasicMaterial color="#14100b" />
        </mesh>
        <Silhouettes />
        <DustField />
        <CameraDrift />
      </Canvas>
    </div>
  )
}

export default function MainMenu() {
  const requestDeploy = useGame((s) => s.requestDeploy)
  const setScreen = useGame((s) => s.setScreen)

  const click = (fn) => () => {
    try {
      audio.init()
      audio.uiClick()
    } catch {}
    fn()
  }

  return (
    <div className="menu-root">
      <MenuBackground />
      <div className="menu-layout">
        <div className="menu-panel">
          <div className="title-kicker">TACTICAL OPERATIONS UNIT</div>
          <h1 className="game-title">
            OPERATION
            <br />
            SHADOWLINE
          </h1>
          <div className="game-subtitle">Three operations. One shadow.</div>
          <nav className="menu-buttons">
            <button className="menu-btn primary" onClick={click(() => requestDeploy('desert'))}>
              PLAY
            </button>
            <button className="menu-btn" onClick={click(() => setScreen('missions'))}>
              SELECT MISSION
            </button>
            <button className="menu-btn" onClick={click(() => setScreen('controls'))}>
              CONTROLS
            </button>
            <button className="menu-btn" onClick={click(() => setScreen('settings'))}>
              SETTINGS
            </button>
          </nav>
          <div className="menu-footer">
            Original game — all assets, audio and code generated in-engine. No third-party IP.
          </div>
        </div>
        <Leaderboard />
      </div>
      <div className="version-tag">v0.2</div>
      <div className="scanlines" />
      <div className="vignette" />
    </div>
  )
}
