import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg'
import { api, type Vital, type VitalKind, type VitalsSummary } from '../api'
import { fmtDate } from '../i18n'
import { Button, Card, Icon, Row, Sheet, T } from '../components/ui'
import { useApp } from '../store'
import { F } from '../theme'
import { readCuffFromCamera } from '../cuffphoto'

/** Values the patient types in from home devices (cuff, glucose meter, scales). Nothing here is measured by our
 *  hardware, and every screen says so: "you entered". Plausibility limits mirror the server (VitalIn). */
const LIMITS = { sys: [60, 260], dia: [30, 160], pulse: [20, 250], glucose: [1, 40], weight: [20, 300] } as const
const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null }
const inRange = (v: number | null, r: readonly [number, number]) => v != null && v >= r[0] && v <= r[1]

export function VitalsCard({ big = false }: { big?: boolean }) {
  const { theme: tm, t, user, dataVersion, lang } = useApp()
  const [data, setData] = useState<VitalsSummary | null>(null)
  const [open, setOpen] = useState<VitalKind | null>(null)
  const load = useCallback(async () => {
    if (!user) return
    try { setData(await api.vitals(14)) } catch { /* offline: keep what we had */ }
  }, [user])
  useEffect(() => { load() }, [load, dataVersion])
  if (!user) return null
  const bp = data?.bp
  const when = (iso: string) => fmtDate(lang, iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Row gap={8}><T style={{ fontSize: 20 }}>🩺</T><T v="h3">{t('vit_title')}</T></Row>
        </Row>
        <T v="small" style={{ marginBottom: 10 }}>{t('vit_sub')}</T>
        {bp ? (
          <>
            <Row style={{ alignItems: 'flex-end' }} gap={6}>
              <T v="num" style={{ fontSize: big ? 40 : 32 }}>{bp.last.systolic}/{bp.last.diastolic}</T>
              <T v="small" style={{ marginBottom: 6 }}>{t('vit_mmhg')}{bp.last.pulse ? ` · ${bp.last.pulse} ${t('bpm')}` : ''}</T>
            </Row>
            <T v="small">{t('vit_entered')} · {when(bp.last.ts)}</T>
            <BpChart items={data!.items.filter(v => v.kind === 'bp')} />
            <T v="small" style={{ marginTop: 4 }}>{t('vit_14d')}: {t('vit_mean')} {bp.sys_mean}/{bp.dia_mean}, {bp.n} {t('vit_entries')}</T>
          </>
        ) : <T v="small" c={tm.ink3}>{t('vit_none')}</T>}
        <Row gap={8} style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <Button title={t('vit_add_bp')} icon="plus" onPress={() => setOpen('bp')} style={{ width: '100%' }} />
          <Button title={t('vit_glucose')} kind="soft" onPress={() => setOpen('glucose')} style={{ flex: 1 }} />
          <Button title={t('vit_weight')} kind="soft" onPress={() => setOpen('weight')} style={{ flex: 1 }} />
        </Row>
        {(data?.glucose || data?.weight) && (
          <T v="small" style={{ marginTop: 10 }}>
            {data?.glucose ? `${t('vit_glucose')}: ${data.glucose.last.value} ${t('vit_mmol')} · ${when(data.glucose.last.ts)}` : ''}
            {data?.glucose && data?.weight ? '\n' : ''}
            {data?.weight ? `${t('vit_weight')}: ${data.weight.last.value} ${t('vit_kg')} · ${when(data.weight.last.ts)}` : ''}
          </T>
        )}
      </Card>
      <VitalSheet kind={open} onClose={() => { setOpen(null); load() }} last={data?.items ?? []} />
    </>
  )
}

