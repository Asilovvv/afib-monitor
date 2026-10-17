import { useEffect, useState } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Ellipse, G, Line, Rect, Text as SvgText } from 'react-native-svg'
import { ECG_FS } from '../protocol'
import { analyze, type Quality } from '../rr'
import { useApp, type EcgBus } from '../store'
import { F } from '../theme'
import { Card, Pill, Row, T } from './ui'

const LO = 0.3, HI = 1.6

/** Poincaré plot (RRn vs RRn+1). Sinus rhythm: tight comet on the diagonal; AF: wide cloud. */
export function PoincarePlot({ points, color, size = 240 }: { points: [number, number][]; color: string; size?: number }) {
  const { theme: tm } = useApp()
  const pad = 30, inner = size - pad - 6
  const sx = (v: number) => pad + ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * inner
  const sy = (v: number) => 6 + inner - ((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * inner
  let ell = null
  if (points.length >= 4) {
    const d1 = points.map(([a, b]) => (b - a) / Math.SQRT2), d2 = points.map(([a, b]) => (b + a) / Math.SQRT2)
    const m = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length
    const sd = (v: number[]) => { const mu = m(v); return Math.sqrt(m(v.map(x => (x - mu) ** 2))) }
    const c = m(d2) / Math.SQRT2, k = inner / (HI - LO)
    ell = <Ellipse cx={sx(c)} cy={sy(c)} rx={Math.max(3, 2 * sd(d2) * k)} ry={Math.max(3, 2 * sd(d1) * k)}
      origin={`${sx(c)}, ${sy(c)}`} rotation={-45} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="4 3" />
  }
  return (
    <Svg width={size} height={size}>
      <Rect x={pad} y={6} width={inner} height={inner} rx={10} fill={tm.paper} stroke={tm.line} />
      {[0.4, 0.8, 1.2].map(v => (
        <G key={v}>
          <Line x1={sx(v)} x2={sx(v)} y1={6} y2={6 + inner} stroke={tm.gridMinor} />
          <Line x1={pad} x2={pad + inner} y1={sy(v)} y2={sy(v)} stroke={tm.gridMinor} />
          <SvgText x={sx(v)} y={size - 2} fontSize={9} fill={tm.ink3} textAnchor="middle" fontFamily={F.mono}>{v.toFixed(1)}</SvgText>
          <SvgText x={pad - 4} y={sy(v) + 3} fontSize={9} fill={tm.ink3} textAnchor="end" fontFamily={F.mono}>{v.toFixed(1)}</SvgText>
        </G>
      ))}
      <Line x1={sx(LO)} y1={sy(LO)} x2={sx(HI)} y2={sy(HI)} stroke={tm.ink3} strokeDasharray="3 4" />
      {points.map(([a, b], i) => <Circle key={i} cx={sx(a)} cy={sy(b)} r={3} fill={color} fillOpacity={0.6} />)}
      {ell}
    </Svg>
  )
}

export function QualityPill({ q }: { q: Quality }) {
  const { theme: tm, t } = useApp()
  const c = q.level === 'good' ? [tm.ok, tm.okSoft] : q.level === 'fair' ? [tm.warn, tm.warnSoft] : [tm.af, tm.afSoft]
  return <Pill text={`${t('sqi')}: ${t(`sqi_${q.level}`)} · ${Math.round(q.sqi * 100)}%`} fg={c[0]} bg={c[1]} />
}

/** Live analysis of the last 60 s of ECG from the device: signal quality + Poincaré plot. */
export function useLiveAnalysis(bus: EcgBus, seconds = 60) {
  const [a, setA] = useState<ReturnType<typeof analyze> | null>(null)
  useEffect(() => {
    const run = () => { const x = bus.last(seconds * ECG_FS); setA(x.length >= 4 * ECG_FS ? analyze(x, ECG_FS) : null) }
    run()
    const id = setInterval(run, 3000)
    return () => clearInterval(id)
  }, [bus, seconds])
  return a
}

export function PoincareCard({ a, af }: { a: ReturnType<typeof analyze> | null; af: boolean }) {
  const { theme: tm, t } = useApp()
  const color = af ? tm.af : tm.ok
  return (
    <Card style={{ marginTop: 14 }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <T v="h3">{t('poincare')}</T>
        <T v="mono">60 {t('s')}</T>
      </Row>
      <T v="small" style={{ marginBottom: 10 }}>{t('poincare_sub')}</T>
      {!a || a.poincare.points.length < 3 ? <T v="small" c={tm.ink3}>{t('waiting')}</T> : (
        <Row gap={14} style={{ alignItems: 'center' }}>
          <PoincarePlot points={a.poincare.points} color={color} size={170} />
          <View style={{ flex: 1, gap: 10 }}>
            <View><T v="label">SD1 / SD2</T><T v="num" style={{ fontSize: 18 }}>{a.poincare.sd1 ?? '—'} / {a.poincare.sd2 ?? '—'}</T><T v="small">ms</T></View>
            <View><T v="label">{t('irregularity')}</T>
              <T v="num" style={{ fontSize: 18 }} c={a.irregularity != null && a.irregularity > 0.1 ? tm.af : undefined}>{a.irregularity?.toFixed(2) ?? '—'}</T>
              <T v="small">{t('irregularity_hint')}</T></View>
          </View>
        </Row>
      )}
    </Card>
  )
}
