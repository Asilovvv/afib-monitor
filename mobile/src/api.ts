import AsyncStorage from '@react-native-async-storage/async-storage'

export type Doctor = { id: number; name: string; clinic?: string | null; phone?: string | null }
export type User = {
  id: number; email: string; name: string; role: 'patient' | 'doctor'
  birth_year?: number | null; sex?: 'm' | 'f' | null; phone?: string | null
  doctor?: Doctor | null
}
export type Episode = {
  start: string; end: string; duration_s: number; max_prob: number; mean_bpm: number | null
  verdict?: 'confirmed' | 'false_alarm' | null; ecg_id?: number | null
}
export type Hour = { t: string; monitored_min: number; af_min: number; bpm: number | null }
export type Symptom = { id: number; ts: string; kinds: string[]; severity: number; note: string | null }
export type EcgMeta = { id: number; ts: string; fs: number; duration_s: number; state: number; prob: number; bpm: number; reason: string }
export type Report = {
  stats: {
    monitored_minutes: number; af_burden: number; episodes_count: number; longest_episode_s: number
    hr_mean: number | null; hr_min: number | null; hr_max: number | null
    confirmed_episodes?: number; false_alarms?: number
  }
  episodes: Episode[]
  hr_events?: { kind: 'low' | 'high'; start: string; end: string; duration_s: number; bpm: number }[]
  hourly: Hour[]
  symptoms: Symptom[]
  ecg: EcgMeta[]
  battery: number | null
}
export type ReadingOut = { ts: number; state: number; prob: number; bpm: number; battery?: number | null }
export type EcgOut = { ts: number; fs: number; samples: number[]; state: number; prob: number; bpm: number; reason: 'afib_onset' | 'manual' | 'symptom' | 'check' }

export type Med = { id: number; name: string; dose: string | null; times: string[]; anticoagulant: boolean; active: boolean; created_at: string }
export type TodayDose = { medication_id: number; name: string; dose: string | null; anticoagulant: boolean; slot: string; status: 'taken' | 'skipped' | null }
export type CheckPlan = { times: string[]; active: boolean; set_by: 'patient' | 'doctor'; updated_at: string }
export type MedBody = { name: string; dose?: string; times: string[]; anticoagulant: boolean }
export type TgLink = { id: number; name: string; kind: string; created_at: string }
export type Risk = { cha2ds2_vasc: number; cha2ds2_va: number; annual_stroke_risk_pct: number | null; level: 'low' | 'moderate' | 'high'; updated_at: string | null }

const WAKE = 75000   // a free cloud server can take ~1 min to wake up

const K_URL = 'afib.server', K_TOKEN = 'afib.token'

