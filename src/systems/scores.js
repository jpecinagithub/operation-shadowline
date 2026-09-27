// Local score registry (no backend): top-10 per mission + operator name.
// Stored in localStorage so it survives sessions on this machine.
const SCORE_KEY = 'shadowline_scores_v1'
const NAME_KEY = 'shadowline_player_name'

export const PAR_TIMES = { desert: 720, arctic: 720, urban: 900 } // seconds, for time bonus
const MAX_ENTRIES = 10

function blank() {
  return { desert: [], arctic: [], urban: [] }
}

export function loadScores() {
  try {
    const raw = localStorage.getItem(SCORE_KEY)
    if (!raw) return blank()
    const d = JSON.parse(raw)
    const out = blank()
    for (const k of Object.keys(out)) if (Array.isArray(d[k])) out[k] = d[k].slice(0, MAX_ENTRIES)
    return out
  } catch {
    return blank()
  }
}

function persist(all) {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify(all))
  } catch {
    /* storage optional */
  }
}

// score = kills*100 + objectives*250 + time bonus (5 pts per second under par)
export function computeScore({ kills, objectives, missionTime, mission }) {
  const par = PAR_TIMES[mission] || 720
  const timeBonus = Math.max(0, Math.round(par - (missionTime || 0))) * 5
  return Math.max(0, Math.round(kills * 100 + objectives * 250 + timeBonus))
}

// entry: { name, score, kills, time, date }
// returns { rank (1-based, -1 if it didn't make the top 10), isRecord, top }
export function saveScore(mission, entry) {
  const all = loadScores()
  const list = all[mission] || []
  const prevBest = list.length ? list[0].score : -1
  list.push(entry)
  list.sort((a, b) => b.score - a.score || a.time - b.time)
  const top = list.slice(0, MAX_ENTRIES)
  all[mission] = top
  persist(all)
  const rank = top.indexOf(entry) // entry keeps identity since we pushed the same ref
  return { rank: rank === -1 ? -1 : rank + 1, isRecord: entry.score > prevBest, top }
}

export function getTop(mission) {
  return loadScores()[mission] || []
}

export function getPlayerName() {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

export function setPlayerName(name) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* storage optional */
  }
}