/** Systolic and diastolic dots over the last 14 days; light band 90-140 / 60-90 is only a visual guide, not a diagnosis. */
function BpChart({ items }: { items: Vital[] }) {
  const { theme: tm } = useApp()
  const [w, setW] = useState(0)
  if (items.length < 2) return null
  const H = 110, pad = 26
  const t0 = Date.now() - 14 * 86400e3, t1 = Date.now()
  const lo = 40, hi = 200
  const x = (iso: string) => pad + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (w - pad - 6)
  const y = (v: number) => 6 + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 20)
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: H, marginTop: 8 }}>
      {w > 0 && (
        <Svg width={w} height={H}>
          {[60, 90, 120, 140, 180].map(v => (
            <SvgText key={v} x={pad - 4} y={y(v) + 3} fontSize={9} fill={tm.ink3} textAnchor="end" fontFamily={F.mono}>{v}</SvgText>
          ))}
          {[90, 140].map(v => <Line key={v} x1={pad} x2={w} y1={y(v)} y2={y(v)} stroke={tm.line} strokeDasharray="3 4" />)}
          {items.map(v => (
            <Line key={'l' + v.id} x1={x(v.ts)} x2={x(v.ts)} y1={y(v.systolic!)} y2={y(v.diastolic!)} stroke={tm.ink3} strokeWidth={1} />
          ))}
          {items.map(v => (<Circle key={'s' + v.id} cx={x(v.ts)} cy={y(v.systolic!)} r={3.5} fill={tm.accent} />))}
          {items.map(v => (<Circle key={'d' + v.id} cx={x(v.ts)} cy={y(v.diastolic!)} r={3.5} fill={tm.ink2} />))}
        </Svg>
      )}
    </View>
  )
}

