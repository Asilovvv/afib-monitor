import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { EcgLive } from '../components/Ecg'
import { Battery, Button, Card, Icon, Pill, Ring, Row, Stat, T } from '../components/ui'
import { RhythmState } from '../protocol'
import { useApp } from '../store'
import { F, stateTone } from '../theme'
import { DeviceSheet } from './DeviceSheet'
import { SymptomSheet } from './SymptomSheet'

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i) }, [ms])
  return now
}

export const fmtDur = (t: (k: string) => string, sec: number) =>
  sec < 60 ? `${Math.round(sec)} ${t('s')}` : sec < 3600 ? `${Math.round(sec / 60)} ${t('min')}`
    : `${Math.floor(sec / 3600)} ${t('h')} ${Math.round((sec % 3600) / 60)} ${t('min')}`

export function callSos(t: (k: string) => string) {
  const go = () => Linking.openURL('tel:103').catch(() => undefined)
  if (Platform.OS === 'web') { go(); return }
  Alert.alert(t('sos_title'), t('sos_text'), [{ text: t('cancel'), style: 'cancel' }, { text: t('call'), style: 'destructive', onPress: go }])
}

function BeatingHeart({ bpm, color, size = 54 }: { bpm: number; color: string; size?: number }) {
  const s = useRef(new Animated.Value(1)).current
  const period = bpm > 25 ? 60000 / bpm : 1000
  const step = Math.round(period / 50) * 50
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(s, { toValue: 1.16, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(s, { toValue: 0.98, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(s, { toValue: 1.06, duration: 90, useNativeDriver: true }),
      Animated.timing(s, { toValue: 1, duration: Math.max(120, step - 340), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [s, step])
  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 20.5s-7.5-4.6-9.3-9.4C1.6 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.6 3.5 4.5 6.6-1.8 4.8-9.3 9.4-9.3 9.4z" fill={color} />
        <Path d="M5.2 11.2h3l1.4-2.6 2.2 5 1.5-3.2 0.9 0.8h4.3" stroke="#fff" strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  )
}

function Halo({ color }: { color: string }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const l = Animated.loop(Animated.timing(a, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    l.start(); return () => l.stop()
  }, [a])
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 999, borderWidth: 2, borderColor: color,
    opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.25] }) }] }]} />
}

