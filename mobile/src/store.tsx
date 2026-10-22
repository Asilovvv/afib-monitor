import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import * as Notifications from 'expo-notifications'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, useColorScheme } from 'react-native'
import { api, settings, type EcgOut, type ReadingOut, type User } from './api'
import { DeviceLink, type LinkState } from './ble'
import { translate, type Key, type Lang } from './i18n'
import { ECG_FS, RhythmState, type EcgPacket, type Status } from './protocol'
import { check, CHECK_SECONDS, type CheckVerdict } from './rr'
import { Simulator } from './simulator'
import { EcgBus } from './ecgbus'
export { EcgBus }
import { dark, light, type Theme } from './theme'

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  })
}

export type Source = 'none' | 'device' | 'simulator'
export type ThemePref = 'system' | 'light' | 'dark'
export type LocalEpisode = { start: number; end: number; maxProb: number; maxBpm: number }
export type LocalSymptom = { ts: number; kinds: string[]; severity: number; note?: string; synced: boolean }
export type Toast = { id: number; text: string; tone: 'ok' | 'af' | 'info' }


type Ctx = {
  // prefs
  ready: boolean
  lang: Lang; setLang: (l: Lang) => void
  mode: 'research' | 'wellness'   // wellness = no rhythm verdicts, no AF alerts (before medical-device registration)
  themePref: ThemePref; setThemePref: (p: ThemePref) => void
  big: boolean; setBig: (b: boolean) => void      // large mode: bigger text, essentials only
  theme: Theme
  t: (k: Key | string, vars?: Record<string, string | number>) => string
  onboarded: boolean; finishOnboarding: () => void
  // account
  user: User | null
  offline: boolean; setOffline: (v: boolean) => void
  signIn: (u: User, token: string) => Promise<void>
  signOut: () => Promise<void>
  setUser: (u: User) => void
  // device
  source: Source
  link: { state: LinkState; detail?: string }
  status: Status | null
  battery: number | null
  rssi: number | null
  ecg: EcgBus
  history: Status[]
  episodes: LocalEpisode[]
  startDevice: () => void
  startSimulator: () => void
  stop: () => void
  connectedAt: number | null
  // ecg + symptoms
  recording: number | null          // progress 0..1 while recording
  recordEcg: () => Promise<void>
  checking: number | null           // progress 0..1 during the 30-second check
  checkMe: () => Promise<CheckResult | null>
  symptoms: LocalSymptom[]
  addSymptom: (kinds: string[], severity: number, note: string, attachEcg: boolean) => Promise<void>
  // sync
  pending: number
  lastSync: number | null
  syncError: string | null
  syncNow: () => Promise<void>
  dataVersion: number               // bumps when new data reached the server
  // toasts
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
}

export type CheckResult = { verdict: CheckVerdict; bpm: number; sqi: number; irregularity: number | null; at: number; gaps?: boolean }

const C = createContext<Ctx | null>(null)
export const useApp = () => useContext(C)!

const K = { queue: 'afib.queue', ecgQueue: 'afib.ecgq', symQueue: 'afib.symq', lang: 'afib.lang', theme: 'afib.theme',
  onboarded: 'afib.onboarded', big: 'afib.big', mode: 'afib.mode', offline: 'afib.offline', symptoms: 'afib.symptoms', episodes: 'afib.episodes' }
const HISTORY_MS = 3 * 3600e3
const SYNC_MS = 20e3
const ECG_SECONDS = 10