export const settings = {
  server: '' as string,
  token: '' as string,
  async load() {
    this.server = (await AsyncStorage.getItem(K_URL)) ?? ''
    this.token = (await AsyncStorage.getItem(K_TOKEN)) ?? ''
  },
  async setServer(url: string) {
    let u = url.trim().replace(/\/+$/, '')
    if (u && !/^https?:\/\//.test(u)) u = 'http://' + u
    this.server = u
    await AsyncStorage.setItem(K_URL, this.server)
  },
  async setToken(t: string) {
    this.token = t
    if (t) await AsyncStorage.setItem(K_TOKEN, t); else await AsyncStorage.removeItem(K_TOKEN)
  },
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  if (!settings.server) throw new Error('no_server')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`
  const ctl = new AbortController()
  const to = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(settings.server + path, { ...init, headers, signal: ctl.signal })
    if (!r.ok) {
      let msg = `HTTP ${r.status}`
      try { const j = await r.json(); if (typeof j.detail === 'string') msg = j.detail } catch { /* not json */ }
      throw new Error(msg)
    }
    return r.json() as Promise<T>
  } finally { clearTimeout(to) }
}

export const api = {
  login: (email: string, password: string) =>
    call<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, WAKE),
  register: (b: { email: string; password: string; name: string; doctor_code?: string; birth_year?: number; sex?: string; consents?: string[] }) =>
    call<{ token: string; user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ ...b, role: 'patient' }) }, WAKE),
  me: () => call<User>('/api/me', {}, WAKE),
  updateMe: (b: Partial<Pick<User, 'name' | 'birth_year' | 'sex' | 'phone'>>) => call<User>('/api/me', { method: 'PUT', body: JSON.stringify(b) }),
  linkDoctor: (code: string) => call<User>('/api/me/doctor', { method: 'PUT', body: JSON.stringify({ doctor_code: code }) }),
  upload: (readings: ReadingOut[]) => call<{ saved: number; alerts: number }>('/api/readings', { method: 'POST', body: JSON.stringify({ readings }) }),
  report: (hours: number) => call<Report>(`/api/me/report?hours=${hours}`, {}, WAKE),
  symptom: (b: { kinds: string[]; severity: number; note?: string; ts?: number }) =>
    call<Symptom>('/api/symptoms', { method: 'POST', body: JSON.stringify(b) }),
  checkPlan: () => call<CheckPlan | null>('/api/me/checkplan'),
  setCheckPlan: (times: string[]) => call<CheckPlan>('/api/me/checkplan', { method: 'PUT', body: JSON.stringify({ times }) }),
  meds: () => call<{ meds: Med[]; today: TodayDose[] }>('/api/me/meds'),
  addMed: (b: MedBody) => call<Med>('/api/me/meds', { method: 'POST', body: JSON.stringify(b) }),
  editMed: (id: number, b: MedBody) => call<Med>(`/api/me/meds/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  stopMed: (id: number) => call<{ ok: boolean }>(`/api/me/meds/${id}`, { method: 'DELETE' }),
  dose: (id: number, slot: string, status: 'taken' | 'skipped') =>
    call<{ status: string }>(`/api/me/meds/${id}/dose`, { method: 'POST', body: JSON.stringify({ slot, status }) }),
  setDay: (day: string, tags: string[]) => call<{ day: string; tags: string[] }>('/api/me/day', { method: 'POST', body: JSON.stringify({ day, tags }) }),
  days: (n = 31) => call<{ day: string; tags: string[] }[]>(`/api/me/days?days=${n}`),
  ecg: (b: EcgOut) => call<EcgMeta>('/api/ecg', { method: 'POST', body: JSON.stringify(b) }),
  ecgGet: (id: number) => call<EcgMeta & { samples: number[] }>(`/api/ecg/${id}`),
  health: () => call<{ ok: boolean; version: string }>('/api/health', {}, WAKE),
  config: () => call<{ mode: 'research' | 'wellness'; version: string; telegram_bot: string | null }>('/api/config', {}, WAKE),
  feedback: (b: { rating: number; text?: string; platform?: string; app_version?: string }) =>
    call<{ ok: boolean }>('/api/feedback', { method: 'POST', body: JSON.stringify(b) }),
  telegram: () => call<{ enabled: boolean; bot: string | null; links: TgLink[] }>('/api/telegram'),
  telegramLink: () => call<{ code: string; url: string | null }>('/api/telegram/link', { method: 'POST' }),
  telegramUnlink: (id: number) => call<TgLink[]>(`/api/telegram/links/${id}`, { method: 'DELETE' }),
  risk: () => call<Risk>('/api/me/risk'),
  accessLog: () => call<{ ts: string; who: string; action: string }[]>('/api/me/access-log'),
  consents: () => call<{ version: string; consents: { kind: string; ts: string; withdrawn_at: string | null }[] }>('/api/me/consents'),
  setConsent: (kind: string, given: boolean) => call<{ consents: { kind: string; withdrawn_at: string | null }[] }>('/api/me/consents', { method: 'POST', body: JSON.stringify({ kind, given }) }),
  exportLink: () => call<{ url: string }>('/api/me/export-link', { method: 'POST' }),
  deleteMe: (password: string) => call<{ deleted: boolean }>('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
}