export default function Monitor({ go }: { go: (tab: 'diary') => void }) {
  const { theme: tm, t, user, source, link, status, battery, ecg, episodes, history, startDevice, startSimulator,
    recording, recordEcg, lang } = useApp()
  const now = useNow()
  const [devOpen, setDevOpen] = useState(false)
  const [symOpen, setSymOpen] = useState(false)
  const stale = !!status && now - status.at > 15000
  const tone = stateTone(tm, stale ? RhythmState.NoSignal : status?.state)
  const busy = link.state === 'scanning' || link.state === 'connecting'
  const first = user?.name.split(' ')[0]

  const today = useMemo(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0)
    const eps = episodes.filter(e => e.end >= d0.getTime())
    const h = history.filter(s => s.at >= d0.getTime() && (s.state === 1 || s.state === 2))
    const af = h.filter(s => s.state === 2).length
    return { eps: eps.length, burden: h.length ? af / h.length : 0, minutes: h.length ? (h[h.length - 1].at - h[0].at) / 60000 : 0 }
  }, [episodes, history])

  const dateStr = new Date(now).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        <Row style={{ justifyContent: 'space-between', minHeight: 34 }}>
          <T v="small" style={{ textTransform: 'capitalize', flex: 1 }}>{dateStr}</T>
          {source !== 'none' && (
            <Pressable onPress={() => setDevOpen(true)} style={[s.chip, { backgroundColor: tm.card, borderColor: tm.line }]}>
              <Icon name="bt" size={16} color={link.state === 'connected' ? tm.accent : tm.ink3} />
              <Battery level={battery} color={tm.ink3} />
              <T v="mono" c={tm.ink2}>{battery != null ? `${battery}%` : '—'}</T>
            </Pressable>
          )}
        </Row>
        <T v="h1" style={{ marginBottom: 18 }}>{first ? `${t('hello')}, ${first}` : 'AFib Monitor'}</T>

        {source === 'none' ? (
          <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
            <View style={[s.connectArt, { backgroundColor: tm.afSoft }]}>
              <BeatingHeart bpm={66} color={tm.af} size={64} />
            </View>
            <T v="h2" style={{ textAlign: 'center', marginTop: 18 }}>{t('connect_title')}</T>
            <T v="small" style={{ textAlign: 'center', marginTop: 8, marginBottom: 20, lineHeight: 20 }}>{t('connect_text')}</T>
            <Button title={t('connect_device')} icon="bt" onPress={startDevice} style={{ alignSelf: 'stretch' }} />
            <Button title={t('demo_mode')} kind="ghost" icon="wave" onPress={startSimulator} style={{ alignSelf: 'stretch', marginTop: 10 }} />
            {link.state === 'error' && <T v="small" c={tm.af} style={{ marginTop: 12 }}>{t(link.detail ?? 'error')}</T>}
          </Card>
        ) : (
          <>
            {/* hero */}
            <Card style={[s.hero, { backgroundColor: tone.soft, borderColor: 'transparent' }]}>
              {busy ? (
                <View style={{ alignItems: 'center', gap: 14, paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color={tm.ink} />
                  <T v="h3">{t(link.detail ?? link.state)}</T>
                </View>
              ) : (
                <>
                  <View style={s.ringWrap}>
                    {status?.state === RhythmState.AFib && !stale && <Halo color={tm.af} />}
                    <Ring size={220} stroke={12} progress={status?.state === RhythmState.Collecting ? ((now / 40) % 100) / 100 : status?.prob ?? 0}
                      color={tone.fg} track={tm.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)'} />
                    <BeatingHeart bpm={status?.bpm || 60} color={tone.fg} size={40} />
                    <T style={s.bpm}>{status && status.bpm > 0 && !stale ? Math.round(status.bpm) : '—'}</T>
                    <T v="label">{t('bpm')}</T>
                  </View>
                  <T v="h2" c={tone.fg} style={{ textAlign: 'center', marginTop: 16 }}>
                    {status ? t(stale ? 'stale' : tone.key) : t('waiting')}
                  </T>
                  <T v="small" style={{ textAlign: 'center', marginTop: 4, paddingHorizontal: 10 }}>
                    {status && !stale ? t(`${tone.key}_sub`) : t('st_nosignal_sub')}
                  </T>
                  {status && status.state !== RhythmState.Collecting && !stale && (
                    <Row style={{ justifyContent: 'center', marginTop: 12 }}>
                      <Pill text={`${Math.round(status.prob * 100)}% · ${t('confidence')}`} fg={tm.ink2} bg={tm.dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.7)'} dot={false} />
                    </Row>
                  )}
                </>
              )}
            </Card>

            {/* live ECG */}
            <Card style={{ marginTop: 14, padding: 14 }}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 4 }}>
                <Row gap={8}>
                  <View style={[s.live, { backgroundColor: link.state === 'connected' ? tm.af : tm.ink3 }]} />
                  <T v="h3">{t('live_ecg')}</T>
                </Row>
                <T v="mono">25 mm/s · 125 Hz</T>
              </Row>
              <EcgLive bus={ecg} color={status?.state === RhythmState.AFib ? tm.af : tm.trace} />
              <Pressable onPress={recordEcg} disabled={recording !== null}
                style={({ pressed }) => [s.rec, { backgroundColor: tm.bg2, opacity: pressed ? 0.8 : 1 }]}>
                {recording !== null && <View style={[s.recFill, { backgroundColor: tm.afSoft, width: `${recording * 100}%` }]} />}
                <Icon name="rec" color={tm.af} fill={recording !== null ? tm.af : 'none'} size={18} />
                <T v="h3" style={{ fontSize: 14.5 }}>{recording !== null ? `${t('recording')} ${Math.round(recording * 10)}/10 ${t('s')}` : `${t('record_ecg')} · 10 ${t('s')}`}</T>
              </Pressable>
            </Card>

            {/* today */}
            <Card style={{ marginTop: 14 }}>
              <T v="label" style={{ marginBottom: 12 }}>{t('today')}</T>
              <Row gap={14}>
                <Stat label={t('episodes')} value={String(today.eps)} color={today.eps ? tm.af : undefined} />
                <Stat label={t('burden')} value={`${(today.burden * 100).toFixed(today.burden < 0.1 ? 1 : 0)}%`} />
                <Stat label={t('monitored')} value={fmtDur(t, today.minutes * 60)} />
              </Row>
            </Card>
          </>
        )}

        {/* quick actions */}
        <Row style={{ marginTop: 14 }} gap={12}>
          <Card style={{ flex: 1, padding: 16 }} onPress={() => setSymOpen(true)}>
            <View style={[s.qIco, { backgroundColor: tm.accentSoft }]}><Icon name="book" color={tm.accent} /></View>
            <T v="h3" style={{ marginTop: 12 }}>{t('add_symptom')}</T>
            <T v="small">{t('how_feel')}</T>
          </Card>
          <Card style={{ flex: 1, padding: 16 }} tone={tm.af} onPress={() => callSos(t)}>
            <View style={[s.qIco, { backgroundColor: 'rgba(255,255,255,.18)' }]}><Icon name="phone" color="#fff" /></View>
            <T v="h3" c="#fff" style={{ marginTop: 12, fontFamily: F.displayBold, letterSpacing: 1 }}>SOS · 103</T>
            <T v="small" c="rgba(255,255,255,.8)">{t('sos_title')}</T>
          </Card>
        </Row>
        {user?.doctor?.phone && (
          <Button title={`${t('call_doctor')} · ${user.doctor.name}`} kind="ghost" icon="stetho" style={{ marginTop: 12 }}
            onPress={() => Linking.openURL(`tel:${user.doctor!.phone!.replace(/\s/g, '')}`).catch(() => undefined)} />
        )}
      </ScrollView>
      <DeviceSheet open={devOpen} onClose={() => setDevOpen(false)} />
      <SymptomSheet open={symOpen} onClose={() => setSymOpen(false)} onSaved={() => go('diary')} />
    </View>
  )
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
  connectArt: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: 26 },
  ringWrap: { width: 220, height: 220, borderRadius: 110, alignItems: 'center', justifyContent: 'center' },
  bpm: { fontFamily: F.displayBold, fontSize: 64, letterSpacing: -3, lineHeight: 72, marginTop: 2 },
  live: { width: 8, height: 8, borderRadius: 4 },
  rec: { marginTop: 12, height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden' },
  recFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  qIco: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
})
