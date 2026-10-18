/** On-phone ECG analysis: R-peaks, RR intervals, Poincaré descriptors and a signal quality index.
 *  Same algorithm as backend/app/ecgtools.py (and the firmware detector): derivative² → 150 ms moving
 *  average → adaptive threshold with 250 ms refractory period. Integer rounding follows the Python code exactly
 *  (Math.floor = int()), so the 30-second check gives the same verdict on the phone and on the server. */

function highpass(x: ArrayLike<number>, fs: number): number[] {
  const w = Math.max(3, Math.floor(0.6 * fs)) | 1, h = w >> 1, n = x.length
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i]
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n, i + h + 1)
    out[i] = x[i] - (pre[b] - pre[a]) / (b - a)
  }
  return out
}

export function rPeaks(x: ArrayLike<number>, fs = 125): number[] {
  const n = x.length
  if (n < fs) return []
  const y = highpass(x, fs)
  const ma = Math.max(3, Math.floor(0.15 * fs))
  const buf = new Float64Array(ma), env = new Float64Array(n)
  let s = 0, prev = y[0]
  for (let i = 0; i < n; i++) {
    const e = (y[i] - prev) ** 2; prev = y[i]
    s += e - buf[i % ma]; buf[i % ma] = e
    env[i] = s / ma
  }
  const decay = Math.pow(0.5, 1 / (2 * fs)), thr = 0.35, refr = Math.floor(0.25 * fs)
  let pk = 1e-12
  for (let i = 0; i < Math.min(n, 2 * fs); i++) pk = Math.max(pk, env[i])
  const out: number[] = []
  let last = -1e9, armed = true
  for (let i = Math.floor(0.2 * fs); i < n; i++) {
    pk = Math.max(pk * decay, env[i])
    if (armed && env[i] > thr * pk && i - last > refr) {
      let j = Math.max(0, i - ma - 4)
      for (let k = j; k < Math.min(n, i + 3); k++) if (Math.abs(y[k]) > Math.abs(y[j])) j = k
      if (!out.length || j - out[out.length - 1] > refr) out.push(j)
      last = i; armed = false
    } else if (!armed && env[i] < 0.5 * thr * pk) armed = true
  }
  return out
}

export type PoincareStats = { points: [number, number][]; sd1: number | null; sd2: number | null; ratio: number | null }

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map(x => (x - m) ** 2))) }

export function poincare(rr: number[]): PoincareStats {
  const r = rr.filter(v => v >= 0.25 && v <= 2)
  const points = r.slice(1).map((b, i) => [r[i], b] as [number, number])
  if (points.length < 3) return { points, sd1: null, sd2: null, ratio: null }
  const s1 = sd(points.map(([a, b]) => (b - a) / Math.SQRT2)), s2 = sd(points.map(([a, b]) => (b + a) / Math.SQRT2))
  return { points, sd1: Math.round(s1 * 1000), sd2: Math.round(s2 * 1000), ratio: s2 > 0 ? Math.round((s1 / s2) * 100) / 100 : null }
}

export type Quality = { sqi: number; level: 'good' | 'fair' | 'poor' }

export function quality(x: ArrayLike<number>, fs = 125, peaks?: number[]): Quality {
  const n = x.length
  if (n < 2 * fs) return { sqi: 0, level: 'poor' }
  const p = peaks ?? rPeaks(x, fs)
  const y = highpass(x, fs)
  let mn = Infinity, mx = -Infinity, flat = 0
  for (let i = 0; i < n; i++) { mn = Math.min(mn, y[i]); mx = Math.max(mx, y[i]); if (i && Math.abs(y[i] - y[i - 1]) < 1e-4) flat++ }
  const sFlat = mx - mn < 0.05 || flat / n > 0.5 ? 0 : 1
  const bpm = (p.length / (n / fs)) * 60
  const sRate = bpm >= 30 && bpm <= 200 ? 1 : 0
  const h = Math.floor(0.1 * fs)
  const segs = p.filter(q => q - h >= 0 && q + h <= n).map(q => y.slice(q - h, q + h))
  let sShape = 0
  if (segs.length >= 3) {
    const tmpl = segs[0].map((_, k) => { const col = segs.map(sg => sg[k]).sort((a, b) => a - b), m = col.length >> 1; return col.length % 2 ? col[m] : (col[m - 1] + col[m]) / 2 })
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a), mb = mean(b)
      let num = 0, da = 0, db = 0
      for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
      return num / (Math.sqrt(da * db) || 1e-12)
    }
    sShape = Math.max(0, mean(segs.map(sg => corr(sg, tmpl))))
  }
  let d2 = 0
  for (let i = 1; i < n - 1; i++) d2 += (y[i + 1] - 2 * y[i] + y[i - 1]) ** 2
  const noise = Math.sqrt(d2 / (n - 2)) / (sd(y) || 1e-12)
  const sNoise = Math.max(0, Math.min(1, 1.5 - noise))
  const sqi = Math.round(Math.max(0, Math.min(1, sFlat * sRate * (0.6 * sShape + 0.4 * sNoise))) * 100) / 100
  return { sqi, level: sqi >= 0.7 ? 'good' : sqi >= 0.4 ? 'fair' : 'poor' }
}