export function AppProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const [ready, setReady] = useState(false)
  const [lang, setLangS] = useState<Lang>('ru')
  const [mode, setMode] = useState<'research' | 'wellness'>('research')
  const modeRef = useRef<'research' | 'wellness'>('research')
  const [themePref, setThemePrefS] = useState<ThemePref>('system')
  const [big, setBigS] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [offline, setOfflineS] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [source, setSource] = useState<Source>('none')
  const [link, setLink] = useState<{ state: LinkState; detail?: string }>({ state: 'idle' })
  const [status, setStatus] = useState<Status | null>(null)
  const [battery, setBattery] = useState<number | null>(null)
  const [rssi, setRssi] = useState<number | null>(null)
  const [history, setHistory] = useState<Status[]>([])
  const [episodes, setEpisodes] = useState<LocalEpisode[]>([])
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [recording, setRecording] = useState<number | null>(null)
  const [checking, setChecking] = useState<number | null>(null)
  const [symptoms, setSymptoms] = useState<LocalSymptom[]>([])
  const [pending, setPending] = useState(0)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  const ecg = useMemo(() => new EcgBus(), [])
  const queue = useRef<ReadingOut[]>([])
  const ecgQueue = useRef<EcgOut[]>([])
  const symQueue = useRef<{ kinds: string[]; severity: number; note?: string; ts: number }[]>([])
  const prevState = useRef<RhythmState | null>(null)
  const lastStatus = useRef<Status | null>(null)
  const langRef = useRef<Lang>('ru')
  const tid = useRef(0)

  const t = useCallback((k: Key | string, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang])
  const theme = themePref === 'system' ? (scheme === 'dark' ? dark : light) : themePref === 'dark' ? dark : light

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++tid.current
    setToasts(ts => [...ts.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3800)
  }, [])

  const persist = useCallback(() => {
    AsyncStorage.multiSet([
      [K.queue, JSON.stringify(queue.current.slice(-20000))],
      [K.ecgQueue, JSON.stringify(ecgQueue.current.slice(-20))],
      [K.symQueue, JSON.stringify(symQueue.current)],
    ]).catch(() => undefined)
    setPending(queue.current.length + ecgQueue.current.length + symQueue.current.length)
  }, [])

  // ------------------------------------------------ upload to the server
  const syncNow = useCallback(async () => {
    if (!settings.token || !settings.server) return
    let sent = false
    try {
      while (symQueue.current.length) {
        await api.symptom(symQueue.current[0]); symQueue.current.shift(); sent = true
      }
      while (ecgQueue.current.length) {
        await api.ecg(ecgQueue.current[0]); ecgQueue.current.shift(); sent = true
      }
      while (queue.current.length) {
        const batch = queue.current.slice(0, 2000)
        await api.upload(batch)
        queue.current = queue.current.slice(batch.length); sent = true
      }
      setLastSync(Date.now()); setSyncError(null)
      setSymptoms(s => s.map(x => ({ ...x, synced: true })))
    } catch (e) {
      setSyncError((e as Error).message)
    }
    persist()
    if (sent) setDataVersion(v => v + 1)
  }, [persist])

  // ------------------------------------------------ ECG capture
  const captureLast = useCallback((reason: EcgOut['reason'], s: Status | null) => {
    const n = ECG_SECONDS * ECG_FS
    if (ecg.total < n / 2) return false
    const samples = ecg.last(n).map(x => Math.round(x * 1e4) / 1e4)
    ecgQueue.current.push({
      ts: Date.now() / 1000 - samples.length / ECG_FS, fs: ECG_FS, samples, reason,
      state: s?.state ?? 1, prob: s?.prob ?? 0, bpm: s?.bpm ?? 0,
    })
    persist()
    return true
  }, [ecg, persist])

  const recordEcg = useCallback(async () => {
    if (recording !== null || !lastStatus.current) return
    const start = ecg.total
    const need = ECG_SECONDS * ECG_FS
    await new Promise<void>(res => {
      setRecording(0)
      const iv = setInterval(() => {
        const p = (ecg.total - start) / need
        setRecording(Math.min(1, p))
        if (p >= 1) { clearInterval(iv); res() }
      }, 200)
    })
    setRecording(null)
    captureLast('manual', lastStatus.current)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
    if (settings.token) { await syncNow(); toast(translate(langRef.current, ecgQueue.current.length ? 'ecg_saved_local' : 'ecg_saved'), 'ok') }
    else toast(translate(langRef.current, 'ecg_saved_local'), 'ok')
  }, [recording, ecg, captureLast, syncNow, toast])

  /** "Check me in 30 seconds": verdict on the phone (same rule as the server), recording queued for the doctor. */
  const checkMe = useCallback(async (): Promise<CheckResult | null> => {
    if (checking !== null || recording !== null || !lastStatus.current) return null
    const start = ecg.total, need = CHECK_SECONDS * ECG_FS
    const ok = await new Promise<boolean>(res => {
      setChecking(0)
      let seen = ecg.total, still = Date.now()
      const iv = setInterval(() => {
        if (ecg.total !== seen) { seen = ecg.total; still = Date.now() }
        const p = (ecg.total - start) / need
        setChecking(Math.min(1, p))
        if (p >= 1) { clearInterval(iv); res(true) } else if (Date.now() - still > 4000) { clearInterval(iv); res(false) }
      }, 200)
    })
    setChecking(null)
    if (!ok) { toast(translate(langRef.current, 'check_lost'), 'info'); return null }
    const samples = ecg.last(need).map(x => Math.round(x * 1e4) / 1e4)
    // a strip with lost Bluetooth packets has unknown beats in the holes: no verdict, ask to repeat (not saved)
    if (ecg.holes(need) > 0) { return { verdict: 'no_verdict', bpm: 0, sqi: 0, irregularity: null, at: Date.now(), gaps: true } }
    const r = check(samples, ECG_FS)
    const s = lastStatus.current
    ecgQueue.current.push({ ts: Date.now() / 1000 - samples.length / ECG_FS, fs: ECG_FS, samples, reason: 'check',
      state: s?.state ?? 1, prob: s?.prob ?? 0, bpm: r.bpm })
    persist()
    Haptics.notificationAsync(r.verdict === 'regular' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined)
    if (settings.token) syncNow()
    return { verdict: r.verdict, bpm: r.bpm, sqi: r.sqi, irregularity: r.irregularity, at: Date.now() }
  }, [checking, recording, ecg, persist, syncNow, toast])

  // ------------------------------------------------ incoming status (device or simulator)
  const onStatus = useCallback((s: Status) => {
    lastStatus.current = s
    setStatus(s)
    if (s.battery != null) setBattery(s.battery)
    setHistory(h => [...h.filter(x => s.at - x.at < HISTORY_MS), s])

    if (s.state === RhythmState.AFib && modeRef.current === 'research') {
      setEpisodes(eps => {
        const last = eps[eps.length - 1]
        const next = last && s.at - last.end < 60e3
          ? [...eps.slice(0, -1), { ...last, end: s.at, maxProb: Math.max(last.maxProb, s.prob), maxBpm: Math.max(last.maxBpm, s.bpm) }]
          : [...eps, { start: s.at, end: s.at, maxProb: s.prob, maxBpm: s.bpm }]
        AsyncStorage.setItem(K.episodes, JSON.stringify(next.slice(-200))).catch(() => undefined)
        return next
      })
      if (prevState.current !== RhythmState.AFib) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined)
        if (Platform.OS !== 'web') {
          Notifications.scheduleNotificationAsync({
            content: { title: translate(langRef.current, 'af_notif_t'), body: translate(langRef.current, 'af_notif_b', { bpm: Math.round(s.bpm) }) },
            trigger: null,
          }).catch(() => undefined)
        }
        // keep 5 s after onset in the strip, then send it to the doctor
        setTimeout(() => { if (captureLast('afib_onset', lastStatus.current)) syncNow() }, 5000)
      }
    }
    if (s.state === RhythmState.AFib || s.state === RhythmState.Normal) prevState.current = s.state

    if (s.state !== RhythmState.Collecting) {
      queue.current.push({ ts: s.at / 1000, state: s.state, prob: s.prob, bpm: s.bpm, battery: s.battery })
      setPending(queue.current.length + ecgQueue.current.length + symQueue.current.length)
    }
  }, [captureLast, syncNow])

  const onEcg = useCallback((p: EcgPacket) => ecg.push(p), [ecg])

  const deviceLink = useMemo(() => new DeviceLink(onStatus, (state, detail) => {
    setLink({ state, detail })
    if (state === 'connected') setConnectedAt(Date.now())
  }, onEcg), [onStatus, onEcg])
  const sim = useMemo(() => new Simulator(onStatus, onEcg), [onStatus, onEcg])

  const stop = useCallback(() => {
    sim.stop()
    deviceLink.disconnect().catch(() => undefined)
    setSource('none'); setStatus(null); setConnectedAt(null); prevState.current = null; lastStatus.current = null
    setLink({ state: 'idle' })
    syncNow()
  }, [sim, deviceLink, syncNow])

  const startDevice = useCallback(() => {
    sim.stop(); ecg.reset(); setSource('device'); deviceLink.connect()
  }, [sim, deviceLink, ecg])

  const startSimulator = useCallback(() => {
    deviceLink.disconnect().catch(() => undefined)
    ecg.reset(); setSource('simulator'); setLink({ state: 'connected', detail: 'sim' }); setConnectedAt(Date.now()); sim.start()
  }, [sim, deviceLink, ecg])

  // RSSI every 5 s while connected to the real board
  useEffect(() => {
    if (source !== 'device' || link.state !== 'connected') { setRssi(source === 'simulator' ? -52 : null); return }
    const iv = setInterval(() => deviceLink.readRssi().then(setRssi), 5000)
    return () => clearInterval(iv)
  }, [source, link.state, deviceLink])

  useEffect(() => {
    const iv = setInterval(syncNow, SYNC_MS)
    return () => clearInterval(iv)
  }, [syncNow])

  // ------------------------------------------------ symptoms
  const addSymptom = useCallback(async (kinds: string[], severity: number, note: string, attachEcg: boolean) => {
    const item = { kinds, severity, note: note.trim() || undefined, ts: Date.now() / 1000 }
    setSymptoms(s => {
      const next = [{ ...item, ts: Date.now(), synced: false }, ...s].slice(0, 300)
      AsyncStorage.setItem(K.symptoms, JSON.stringify(next)).catch(() => undefined)
      return next
    })
    symQueue.current.push(item)
    if (attachEcg) captureLast('symptom', lastStatus.current)
    persist()
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
    await syncNow()
  }, [captureLast, persist, syncNow])

  // ------------------------------------------------ prefs + start-up
  const loadConfig = useCallback(() => {
    api.config().then(c => {
      const m = c.mode === 'wellness' ? 'wellness' : 'research'
      setMode(m); modeRef.current = m; AsyncStorage.setItem(K.mode, m).catch(() => undefined)
    }).catch(() => undefined)
  }, [])
  const setLang = useCallback((l: Lang) => { setLangS(l); langRef.current = l; AsyncStorage.setItem(K.lang, l).catch(() => undefined) }, [])
  const setBig = useCallback((b: boolean) => { setBigS(b); AsyncStorage.setItem(K.big, b ? '1' : '0').catch(() => undefined) }, [])
  const setThemePref = useCallback((p: ThemePref) => { setThemePrefS(p); AsyncStorage.setItem(K.theme, p).catch(() => undefined) }, [])
  const finishOnboarding = useCallback(() => { setOnboarded(true); AsyncStorage.setItem(K.onboarded, '1').catch(() => undefined) }, [])
  const setOffline = useCallback((v: boolean) => { setOfflineS(v); AsyncStorage.setItem(K.offline, v ? '1' : '').catch(() => undefined) }, [])

  useEffect(() => {
    (async () => {
      try {
        await settings.load()
        const kv = Object.fromEntries(await AsyncStorage.multiGet(Object.values(K)))
        const j = <T,>(k: string, d: T): T => { try { return kv[k] ? JSON.parse(kv[k]) : d } catch { return d } }
        queue.current = j(K.queue, []); ecgQueue.current = j(K.ecgQueue, []); symQueue.current = j(K.symQueue, [])
        setPending(queue.current.length + ecgQueue.current.length + symQueue.current.length)
        setSymptoms(j(K.symptoms, [])); setEpisodes(j(K.episodes, []))
        if (kv[K.lang] === 'en' || kv[K.lang] === 'ru' || kv[K.lang] === 'ky') { setLangS(kv[K.lang] as Lang); langRef.current = kv[K.lang] as Lang }
        if (kv[K.theme]) setThemePrefS(kv[K.theme] as ThemePref)
        setBigS(kv[K.big] === '1')
        if (kv[K.mode] === 'wellness') { setMode('wellness'); modeRef.current = 'wellness' }
        setOnboarded(kv[K.onboarded] === '1'); setOfflineS(kv[K.offline] === '1')
        if (Platform.OS !== 'web') Notifications.requestPermissionsAsync().catch(() => undefined)
        if (settings.token && settings.server) {
          try { setUser(await api.me()) } catch { /* offline: keep token */ }
        }
        if (settings.server) loadConfig()
      } finally { setReady(true) }
    })()
  }, [])

  const signIn = useCallback(async (u: User, token: string) => {
    await settings.setToken(token); setUser(u); setOffline(false); syncNow(); loadConfig()
  }, [setOffline, syncNow])
  const signOut = useCallback(async () => {
    await settings.setToken(''); setUser(null)
  }, [])

  const value: Ctx = {
    ready, lang, setLang, mode, themePref, setThemePref, big, setBig, theme, t, onboarded, finishOnboarding,
    user, offline, setOffline, signIn, signOut, setUser,
    source, link, status, battery, rssi, ecg, history, episodes, startDevice, startSimulator, stop, connectedAt,
    recording, recordEcg, checking, checkMe, symptoms, addSymptom,
    pending, lastSync, syncError, syncNow, dataVersion, toasts, toast,
  }
  return <C.Provider value={value}>{children}</C.Provider>
}
