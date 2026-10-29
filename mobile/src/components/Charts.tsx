import { fmtDate } from '../i18n'
import { useState } from 'react'
import { View } from 'react-native'
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg'
import type { Hour } from '../api'
import { useApp } from '../store'
import { F } from '../theme'

const label = (iso: string, daily: boolean, lang: string) => {
  const d = new Date(iso)
  return daily ? fmtDate(lang, d, { day: 'numeric', month: 'short' }).replace('.', '')
    : `${String(d.getHours()).padStart(2, '0')}:00`
}

/** AF minutes per hour (or per day for long ranges) on top of monitored time. */
export function HourBars({ data, height = 140 }: { data: Hour[]; height?: number }) {
  const { theme: t, lang } = useApp()
  const [w, setW] = useState(0)
  const daily = data.length > 1 && new Date(data[1].t).getTime() - new Date(data[0].t).getTime() > 3600e3 * 1.5
  const cap = daily ? 1440 : 60
  const n = Math.max(1, data.length)
  const gap = n > 40 ? 1 : 3
  const bw = w ? (w - gap * (n - 1)) / n : 0
  const H = height - 20
  const every = Math.ceil(n / 6)
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {data.map((h, i) => {
            const x = i * (bw + gap)
            const mon = Math.min(1, h.monitored_min / cap) * H
            const af = Math.min(1, h.af_min / cap) * H
            return (
              <G key={i}>
                <Rect x={x} y={H - mon} width={bw} height={Math.max(mon, 2)} rx={Math.min(3, bw / 2)} fill={mon ? t.okSoft : t.track} />
                {af > 0 && <Rect x={x} y={H - Math.max(af, 3)} width={bw} height={Math.max(af, 3)} rx={Math.min(3, bw / 2)} fill={t.af} />}
                {i % every === 0 && <SvgText x={x} y={height - 4} fontSize={10} fill={t.ink3} fontFamily={F.mono}>{label(h.t, daily, lang)}</SvgText>}
              </G>
            )
          })}
        </Svg>
      )}
    </View>
  )
}

/** Mean heart rate per bucket as a smooth line with AF buckets highlighted. */
export function HrLine({ data, height = 120 }: { data: Hour[]; height?: number }) {
  const { theme: t } = useApp()
  const [w, setW] = useState(0)
  const pts = data.map((h, i) => ({ i, v: h.bpm, af: h.af_min > 0 }))
  const vals = pts.filter(p => p.v != null).map(p => p.v as number)
  const lo = vals.length ? Math.min(...vals) - 8 : 40, hi = vals.length ? Math.max(...vals) + 8 : 140
  const H = height - 16
  const x = (i: number) => (w * i) / Math.max(1, data.length - 1)
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H + 4
  let d = '', pen = false
  for (const p of pts) {
    if (p.v == null) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`; pen = true
  }
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {pts.filter(p => p.af).map(p => <Rect key={p.i} x={x(p.i) - w / data.length / 2} y={0} width={w / data.length} height={H + 6} fill={t.afSoft} />)}
          <Path d={d} stroke={t.accent} strokeWidth={2} fill="none" strokeLinejoin="round" />
          <SvgText x={2} y={12} fontSize={10} fill={t.ink3} fontFamily={F.mono}>{Math.round(hi)}</SvgText>
          <SvgText x={2} y={H + 2} fontSize={10} fill={t.ink3} fontFamily={F.mono}>{Math.round(lo)}</SvgText>
        </Svg>
      )}
    </View>
  )
}
