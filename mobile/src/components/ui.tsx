import { useEffect, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useApp } from '../store'
import { F, type Theme } from '../theme'

// ---------------------------------------------------------------- icons (24×24 stroke icons)
const P: Record<string, string> = {
  heart: 'M12 20.5s-7.5-4.6-9.3-9.4C1.6 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.6 3.5 4.5 6.6-1.8 4.8-9.3 9.4-9.3 9.4z',
  pulse: 'M2 12h4l2.5-6 4 13 3-9 1.5 2H22',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 10.5h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5',
  bt: 'M7 7l10 10-5 4.5V2.5L17 7 7 17',
  phone: 'M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chev: 'M9 6l6 6-6 6',
  rec: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  cpu: 'M8 8h8v8H8zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M5 5h14v14H5z',
  signal: 'M4 19v-3M9 19v-7M14 19V8M19 19V4',
  sync: 'M20 11a8 8 0 0 0-14.3-4.8L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.8L20 16M20 20v-4h-4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  stetho: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2M20 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  wave: 'M2 12c2 0 2-5 4-5s2 10 4 10 2-10 4-10 2 10 4 10 2-5 4-5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  send: 'M21.5 3.5L2.8 10.7c-.9.4-.9 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.5c.7.5 1.7.1 1.9-.7l3-15.4c.2-.9-.7-1.6-1.6-1.2zM7.5 14l9-6.5-6.5 8',
  sos: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
}
export type IconName = keyof typeof P
export function Icon({ name, size = 22, color, fill, width = 1.8 }: { name: IconName; size?: number; color: string; fill?: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={P[name]} stroke={color} strokeWidth={width} fill={fill ?? 'none'} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

// ---------------------------------------------------------------- text
type TV = 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'label' | 'num' | 'mono'
const TS: Record<TV, TextStyle> = {
  h1: { fontFamily: F.displayBold, fontSize: 28, letterSpacing: -0.8, lineHeight: 34 },
  h2: { fontFamily: F.display, fontSize: 19, letterSpacing: -0.4, lineHeight: 25 },
  h3: { fontFamily: F.semi, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: F.medium, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  num: { fontFamily: F.display, fontSize: 24, letterSpacing: -0.6 },
  mono: { fontFamily: F.mono, fontSize: 12.5 },
}
export function T({ v = 'body', c, style, children, lines }: { v?: TV; c?: string; style?: StyleProp<TextStyle>; children: ReactNode; lines?: number }) {
  const { theme, big } = useApp()
  const color = c ?? (v === 'small' || v === 'label' || v === 'mono' ? theme.ink3 : theme.ink)
  const base = StyleSheet.flatten([TS[v], { color }, style])
  // large mode: everything 25 % bigger, the smallest text a little more (it is what older eyes miss first)
  const k = big ? (v === 'small' || v === 'label' || v === 'mono' ? 1.35 : 1.25) : 1
  const scaled = k === 1 ? base : { ...base, fontSize: (base.fontSize ?? 15) * k, lineHeight: base.lineHeight ? base.lineHeight * k : undefined }
  return <Text numberOfLines={lines} style={scaled}>{children}</Text>
}

// ---------------------------------------------------------------- containers
export function Card({ children, style, onPress, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: string }) {
  const { theme } = useApp()
  const s = [st.card, { backgroundColor: tone ?? theme.card, borderColor: theme.line }, theme.dark ? null : st.shadow, style]
  if (!onPress) return <View style={s}>{children}</View>
  return <Pressable onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}>{children}</Pressable>
}

export function Row({ children, style, gap = 10 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, loading, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'soft'; icon?: IconName
  disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>
}) {
  const { theme: t } = useApp()
  const bg = kind === 'primary' ? t.ink : kind === 'danger' ? t.af : kind === 'soft' ? t.bg2 : 'transparent'
  const fg = kind === 'primary' ? t.primaryText : kind === 'danger' ? '#fff' : t.ink
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button"
      style={({ pressed }) => [st.btn, { backgroundColor: bg, borderColor: t.line, borderWidth: kind === 'ghost' ? 1 : 0, opacity: disabled ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <Row gap={8}>
          {icon && <Icon name={icon} color={fg} size={18} />}
          <Text style={{ color: fg, fontFamily: F.semi, fontSize: 15.5 }}>{title}</Text>
        </Row>
      )}
    </Pressable>
  )
}

export function Pill({ text, fg, bg, dot = true }: { text: string; fg: string; bg: string; dot?: boolean }) {
  return (
    <View style={[st.pill, { backgroundColor: bg }]}>
      {dot && <View style={[st.dot, { backgroundColor: fg }]} />}
      <Text style={{ color: fg, fontFamily: F.semi, fontSize: 12.5 }}>{text}</Text>
    </View>
  )
}

export function Seg<V extends string | number>({ value, onChange, items }: { value: V; onChange: (v: V) => void; items: [V, string][] }) {
  const { theme: t } = useApp()
  return (
    <View style={[st.seg, { backgroundColor: t.bg2 }]}>
      {items.map(([v, l]) => (
        <Pressable key={String(v)} onPress={() => onChange(v)} style={[st.segBtn, v === value && { backgroundColor: t.card }, v === value && !t.dark && st.shadow]}>
          <Text style={{ fontFamily: v === value ? F.semi : F.medium, fontSize: 13.5, color: v === value ? t.ink : t.ink3 }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <T v="label">{label}</T>
      <T v="num" c={color} style={value.length > 7 ? { fontSize: 18 } : null}>{value}</T>
      {sub ? <T v="small">{sub}</T> : null}
    </View>
  )
}

export function Battery({ level, color }: { level: number | null; color: string }) {
  const { theme: t } = useApp()
  const l = level ?? 0
  const fill = l < 20 ? t.af : l < 40 ? t.warn : t.ok
  return (
    <Svg width={26} height={13} viewBox="0 0 26 13">
      <Rect x={0.75} y={0.75} width={21.5} height={11.5} rx={3} stroke={color} strokeWidth={1.5} fill="none" />
      <Rect x={23.3} y={4} width={2} height={5} rx={1} fill={color} />
      {level != null && <Rect x={2.6} y={2.6} width={Math.max(1, 17.8 * l / 100)} height={7.8} rx={1.6} fill={fill} />}
    </Svg>
  )
}

export function Ring({ size, stroke, progress, color, track }: { size: number; stroke: number; progress: number; color: string; track: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0.001, Math.min(1, progress))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
  )
}

// ---------------------------------------------------------------- sheet (bottom modal)
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { theme: t } = useApp()
  const ins = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.sheetBack} onPress={onClose} />
      <View style={[st.sheet, { backgroundColor: t.card, paddingBottom: ins.bottom + 16 }]}>
        <View style={[st.grab, { backgroundColor: t.line }]} />
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <T v="h2">{title}</T>
          <Pressable onPress={onClose} hitSlop={12} style={[st.iconBtn, { backgroundColor: t.bg2 }]}><Icon name="x" color={t.ink2} size={18} /></Pressable>
        </Row>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>{children}</ScrollView>
      </View>
    </Modal>
  )
}

// ---------------------------------------------------------------- toasts
export function Toasts() {
  const { toasts, theme: t } = useApp()
  const ins = useSafeAreaInsets()
  return (
    <View pointerEvents="none" style={[st.toasts, { top: ins.top + 8 }]}>
      {toasts.map(x => <ToastView key={x.id} text={x.text} bg={x.tone === 'af' ? t.af : x.tone === 'ok' ? t.ink : t.ink} icon={x.tone === 'af' ? 'heart' : 'check'} fg={x.tone === 'af' ? '#fff' : t.primaryText} />)}
    </View>
  )
}
function ToastView({ text, bg, fg, icon }: { text: string; bg: string; fg: string; icon: IconName }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, friction: 7 }).start() }, [a])
  return (
    <Animated.View style={[st.toast, { backgroundColor: bg, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
      <Icon name={icon} color={fg} size={18} />
      <Text style={{ color: fg, fontFamily: F.medium, fontSize: 14, flex: 1 }}>{text}</Text>
    </Animated.View>
  )
}

export function Empty({ icon, text }: { icon: IconName; text: string }) {
  const { theme: t } = useApp()
  return (
    <View style={{ alignItems: 'center', paddingVertical: 26, gap: 10 }}>
      <View style={[st.emptyIco, { backgroundColor: t.bg2 }]}><Icon name={icon} color={t.ink3} /></View>
      <T v="small" style={{ textAlign: 'center' }}>{text}</T>
    </View>
  )
}

export const st = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  shadow: { shadowColor: '#2a2010', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  btn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  seg: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 2 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  sheetBack: { flex: 1, backgroundColor: 'rgba(8,8,12,.5)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, maxHeight: '88%' },
  grab: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  toasts: { position: 'absolute', left: 16, right: 16, gap: 8, zIndex: 100 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13 },
  emptyIco: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})
