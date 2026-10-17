export type User = {
  id: number; email: string; name: string; role: 'doctor' | 'patient'
  birth_year: number | null; sex: 'm' | 'f' | null; phone: string | null
  invite_code?: string; clinic?: string | null; specialty?: string | null
}
export type PatientRow = {
  id: number; name: string; email: string; birth_year: number | null; sex: string | null; phone: string | null
  last_seen: string | null; last_state: number | null; last_bpm: number | null
  online: boolean; alert: boolean; new_alerts: number; af_burden_24h: number; episodes_24h: number
  monitored_minutes_24h: number; hr_mean_24h: number | null; spark: (number | null)[]
}
export type Alert = {
  id: number; patient_id: number; patient_name: string | null; ts: string; kind: string
  prob: number; bpm: number; status: 'new' | 'ack'; ack_at: string | null
}
export type Overview = {
  patients: number; online: number; in_afib_now: number; new_alerts: number; episodes_24h: number
  mean_burden_24h: number; symptoms_24h: number; ecg_24h: number
  burden: { id: number; name: string; af_burden_24h: number }[]
  recent_alerts: Alert[]
}
export type Episode = {
  start: string; end: string; duration_s: number; max_prob: number; mean_bpm: number | null
  verdict: 'confirmed' | 'false_alarm' | null; ecg_id: number | null
}
export type Point = { t: string; bpm: number | null; prob: number; afib: boolean }
export type Hour = { t: string; monitored_min: number; af_min: number; bpm: number | null }
export type Symptom = { id: number; ts: string; kinds: string[]; severity: number; note: string | null }
export type EcgMeta = { id: number; ts: string; fs: number; duration_s: number; state: number; prob: number; bpm: number; reason: string }
export type Quality = { sqi: number; level: 'good' | 'fair' | 'poor'; reasons: string[] }
export type PcStats = { sd1: number | null; sd2: number | null; ratio: number | null }
export type EcgStrip = EcgMeta & {
  samples: number[]; r_peaks: number[]; rr: number[]; irregularity: number | null; quality: Quality
  poincare: PcStats & { points: number[][] }
}
export type RiskItem = { key: string; points: number; label: string; on: boolean; auto: boolean }
export type Risk = {
  age: number | null; sex: 'm' | 'f' | null; items: RiskItem[]; cha2ds2_vasc: number; cha2ds2_va: number
  annual_stroke_risk_pct: number | null; recommendation: string; level: 'low' | 'moderate' | 'high'
  missing_age: boolean; note: string; updated_at: string | null
}
export type Note = { id: number; ts: string; text: string; author: string }
export type Report = {
  patient: User
  range: { from: string; to: string; hours: number }
  stats: {
    monitored_minutes: number; af_burden: number; episodes_count: number; longest_episode_s: number
    hr_mean: number | null; hr_min: number | null; hr_max: number | null; readings: number
    confirmed_episodes: number; false_alarms: number
  }
  last: { ts: string; state: number; prob: number; bpm: number; online: boolean } | null
  battery: number | null
  episodes: Episode[]
  series: Point[]
  hourly: Hour[]
  symptoms: Symptom[]
  ecg: EcgMeta[]
  notes?: Note[]
  alerts?: Alert[]
  poincare: { af: number[][]; normal: number[][]; af_stats: PcStats; normal_stats: PcStats; strips: number; mean_sqi: number | null }
}

const KEY = 'afib_token'
export const getToken = () => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setToken = (t: string | null) => {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* private mode */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const tok = getToken()
  if (tok) headers.Authorization = `Bearer ${tok}`
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as object) } })
  if (!r.ok) {
    let msg = r.statusText
    try { const j = await r.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* empty */ }
    if (r.status === 401) setToken(null)
    throw new ApiError(r.status, msg)
  }
  return r.json() as Promise<T>
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })

/** Fires when live data changed (SSE event or local action); pages listen and refetch. */
export const REFRESH = 'afib:refresh'
export const emitRefresh = (detail?: unknown) => window.dispatchEvent(new CustomEvent(REFRESH, { detail }))
