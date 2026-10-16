import { useMemo } from 'react'

/** Normalises amplitude: device strips are in ADC millivolts (large), MIT-BIH/synthetic in real mV. */
function normalise(x: number[]): number[] {
  if (!x.length) return x
  const sorted = [...x].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  const p99 = Math.max(Math.abs(sorted[Math.floor(sorted.length * 0.995)] - med), Math.abs(sorted[Math.floor(sorted.length * 0.005)] - med))
  const k = p99 > 4 || p99 < 0.2 ? 1.3 / (p99 || 1) : 1
  return x.map(v => (v - med) * k)
}

/** Simple R-peak picker for RR annotations on the strip. */
function rPeaks(x: number[], fs: number): number[] {
  const mx = Math.max(...x.map(Math.abs))
  const thr = 0.55 * mx, refr = Math.round(0.3 * fs)
  const out: number[] = []
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > thr && x[i] >= x[i - 1] && x[i] >= x[i + 1] && (!out.length || i - out[out.length - 1] > refr)) out.push(i)
  }
  return out
}

/**
 * ECG strip on classic ECG paper: 25 mm/s, 10 mm/mV. Small squares 1 mm (40 ms, 0.1 mV), big 5 mm.
 */
export function EcgStrip({ samples, fs, pxPerMm = 4, height = 34, annotate = true, color }: {
  samples: number[]; fs: number; pxPerMm?: number; height?: number; annotate?: boolean; color?: string
}) {
  const x = useMemo(() => normalise(samples), [samples])
  const peaks = useMemo(() => (annotate ? rPeaks(x, fs) : []), [x, fs, annotate])
  const secs = x.length / fs
  const W = Math.round(secs * 25 * pxPerMm), Hmm = height, H = Hmm * pxPerMm
  const mid = H * 0.58
  const px = (i: number) => (i / fs) * 25 * pxPerMm
  const py = (v: number) => mid - v * 10 * pxPerMm
  const d = x.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('')
  const id = `g${pxPerMm}`
  return (
    <div className="ecg-scroll">
      <svg width={W} height={H} className="ecg-paper" role="img" aria-label="ECG strip">
        <defs>
          <pattern id={`${id}s`} width={pxPerMm} height={pxPerMm} patternUnits="userSpaceOnUse">
            <path d={`M${pxPerMm} 0V${pxPerMm}H0`} fill="none" stroke="var(--grid-minor)" strokeWidth="0.6" />
          </pattern>
          <pattern id={`${id}b`} width={pxPerMm * 5} height={pxPerMm * 5} patternUnits="userSpaceOnUse">
            <rect width={pxPerMm * 5} height={pxPerMm * 5} fill={`url(#${id}s)`} />
            <path d={`M${pxPerMm * 5} 0V${pxPerMm * 5}H0`} fill="none" stroke="var(--grid-major)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="var(--paper)" />
        <rect width={W} height={H} fill={`url(#${id}b)`} />
        {/* 1 mV calibration pulse */}
        <path d={`M4,${mid} h${pxPerMm * 2} v${-10 * pxPerMm} h${pxPerMm * 5} v${10 * pxPerMm} h${pxPerMm * 2}`}
          fill="none" stroke="var(--ink)" strokeWidth="1.4" />
        <path d={d} fill="none" stroke={color ?? 'var(--ink)'} strokeWidth="1.5" strokeLinejoin="round" />
        {peaks.slice(1).map((p, k) => {
          const rr = (p - peaks[k]) / fs
          return (
            <text key={p} x={(px(p) + px(peaks[k])) / 2} y={H - 6} textAnchor="middle" className="ecg-rr">
              {Math.round(rr * 1000)}
            </text>
          )
        })}
        {Array.from({ length: Math.floor(secs) + 1 }, (_, s) => (
          <text key={s} x={s * 25 * pxPerMm + 3} y={12} className="ecg-sec">{s}s</text>
        ))}
      </svg>
    </div>
  )
}

export function rrStats(samples: number[], fs: number) {
  const x = normalise(samples)
  const p = rPeaks(x, fs)
  const rr = p.slice(1).map((v, i) => (v - p[i]) / fs)
  if (rr.length < 2) return null
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length
  const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length)
  return { hr: 60 / mean, cv: sd / mean, beats: p.length }
}

/** Tiny preview (no grid) for lists. */
export function EcgThumb({ samples, w = 220, h = 44, color }: { samples: number[]; w?: number; h?: number; color?: string }) {
  const x = useMemo(() => normalise(samples), [samples])
  const step = Math.max(1, Math.floor(x.length / w))
  const pts: string[] = []
  for (let i = 0; i < x.length; i += step) pts.push(`${((i / x.length) * w).toFixed(1)},${(h * 0.62 - x[i] * h * 0.32).toFixed(1)}`)
  return (
    <svg width={w} height={h} className="ecg-thumb" aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color ?? 'var(--accent)'} strokeWidth="1.2" />
    </svg>
  )
}
