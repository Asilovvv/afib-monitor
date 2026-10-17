/** Poincaré plot: each heartbeat interval RRn against the next one RRn+1.
 *  Sinus rhythm → a tight comet along the identity line; atrial fibrillation → a wide, structureless cloud. */
type Stats = { sd1: number | null; sd2: number | null; ratio: number | null }
export type PoincareData = { af: number[][]; normal: number[][]; af_stats?: Stats; normal_stats?: Stats }

const LO = 0.3, HI = 1.6

function ellipse(pts: number[][], sx: (v: number) => number, sy: (v: number) => number, color: string) {
  if (pts.length < 4) return null
  const d1 = pts.map(([a, b]) => (b - a) / Math.SQRT2), d2 = pts.map(([a, b]) => (b + a) / Math.SQRT2)
  const m = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
  const sd = (v: number[]) => { const mu = m(v); return Math.sqrt(m(v.map(x => (x - mu) ** 2))) }
  const c = m(d2) / Math.SQRT2                     // centre on the identity line (seconds)
  const k = (sx(HI) - sx(LO)) / (HI - LO)          // px per second
  return <ellipse cx={sx(c)} cy={sy(c)} rx={Math.max(2, 2 * sd(d2) * k)} ry={Math.max(2, 2 * sd(d1) * k)}
    transform={`rotate(-45 ${sx(c)} ${sy(c)})`} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="4 3" />
}

export function Poincare({ data, size = 320, labels = { x: 'RRₙ, s', y: 'RRₙ₊₁, s' } }: {
  data: PoincareData; size?: number; labels?: { x: string; y: string }
}) {
  const pad = 44, W = size, H = size
  const sx = (v: number) => pad + ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * (W - pad - 8)
  const sy = (v: number) => H - pad - ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * (H - pad - 8)
  const ticks = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="poincare" role="img" aria-label="Poincaré plot">
      <rect x={pad} y={8} width={W - pad - 8} height={H - pad - 8} rx={8} className="pc-bg" />
      {ticks.map(t => <g key={t}>
        <line x1={sx(t)} x2={sx(t)} y1={8} y2={H - pad} className="pc-grid" />
        <line x1={pad} x2={W - 8} y1={sy(t)} y2={sy(t)} className="pc-grid" />
        <text x={sx(t)} y={H - pad + 14} textAnchor="middle" className="pc-tick">{t.toFixed(1)}</text>
        <text x={pad - 6} y={sy(t) + 4} textAnchor="end" className="pc-tick">{t.toFixed(1)}</text>
      </g>)}
      <line x1={sx(LO)} y1={sy(LO)} x2={sx(HI)} y2={sy(HI)} className="pc-id" />
      {data.normal.map(([a, b], i) => <circle key={'n' + i} cx={sx(a)} cy={sy(b)} r={2.6} className="pc-n" />)}
      {data.af.map(([a, b], i) => <circle key={'a' + i} cx={sx(a)} cy={sy(b)} r={2.6} className="pc-af" />)}
      {ellipse(data.normal, sx, sy, 'var(--ok)')}
      {ellipse(data.af, sx, sy, 'var(--af)')}
      <text x={(W + pad) / 2} y={H - 4} textAnchor="middle" className="pc-lab">{labels.x}</text>
      <text x={11} y={(H - pad) / 2} textAnchor="middle" className="pc-lab" transform={`rotate(-90 11 ${(H - pad) / 2})`}>{labels.y}</text>
    </svg>
  )
}
