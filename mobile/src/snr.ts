/** Signal-to-noise ratio of an ECG strip, same definition as Notebook 16 / firmware/afib_stream.py --snr:
 *  band-pass 0.5–40 Hz, beats aligned to a template (sub-sample shifts), noise = what is left of each beat after
 *  subtracting the average beat, signal power = total power − noise power, SNR = 10·log10(Ps/Pn).
 *  Pure TypeScript so the bench screen can show it on the phone; tools/mobile/snr_test.ts checks it against
 *  the Python version to ±1 dB. Requirement (ml/SNR_REQUIREMENT.md): ≥ 9 dB electrode motion, ≥ 18 dB muscle noise. */

/** scipy's butter(2, [0.5, 40], 'band', output='sos') and sosfilt_zi for the two sampling rates we use, copied
 *  digit for digit so the phone and the notebook filter identically; sosfiltfilt = odd padding (15), forward with
 *  zi·x[0], backward with zi·y[-1]. */
const SOS: Record<number, { sos: number[][]; zi: number[][] }> = {
  125: { sos: [[0.42585272817757913, 0.8517054563551583, 0.42585272817757913, 1, 0.5123421262208964, 0.22194959184806307],
               [1, -2, 1, 1, -1.9644596724263945, 0.9650901617386128]],
         zi: [[0.5563412677707916, 0.2078551716612201], [-0.9821939959483709, 0.9821939959483709]] },
  250: { sos: [[0.1424442454075173, 0.2848884908150346, 0.1424442454075173, 1, -0.6856000535320614, 0.26069603227349614],
               [1, -2, 1, 1, -1.9822347503854438, 0.9823948462782603]],
         zi: [[0.848306868653468, -0.11584063899872762], [-0.9907511140609854, 0.9907511140609854]] },
}
const PADLEN = 15

function sosfilt(sos: number[][], zi: number[][], x: Float64Array, x0: number): Float64Array {
  let y = Float64Array.from(x)
  for (let k = 0; k < sos.length; k++) {
    const [b0, b1, b2, , a1, a2] = sos[k]
    let z0 = zi[k][0] * x0, z1 = zi[k][1] * x0           // direct form II transposed, as scipy
    const out = new Float64Array(y.length)
    for (let i = 0; i < y.length; i++) {
      const xi = y[i], yi = b0 * xi + z0
      z0 = b1 * xi - a1 * yi + z1
      z1 = b2 * xi - a2 * yi
      out[i] = yi
    }
    x0 = out[0]; y = out                                 // next section starts from its own first output
  }
  return y
}

export function _filtfilt(x: Float64Array, fs: number): Float64Array {
  const f = SOS[fs]
  if (!f) throw new Error(`no filter for fs=${fs}`)
  const n = x.length, pad = Math.min(PADLEN, n - 1), ext = new Float64Array(n + 2 * pad)
  for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i] }
  ext.set(x, pad)
  let y = sosfilt(f.sos, f.zi, ext, ext[0])
  y.reverse(); y = sosfilt(f.sos, f.zi, y, y[0]); y.reverse()
  return y.slice(pad, pad + n)
}

export function snrDb(x: ArrayLike<number>, fs = 125): { snr: number | null; beats: number } {
  const y = _filtfilt(Float64Array.from(x), fs)
  const h = Math.round(0.3 * fs)
  const peaks = _refPeaks(y, fs).filter(p => p >= h && p < y.length - h)
  if (peaks.length < 10) return { snr: null, beats: peaks.length }
  const L = 2 * h
  const raw = peaks.map(p => y.slice(p - h, p + h))
  const interp = (b: Float64Array, d: number) => {
    const out = new Float64Array(L)
    for (let i = 0; i < L; i++) { const t = i + d, i0 = Math.floor(t), f = t - i0; out[i] = i0 < 0 ? b[0] : i0 >= L - 1 ? b[L - 1] : b[i0] * (1 - f) + b[i0 + 1] * f }
    return out
  }
  let beats = raw
  const shifts: number[] = []; for (let d = -2; d <= 2.001; d += 0.05) shifts.push(d)
  for (let it = 0; it < 3; it++) {
    const tmpl = mean(beats, L)
    beats = raw.map(b => {
      let best = b, bestE = Infinity
      for (const d of shifts) { const v = interp(b, d); let e = 0; for (let i = 0; i < L; i++) e += (v[i] - tmpl[i]) ** 2; if (e < bestE) { bestE = e; best = v } }
      return best
    })
  }
  const tmpl = mean(beats, L)
  let pn = 0, cnt = 0
  for (const b of beats) for (let i = 10; i < L - 10; i++) { pn += (b[i] - tmpl[i]) ** 2; cnt++ }
  pn /= cnt
  let m = 0; for (let i = 0; i < y.length; i++) m += y[i]; m /= y.length
  let v = 0; for (let i = 0; i < y.length; i++) v += (y[i] - m) ** 2; v /= y.length
  const ps = v - pn
  return { snr: ps > 0 ? 10 * Math.log10(ps / pn) : -Infinity, beats: peaks.length }
}

/** Same beat finder as the Python reference: peaks of the squared gradient, ≥ 0.3 s apart, higher than 0.3 × the 99th
 *  percentile; each refined to the largest |y| within ±10 samples. Kept identical so the two SNRs agree. */
export function _refPeaks(y: Float64Array, fs: number): number[] {
  const n = y.length, e = new Float64Array(n)
  for (let i = 0; i < n; i++) { const g = i === 0 ? y[1] - y[0] : i === n - 1 ? y[n - 1] - y[n - 2] : (y[i + 1] - y[i - 1]) / 2; e[i] = g * g }
  const sorted = Float64Array.from(e).sort()
  const p99 = sorted[Math.min(n - 1, Math.round(0.99 * (n - 1)))]      // numpy linear percentile ≈ nearest here
  const height = 0.3 * p99, dist = Math.round(0.3 * fs)
  // local maxima above height, then greedy by height with the distance rule (scipy find_peaks order)
  const cand: number[] = []
  for (let i = 1; i < n - 1; i++) if (e[i] > e[i - 1] && e[i] >= e[i + 1] && e[i] >= height) cand.push(i)
  cand.sort((a, b) => e[b] - e[a])
  const keep = new Uint8Array(n); const picked: number[] = []
  for (const c of cand) { if (picked.every(p => Math.abs(p - c) >= dist)) { picked.push(c); keep[c] = 1 } }
  picked.sort((a, b) => a - b)
  return picked.map(p => { let j = Math.max(0, p - 10); for (let k = j; k < Math.min(n, p + 10); k++) if (Math.abs(y[k]) > Math.abs(y[j])) j = k; return j })
}

function mean(bs: Float64Array[], L: number): Float64Array {
  const t = new Float64Array(L)
  for (const b of bs) for (let i = 0; i < L; i++) t[i] += b[i]
  for (let i = 0; i < L; i++) t[i] /= bs.length
  return t
}