function VitalSheet({ kind, onClose, last }: { kind: VitalKind | null; onClose: () => void; last: Vital[] }) {
  const { theme: tm, t, toast, lang, user, openPlan } = useApp()
  const [sys, setSys] = useState(''); const [dia, setDia] = useState(''); const [pulse, setPulse] = useState('')
  const [value, setValue] = useState(''); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [shooting, setShooting] = useState(false)
  const [src, setSrc] = useState<'manual' | 'photo'>('manual')
  useEffect(() => { if (kind) { setSys(''); setDia(''); setPulse(''); setValue(''); setNote(''); setSrc('manual') } }, [kind])
  const input = [s.input, { borderColor: tm.line, color: tm.ink, backgroundColor: tm.bg2 }]
  const title = kind === 'bp' ? t('vit_bp') : kind === 'glucose' ? t('vit_glucose') : t('vit_weight')
  const recent = last.filter(v => v.kind === kind).slice(-5).reverse()

  const save = async () => {
    if (!kind) return
    const body: Parameters<typeof api.addVital>[0] = { kind }
    if (kind === 'bp') {
      const a = num(sys), b = num(dia), p = num(pulse)
      if (!inRange(a, LIMITS.sys) || !inRange(b, LIMITS.dia) || (pulse.trim() && !inRange(p, LIMITS.pulse))) { toast(t('vit_bad'), 'info'); return }
      if (a! <= b!) { toast(t('vit_bad_order'), 'info'); return }
      body.systolic = Math.round(a!); body.diastolic = Math.round(b!); if (p != null) body.pulse = Math.round(p)
    } else {
      const v = num(value)
      if (!inRange(v, LIMITS[kind])) { toast(t('vit_bad'), 'info'); return }
      body.value = v!
    }
    if (note.trim()) body.note = note.trim()
    if (kind === 'bp' && src === 'photo') body.source = 'photo'
    setBusy(true)
    try { await api.addVital(body); toast(t('vit_saved'), 'ok'); onClose() } catch { toast(t('day_offline'), 'info') }
    setBusy(false)
  }
  /** Camera → on-device OCR → fields. Never saves by itself; empty fields when unsure. */
  const shoot = async () => {
    if (user?.plan !== 'family') { openPlan('cuff_photo'); return }
    setShooting(true)
    const r = await readCuffFromCamera()
    setShooting(false)
    if (r === 'unavailable') { toast(t('vit_photo_na'), 'info'); return }
    if (r === 'denied') { toast(t('vit_photo_denied'), 'info'); return }
    if (r === 'cancelled') return
    if (r.confidence === 'none') { toast(t('vit_photo_none'), 'info'); return }
    setSys(r.systolic != null ? String(r.systolic) : ''); setDia(r.diastolic != null ? String(r.diastolic) : ''); setPulse(r.pulse != null ? String(r.pulse) : '')
    setSrc('photo')
    toast(t(r.confidence === 'high' ? 'vit_photo_ok' : 'vit_photo_low'), r.confidence === 'high' ? 'ok' : 'info')
  }
  const remove = (v: Vital) => {
    const go = async () => { try { await api.deleteVital(v.id); onClose() } catch { toast(t('day_offline'), 'info') } }
    if (Platform.OS === 'web') { go(); return }
    Alert.alert(t('vit_delete'), '', [{ text: t('cancel'), style: 'cancel' }, { text: t('vit_delete'), style: 'destructive', onPress: go }])
  }
  const fmt = (v: Vital) => v.kind === 'bp' ? `${v.systolic}/${v.diastolic}${v.pulse ? ` · ${v.pulse}` : ''}` : `${v.value} ${v.kind === 'glucose' ? t('vit_mmol') : t('vit_kg')}`
  return (
    <Sheet open={!!kind} onClose={onClose} title={title}>
      <T v="small" style={{ marginBottom: 12 }}>{t('vit_sub')}</T>
      {kind === 'bp' ? (
        <Row gap={10}>
          <View style={{ flex: 1 }}><T v="label">{t('vit_sys')}</T>
            <TextInput value={sys} onChangeText={setSys} keyboardType="number-pad" placeholder="120" placeholderTextColor={tm.ink3} style={[input, s.big]} autoFocus /></View>
          <View style={{ flex: 1 }}><T v="label">{t('vit_dia')}</T>
            <TextInput value={dia} onChangeText={setDia} keyboardType="number-pad" placeholder="80" placeholderTextColor={tm.ink3} style={[input, s.big]} /></View>
          <View style={{ flex: 1 }}><T v="label">{t('vit_pulse')}</T>
            <TextInput value={pulse} onChangeText={setPulse} keyboardType="number-pad" placeholder="70" placeholderTextColor={tm.ink3} style={[input, s.big]} /></View>
        </Row>
      ) : (
        <View><T v="label">{title} · {kind === 'glucose' ? t('vit_mmol') : t('vit_kg')}</T>
          <TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={kind === 'glucose' ? '5.6' : '80'} placeholderTextColor={tm.ink3} style={[input, s.big]} autoFocus /></View>
      )}
      {kind === 'bp' && Platform.OS !== 'web' && (
        <View style={{ marginTop: 10 }}>
          <Button title={t('vit_photo')} kind="soft" icon="camera" onPress={shoot} loading={shooting} />
          <T v="small" c={tm.ink3} style={{ marginTop: 6, lineHeight: 18 }}>{t('vit_photo_hint')}</T>
        </View>
      )}
      <TextInput value={note} onChangeText={setNote} placeholder={t('vit_note')} placeholderTextColor={tm.ink3} style={[input, { marginTop: 10 }]} />
      <Button title={t('vit_save')} icon="check" onPress={save} loading={busy} style={{ marginTop: 14 }} />
      {recent.length > 0 && (
        <View style={{ marginTop: 16, gap: 6 }}>
          <T v="label">{t('vit_last')}</T>
          {recent.map(v => (
            <Row key={v.id} style={{ justifyContent: 'space-between' }}>
              <T v="small">{fmtDate(lang, v.ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</T>
              <Row gap={10}><T v="mono">{fmt(v)}</T>
                <Pressable onPress={() => remove(v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t('vit_delete')} ${fmt(v)}`}><Icon name="x" size={16} color={tm.ink3} /></Pressable></Row>
            </Row>
          ))}
        </View>
      )}
    </Sheet>
  )
}

const s = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, fontFamily: F.body, fontSize: 16 },
  big: { fontSize: 24, textAlign: 'center', fontFamily: F.displayBold },
})