export function analyze(x: ArrayLike<number>, fs = 125) {
  const p = rPeaks(x, fs)
  const rr = p.slice(1).map((b, i) => (b - p[i]) / fs)
  const r = rr.filter(v => v >= 0.25 && v <= 2)
  const irr = r.length >= 4 ? mean(r.slice(1).map((b, i) => Math.abs(b - r[i]))) / mean(r) : null
  return { peaks: p, rr, poincare: poincare(rr), irregularity: irr == null ? null : Math.round(irr * 1000) / 1000, quality: quality(x, fs, p) }
}

function movmean(x: ArrayLike<number>, w: number): number[] {
  const n = x.length, h = w >> 1, pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i]
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); out[i] = (pre[b] - pre[a]) / (b - a) }
  return out
}

/** Second detector settings: smoothing samples, baseline window s, threshold fraction, refractory s —
 *  the same as ecgtools.AMP_DEFAULT and firmware check30.h (chosen on MIT-BIH, Notebook 9). */
export const AMP: [number, number, number, number] = [3, 0.12, 0.5, 0.3]

/** Second, independent R-peak detector (amplitude, not slope energy) — same as ecgtools.r_peaks_amp(). */
export function rPeaksAmp(x: ArrayLike<number>, fs = 125, params = AMP): number[] {
  const [w1, w2s, frac, refrS] = params
  const n = x.length
  if (n < fs) return []
  const y = w1 > 1 ? movmean(x, w1) : Array.from(x)
  const base = movmean(y, Math.max(3, Math.floor(w2s * fs)) | 1)
  const a = y.map((v, i) => Math.abs(v - base[i]))
  const decay = Math.pow(0.5, 1 / (2 * fs)), refr = Math.floor(refrS * fs), look = Math.floor(0.1 * fs)
  let pk = 0
  for (let i = 0; i < Math.min(n, 2 * fs); i++) pk = Math.max(pk, a[i])
  if (!pk) pk = 1e-12
  const out: number[] = []
  let i = 0
  while (i < n) {
    pk = Math.max(pk * decay, a[i])
    if (a[i] > frac * pk && (!out.length || i - out[out.length - 1] > refr)) {
      let j = i
      for (let k = i; k < Math.min(n, i + look); k++) if (a[k] > a[j]) j = k
      if (!out.length || j - out[out.length - 1] > refr) out.push(j)
      i = j + 1
      continue
    }
    i++
  }
  return out
}

/** Agreement of two detectors (Li, Mark & Clifford 2008), match within 150 ms — same as ecgtools.bsqi(). */
export function bsqi(p1: number[], p2: number[], fs = 125, tolS = 0.15): number {
  if (!p1.length && !p2.length) return 0
  const tol = Math.floor(tolS * fs), used = new Set<number>()
  let m = 0, j = 0
  for (const p of p1) {
    while (j < p2.length && p2[j] < p - tol) j++
    for (let k = j; k < p2.length && p2[k] <= p + tol; k++) if (!used.has(k)) { used.add(k); m++; break }
  }
  return Math.round((m / (p1.length + p2.length - m)) * 1000) / 1000
}

/** "Check me in 30 seconds" — same rule and constants as ecgtools.check() on the server (v2: with the
 *  two-detector agreement gate). Validated on PhysioNet/CinC 2017, see ml/CHECK30_*.md. Wellness wording only. */
export const CHECK_SECONDS = 30
export type CheckVerdict = 'regular' | 'irregular' | 'no_verdict'
export function check(x: ArrayLike<number>, fs = 125): { verdict: CheckVerdict; beats: number; sqi: number; irregularity: number | null; bsqi: number; bpm: number } {
  const a = analyze(x, fs)
  const n = a.peaks.length, sqi = a.quality.sqi, irr = a.irregularity
  const b = bsqi(a.peaks, rPeaksAmp(x, fs), fs)
  const verdict: CheckVerdict = n < 16 || sqi < 0.4 || irr == null || b < 0.8 ? 'no_verdict' : irr > 0.1 ? 'irregular' : 'regular'
  return { verdict, beats: n, sqi, irregularity: irr, bsqi: b, bpm: Math.round(n / (x.length / fs) * 60) }
}
