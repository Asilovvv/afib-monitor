import { nextLang } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import {
  Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View,
  type NativeScrollEvent, type NativeSyntheticEvent, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { api, settings } from '../api'
import { Button, Icon, Row, Seg, T } from '../components/ui'
import { useApp } from '../store'
import { F, type Theme } from '../theme'

// ---------------------------------------------------------------- illustrations
function Art({ i, t }: { i: number; t: Theme }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const l = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }))
    l.start(); return () => l.stop()
  }, [a])
  const scale = a.interpolate({ inputRange: [0, 0.15, 0.3, 1], outputRange: [1, 1.08, 1, 1] })
  const W = 280
  return (
    <View style={{ width: W, height: W, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[s.blob, { backgroundColor: i === 0 ? t.afSoft : i === 1 ? t.accentSoft : t.okSoft }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        {i === 0 && (
          <Svg width={210} height={210} viewBox="0 0 210 210">
            <Circle cx={105} cy={105} r={88} stroke={t.af} strokeOpacity={0.25} strokeWidth={10} fill="none" />
            <Circle cx={105} cy={105} r={88} stroke={t.af} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray="420 600" transform="rotate(-90 105 105)" />
            <Path d="M105 150s-38-23-47-47c-5.6-15.6 4.4-33 22.4-33 10 0 18 5.5 24.6 14 6.6-8.5 14.6-14 24.6-14 18 0 28 17.4 22.4 33-9 24-47 47-47 47z" fill={t.af} />
            <Path d="M66 104h16l7-13 11 25 8-16 5 4h31" stroke="#fff" strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
        {i === 1 && (
          <Svg width={210} height={210} viewBox="0 0 210 210">
            <Rect x={62} y={20} width={86} height={170} rx={18} fill={t.ink} />
            <Rect x={69} y={34} width={72} height={142} rx={10} fill={t.card} />
            <Rect x={76} y={46} width={58} height={36} rx={8} fill={t.af} />
            <Path d="M84 64h8l4-8 6 15 4-9 3 2h11" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={76} y={90} width={58} height={8} rx={4} fill={t.line} />
            <Rect x={76} y={104} width={40} height={8} rx={4} fill={t.line} />
            <Path d="M76 150c6 0 6-14 12-14s6 22 12 22 6-22 12-22 6 14 12 14" stroke={t.accent} strokeWidth={3} fill="none" strokeLinecap="round" />
            <Circle cx={158} cy={44} r={20} fill={t.accent} />
            <Path d="M151 44a7 7 0 0 1 14 0v5l3 4h-20l3-4zM155 56a3 3 0 0 0 6 0" stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
        {i === 2 && (
          <Svg width={210} height={210} viewBox="0 0 210 210">
            <Rect x={20} y={40} width={170} height={118} rx={14} fill={t.card} stroke={t.line} strokeWidth={2} />
            <Rect x={20} y={40} width={44} height={118} rx={14} fill={t.bg2} />
            <Rect x={76} y={56} width={60} height={9} rx={4} fill={t.ink} />
            <Rect x={76} y={74} width={34} height={22} rx={6} fill={t.okSoft} />
            <Rect x={116} y={74} width={34} height={22} rx={6} fill={t.afSoft} />
            <Path d="M76 128h14l6-12 9 22 7-14 4 4h56" stroke={t.af} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={88} y={164} width={34} height={14} rx={3} fill={t.line} />
            <Circle cx={168} cy={150} r={24} fill={t.ok} />
            <Path d="M157 150l8 8 14-15" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
      </Animated.View>
    </View>
  )
}

export function Onboarding() {
  const { theme: tm, t, finishOnboarding, lang, setLang } = useApp()
  const { width } = useWindowDimensions()
  const [i, setI] = useState(0)
  const ref = useRef<ScrollView>(null)
  const slides = [['ob1_t', 'ob1_b'], ['ob2_t', 'ob2_b'], ['ob3_t', 'ob3_b']]
  const go = (n: number) => { ref.current?.scrollTo({ x: n * width, animated: true }); setI(n) }
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setI(Math.round(e.nativeEvent.contentOffset.x / width))

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tm.bg }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 }}>
        <Row gap={6}><Icon name="pulse" size={20} color={tm.af} /><T style={{ fontFamily: F.displayBold, fontSize: 16 }}>AFib<T c={tm.af} style={{ fontFamily: F.displayBold, fontSize: 16 }}>Monitor</T></T></Row>
        <Row gap={14}>
          <Pressable onPress={() => setLang(nextLang(lang))}><T v="mono" c={tm.ink2}>{nextLang(lang).toUpperCase()}</T></Pressable>
          <Pressable onPress={finishOnboarding}><T v="small" c={tm.ink2}>{t('skip')}</T></Pressable>
        </Row>
      </Row>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} scrollEventThrottle={16} style={{ flex: 1 }}>
        {slides.map(([h, b], k) => (
          <View key={k} style={{ width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
            <Art i={k} t={tm} />
            <T v="h1" style={{ textAlign: 'center', marginTop: 26, fontSize: 30 }}>{t(h)}</T>
            <T style={{ textAlign: 'center', marginTop: 12, color: tm.ink2, fontSize: 16, lineHeight: 24 }}>{t(b)}</T>
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 20, gap: 18 }}>
        <Row style={{ justifyContent: 'center' }} gap={6}>
          {slides.map((_, k) => <View key={k} style={{ height: 8, width: k === i ? 26 : 8, borderRadius: 4, backgroundColor: k === i ? tm.ink : tm.line }} />)}
        </Row>
        <Button title={i < 2 ? t('next') : t('start')} icon={i < 2 ? 'chev' : 'check'} onPress={() => (i < 2 ? go(i + 1) : finishOnboarding())} />
      </View>
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------- sign in / sign up
export function Auth({ onDone }: { onDone?: () => void }) {
  const { theme: tm, t, signIn, setOffline } = useApp()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [role, setRole] = useState<'patient' | 'family'>('patient')
  const [server, setServer] = useState(settings.server || (Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin.replace(':8081', ':8000') : 'https://afib-monitor.onrender.com'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [srv, setSrv] = useState<'ok' | 'bad' | 'wait' | null>(null)
  const [agree, setAgree] = useState(false)          // terms + data processing (required to sign up)
  const [research, setResearch] = useState(false)    // optional: de-identified data for research
  const openDoc = (path: string) => Linking.openURL((server || 'https://afib-monitor.onrender.com').replace(/\/+$/, '') + path).catch(() => undefined)

  const check = async () => {
    await settings.setServer(server)
    setSrv('wait')
    try { await api.health(); setSrv('ok') } catch { setSrv('bad') }
  }

  const submit = async () => {
    setBusy(true); setErr(''); setSrv('wait')
    try {
      await settings.setServer(server)
      const r = mode === 'in'
        ? await api.login(email.trim(), password)
        : role === 'family'
          ? await api.register({ role: 'family', email: email.trim(), password, name: name.trim(), family_code: code.trim() || undefined, consents: ['terms', 'data'] })
          : await api.register({ email: email.trim(), password, name: name.trim(), doctor_code: code.trim() || undefined, birth_year: Number(year) || undefined, consents: ['terms', 'data', ...(research ? ['research'] : [])] })
      setSrv('ok')
      await signIn(r.user, r.token)
      onDone?.()
    } catch (e) {
      const m = (e as Error).message
      setSrv(null)
      setErr(m === 'no_server' ? t('server_bad') : /abort|network|fetch/i.test(m) ? t('server_bad') : m === 'plan_required' ? t('pl_fam_full') : m === 'doctor_full' ? t('pl_doctor_full') : m)
    }
    setBusy(false)
  }

  const input = (v: string, set: (x: string) => void, ph: string, extra: object = {}) => (
    <TextInput value={v} onChangeText={set} placeholder={ph} placeholderTextColor={tm.ink3} autoCapitalize="none"
      style={[s.input, { color: tm.ink, backgroundColor: tm.card, borderColor: tm.line }]} {...extra} />
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tm.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={[s.logo, { backgroundColor: tm.af }]}><Icon name="pulse" size={30} color="#fff" width={2.4} /></View>
          <T v="h1" style={{ fontSize: 30, marginTop: 6 }}>{t('welcome')}</T>
          <Seg value={mode} onChange={setMode} items={[['in', t('signin')], ['up', t('signup')]]} />

          {mode === 'up' && (<>
            <T v="label">{t('fam_role_q')}</T>
            <Seg value={role} onChange={setRole} items={[['patient', t('fam_role_patient')], ['family', t('fam_role_family')]]} />
          </>)}
          {mode === 'up' && input(name, setName, t('name'), { autoCapitalize: 'words' })}
          {input(email, setEmail, t('email'), { keyboardType: 'email-address', autoComplete: 'email' })}
          {input(password, setPassword, t('password'), { secureTextEntry: true })}
          {mode === 'up' && role === 'patient' && (
            <Row gap={10}>
              <View style={{ flex: 1 }}>{input(year, setYear, t('birth_year'), { keyboardType: 'number-pad', maxLength: 4 })}</View>
              <View style={{ flex: 1.3 }}>{input(code, x => setCode(x.toUpperCase()), t('doctor_code'), { autoCapitalize: 'characters' })}</View>
            </Row>
          )}
          {mode === 'up' && role === 'family' && input(code, x => setCode(x.toUpperCase()), t('fam_code'), { autoCapitalize: 'characters', maxLength: 6 })}

          <T v="label" style={{ marginTop: 6 }}>{t('server')}</T>
          <Row gap={8}>
            <View style={{ flex: 1 }}>{input(server, x => { setServer(x); setSrv(null) }, 'http://…', { keyboardType: 'url' })}</View>
            <Button title={t('check')} kind="soft" onPress={check} loading={srv === 'wait'} />
          </Row>
          <T v="small" c={srv === 'ok' ? tm.ok : srv === 'bad' ? tm.af : undefined}>{srv === 'ok' ? `● ${t('server_ok')}` : srv === 'bad' ? `● ${t('server_bad')}` : srv === 'wait' ? t('server_waking') : t('server_hint')}</T>

          {mode === 'up' && (
            <View style={{ gap: 10, marginTop: 4 }}>
              <Check on={agree} onPress={() => setAgree(!agree)}>
                <T v="small">{t('consent_terms_a')} <T v="small" c={tm.accent} style={{ textDecorationLine: 'underline' }}>{t('consent_terms_link')}</T> {t('consent_terms_b')}</T>
              </Check>
              <Row gap={14} style={{ paddingLeft: 34 }}>
                <Pressable onPress={() => openDoc('/terms')}><T v="small" c={tm.accent}>{t('terms')}</T></Pressable>
                <Pressable onPress={() => openDoc('/privacy')}><T v="small" c={tm.accent}>{t('privacy')}</T></Pressable>
              </Row>
              {role === 'patient' && <Check on={research} onPress={() => setResearch(!research)}><T v="small">{t('consent_research')}</T></Check>}
            </View>
          )}

          {err ? <View style={[s.err, { backgroundColor: tm.afSoft }]}><T c={tm.afInk} v="small">{err}</T></View> : null}
          <Button title={mode === 'in' ? t('sign_in_btn') : t('sign_up_btn')} onPress={submit} loading={busy}
            disabled={!email || password.length < 6 || (mode === 'up' && (!name || !agree))} style={{ marginTop: 6 }} />

          {mode === 'in' && (
            <Pressable onPress={() => { setEmail('aibek@demo.kg'); setPassword('demo1234') }} style={[s.demo, { borderColor: tm.line }]}>
              <Icon name="user" size={16} color={tm.accent} />
              <T v="small" c={tm.accent}>{t('demo_login')}</T>
              <T v="mono">aibek@demo.kg · demo1234</T>
            </Pressable>
          )}
          <Button title={t('offline_mode')} kind="ghost" onPress={() => { setOffline(true); onDone?.() }} style={{ marginTop: 4 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  const { theme: tm } = useApp()
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[s.box, { borderColor: on ? tm.accent : tm.ink3, backgroundColor: on ? tm.accent : 'transparent' }]}>
        {on && <Icon name="check" size={14} color="#fff" width={2.4} />}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  )
}

const s = StyleSheet.create({
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  blob: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  logo: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  input: { height: 54, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontFamily: F.body, fontSize: 16 },
  err: { padding: 12, borderRadius: 12 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', flexWrap: 'wrap' },
})
