import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, Line, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg'
import { ECG_FS } from '../protocol'
import { useApp, type EcgBus } from '../store'

function pathOf(xs: number[], w: number, h: number, mvPerH: number, x0 = 0, dx = w / Math.max(1, xs.length - 1)) {
  if (!xs.length) return ''
  // remove baseline (median-ish) so the trace stays centred
  const sorted = [...xs].sort((a, b) => a - b)
  const base = sorted[Math.floor(sorted.length * 0.5)]
  let d = ''
  for (let i = 0; i < xs.length; i++) {
    const y = h * 0.62 - ((xs[i] - base) / mvPerH) * h
    d += `${i ? 'L' : 'M'}${(x0 + i * dx).toFixed(1)} ${Math.max(1, Math.min(h - 1, y)).toFixed(1)}`
  }
  return d
}

/** Live scrolling ECG (last `seconds` s) drawn from the ring buffer at ~20 fps. */
export function EcgLive({ bus, height = 150, seconds = 5, color }: { bus: EcgBus; height?: number; seconds?: number; color: string }) {
  const { theme: t } = useApp()
  const [w, setW] = useState(0)
  const [d, setD] = useState('')
  const pending = useRef(false)

  useEffect(() => {
    if (!w) return
    const draw = () => {
      pending.current = false
      const xs = bus.last(seconds * ECG_FS)
      const n = seconds * ECG_FS
      const dx = w / (n - 1)
      setD(pathOf(xs, w, height, 2.2, w - (xs.length - 1) * dx, dx))
    }
    draw()
    const un = bus.subscribe(() => {
      if (pending.current) return
      pending.current = true
      setTimeout(draw, 40)
    })
    return un
  }, [bus, w, height, seconds])

  const mm = w / (seconds * 25)            // 25 mm/s paper speed
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height, borderRadius: 16, overflow: 'hidden', backgroundColor: t.paper }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <Defs>
            <Pattern id="minor" width={mm} height={mm} patternUnits="userSpaceOnUse">
              <Path d={`M ${mm} 0 L 0 0 0 ${mm}`} stroke={t.gridMinor} strokeWidth={0.6} fill="none" />
            </Pattern>
            <Pattern id="major" width={mm * 5} height={mm * 5} patternUnits="userSpaceOnUse">
              <Rect width={mm * 5} height={mm * 5} fill="url(#minor)" />
              <Path d={`M ${mm * 5} 0 L 0 0 0 ${mm * 5}`} stroke={t.gridMajor} strokeWidth={1} fill="none" />
            </Pattern>
            <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={t.paper} stopOpacity={1} />
              <Stop offset="0.12" stopColor={t.paper} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={w} height={height} fill="url(#major)" />
          {d ? <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
          <Rect width={w} height={height} fill="url(#fade)" />
        </Svg>
      )}
    </View>
  )
}

/** A stored strip on ECG paper, 25 mm/s, horizontally scrollable. */
export function EcgStatic({ samples, fs, color, height = 150, pxPerMm = 3.2 }: { samples: number[]; fs: number; color: string; height?: number; pxPerMm?: number }) {
  const { theme: t } = useApp()
  const w = (samples.length / fs) * 25 * pxPerMm
  const d = useMemo(() => pathOf(samples, w, height, 2.4), [samples, w, height])
  const mm = pxPerMm
  const secs = Math.floor(samples.length / fs)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderRadius: 16, backgroundColor: t.paper }}>
      <Svg width={w} height={height}>
        <Defs>
          <Pattern id="sminor" width={mm} height={mm} patternUnits="userSpaceOnUse">
            <Path d={`M ${mm} 0 L 0 0 0 ${mm}`} stroke={t.gridMinor} strokeWidth={0.6} fill="none" />
          </Pattern>
          <Pattern id="smajor" width={mm * 5} height={mm * 5} patternUnits="userSpaceOnUse">
            <Rect width={mm * 5} height={mm * 5} fill="url(#sminor)" />
            <Path d={`M ${mm * 5} 0 L 0 0 0 ${mm * 5}`} stroke={t.gridMajor} strokeWidth={1} fill="none" />
          </Pattern>
        </Defs>
        <Rect width={w} height={height} fill="url(#smajor)" />
        {Array.from({ length: secs }, (_, i) => <Line key={i} x1={i * 25 * mm} x2={i * 25 * mm} y1={0} y2={8} stroke={t.ink3} strokeWidth={1} />)}
        <Path d={d} stroke={color} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
      </Svg>
    </ScrollView>
  )
}
