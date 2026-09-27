import { useEffect, useRef, useState } from 'react'
import { useGame } from '../systems/GameState.js'
import { WEAPONS } from '../weapons/weaponData.js'
import { playerRef } from '../player/playerRef.js'
import { interactables } from '../systems/interactables.js'
import { audio } from '../systems/AudioManager.js'

// Minimal military HUD. All pointer-events disabled — it is display only.
export default function HUD() {
  const ammo = useGame((s) => s.ammo)
  const currentWeapon = useGame((s) => s.currentWeapon)
  const grenades = useGame((s) => s.grenades)
  const hp = useGame((s) => s.hp)
  const maxHp = useGame((s) => s.maxHp)
  const ads = useGame((s) => s.ads)
  const reloading = useGame((s) => s.reloading)
  const evHit = useGame((s) => s.ev.hit)
  const evHurt = useGame((s) => s.ev.hurt)
  const objectives = useGame((s) => s.objectives)
  const objectiveIndex = useGame((s) => s.objectiveIndex)
  const status = useGame((s) => s.status)

  const weapon = WEAPONS[currentWeapon]
  const clip = ammo && ammo[currentWeapon] ? ammo[currentWeapon] : { mag: 0, reserve: 0 }
  const hpPct = Math.max(0, Math.min(100, ((hp || 0) / (maxHp || 100)) * 100))
  const lowHp = (hp || 0) < 35 && status === 'playing'
  const currentObjective = objectives && objectives[objectiveIndex]

  // --- hitmarker: brief X on ev.hit change ---
  const [hitVisible, setHitVisible] = useState(false)
  const lastHit = useRef(evHit)
  useEffect(() => {
    if (evHit !== lastHit.current) {
      lastHit.current = evHit
      setHitVisible(true)
      const t = setTimeout(() => setHitVisible(false), 200)
      return () => clearTimeout(t)
    }
  }, [evHit])

  // --- damage vignette: re-trigger fade on ev.hurt change ---
  const [dmgKey, setDmgKey] = useState(0)
  const lastHurt = useRef(evHurt)
  useEffect(() => {
    if (evHurt !== lastHurt.current) {
      lastHurt.current = evHurt
      setDmgKey((k) => k + 1)
    }
  }, [evHurt])

  // --- heartbeat when critically wounded ---
  useEffect(() => {
    if (lowHp) {
      const t = setInterval(() => {
        try {
          audio.heartbeat()
        } catch {}
      }, 1100)
      return () => clearInterval(t)
    }
  }, [lowHp])

  // --- crosshair expansion: poll player speed (approx) ---
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    const t = setInterval(() => {
      try {
        setMoving(playerRef.velocity.length() > 1.4)
      } catch {
        setMoving(false)
      }
    }, 120)
    return () => clearInterval(t)
  }, [])

  // --- interact prompt: poll nearest interactable ---
  const [near, setNear] = useState(null)
  useEffect(() => {
    const t = setInterval(() => {
      try {
        setNear(interactables.nearest(playerRef.position))
      } catch {
        setNear(null)
      }
    }, 150)
    return () => clearInterval(t)
  }, [])

  if (status === 'dead' || status === 'complete') return null

  return (
    <div className="hud">
      {/* objective — top center */}
      <div className="objective-box">
        {currentObjective ? (
          <>
            <div className="obj-label">
              OBJECTIVE {Math.min(objectiveIndex + 1, objectives.length)}/{objectives.length}
            </div>
            <div className="obj-title">{currentObjective.title}</div>
          </>
        ) : (
          <div className="obj-title">—</div>
        )}
      </div>

      {/* crosshair — center (small dot only while ADS) */}
      {status === 'playing' && (
        <div className={`crosshair ${ads ? 'ads' : ''} ${moving && !ads ? 'moving' : ''}`}>
          {ads ? (
            <div className="ch-dot" />
          ) : (
            <>
              <div className="ch-tick top" />
              <div className="ch-tick bottom" />
              <div className="ch-tick left" />
              <div className="ch-tick right" />
              <div className="ch-dot" />
            </>
          )}
        </div>
      )}

      {/* hitmarker */}
      {hitVisible && (
        <div className="hitmarker">
          <span className="hm a" />
          <span className="hm b" />
        </div>
      )}

      {/* damage vignette */}
      {dmgKey > 0 && <div key={dmgKey} className="dmg-vignette" />}

      {/* low-hp pulse */}
      {lowHp && <div className="lowhp-vignette" />}

      {/* health — bottom left */}
      <div className="hud-hp">
        <div className="hp-bar">
          <div
            className={`hp-fill ${hpPct < 35 ? 'crit' : hpPct < 70 ? 'warn' : ''}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <div className="hp-num">{Math.ceil(hp || 0)}</div>
      </div>

      {/* ammo — bottom right */}
      <div className="hud-ammo">
        <div className="weapon-name">{weapon ? weapon.name : currentWeapon}</div>
        <div className="ammo-line">
          <span className="ammo-mag">{clip.mag}</span>
          <span className="ammo-sep"> / </span>
          <span className="ammo-reserve">{clip.reserve}</span>
        </div>
        <div className="grenade-count">✸ {grenades}</div>
        {reloading && <div className="reload-ind">RELOADING…</div>}
      </div>

      {/* interact prompt — bottom center */}
      {near && status === 'playing' && (
        <div className="interact-prompt">
          <span className="interact-key">F</span>
          <span>{near.prompt || 'Interact'}</span>
        </div>
      )}
    </div>
  )
}
