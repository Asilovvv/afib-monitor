import { locOf } from '../i18n'
import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View, Platform } from 'react-native'
import { api, researchGiven, settings, type Risk, type TgLink } from '../api'
import { Button, Card, Icon, Row, Seg, Sheet, T, type IconName } from '../components/ui'
import { useApp, type ThemePref } from '../store'
import { RelativesCard } from './Family'
import { F } from '../theme'
import { DeviceSheet } from './DeviceSheet'

function Item({ icon, title, sub, onPress, right }: { icon: IconName; title: string; sub?: string; onPress?: () => void; right?: React.ReactNode }) {
  const { theme: tm } = useApp()
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.item, { borderColor: tm.line, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[s.ico, { backgroundColor: tm.bg2 }]}><Icon name={icon} size={18} color={tm.ink2} /></View>
      <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{title}</T>{sub ? <T v="small">{sub}</T> : null}</View>
      {right ?? (onPress ? <Icon name="chev" size={18} color={tm.ink3} /> : null)}
    </Pressable>
  )
}

export default function Profile({ onSignIn, onBack }: { onSignIn: () => void; onBack?: () => void }) {
  const { theme: tm, t, user, setUser, signOut, lang, setLang, themePref, setThemePref, toast, source, big, setBig } = useApp()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [dev, setDev] = useState(false)
  const initials = user?.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const age = user?.birth_year ? new Date().getFullYear() - user.birth_year : null

  const link = async () => {
    setBusy(true)
    try { setUser(await api.linkDoctor(code)); setCode(''); toast(t('doctor_linked'), 'ok') }
    catch (e) { toast((e as Error).message, 'af') }
    setBusy(false)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>
      <Row gap={10}>{onBack && <Pressable onPress={onBack} hitSlop={10} style={{ transform: [{ rotate: '180deg' }] }}><Icon name="chev" color={tm.ink2} /></Pressable>}<T v="h1">{t('profile')}</T></Row>

      {user ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={[s.avatar, { backgroundColor: tm.accentSoft }]}><T style={{ fontFamily: F.displayBold, fontSize: 20 }} c={tm.accent}>{initials}</T></View>
          <View style={{ flex: 1 }}>
            <T v="h2">{user.name}</T>
            <T v="small">{[age ? `${age} ${t('years')}` : null, user.email].filter(Boolean).join(' · ')}</T>
          </View>
        </Card>
      ) : (
        <Card>
          <T v="h3">{t('not_signed')}</T>
          <Button title={t('sign_in_cta')} onPress={onSignIn} style={{ marginTop: 12 }} />
        </Card>
      )}

      {user && user.role === 'patient' && (
        <Card>
          <T v="label" style={{ marginBottom: 10 }}>{t('my_doctor')}</T>
          {user.doctor ? (
            <Row gap={12}>
              <View style={[s.ico, { backgroundColor: tm.okSoft, width: 44, height: 44 }]}><Icon name="stetho" color={tm.ok} /></View>
              <View style={{ flex: 1 }}><T v="h3">{user.doctor.name}</T>{user.doctor.clinic ? <T v="small">{user.doctor.clinic}</T> : null}</View>
              {user.doctor.phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${user.doctor!.phone!.replace(/\s/g, '')}`)} style={[s.round, { backgroundColor: tm.ink }]}>
                  <Icon name="phone" size={18} color={tm.primaryText} />
                </Pressable>
              )}
            </Row>
          ) : (
            <>
              <T v="small" style={{ marginBottom: 10 }}>{t('no_doctor')}</T>
              <Row gap={8}>
                <TextInput value={code} onChangeText={x => setCode(x.toUpperCase())} placeholder="DEMO42" autoCapitalize="characters" placeholderTextColor={tm.ink3}
                  style={[s.input, { color: tm.ink, backgroundColor: tm.bg2, borderColor: tm.line, flex: 1, minWidth: 0 }]} />
                <Button title={t('link')} onPress={link} loading={busy} disabled={code.length < 4} style={{ paddingHorizontal: 14 }} />
              </Row>
            </>
          )}
        </Card>
      )}

      {user?.role === 'patient' && <RelativesCard />}
      {user?.role === 'patient' && <FamilyCard />}
      {user?.role === 'patient' && <RiskCard />}
      {user && <MyDataCard />}
      {user && <FeedbackCard />}

      {user?.role !== 'family' && <Card style={{ paddingVertical: 6 }}>
        <Item icon="bt" title={t('device')} sub={source === 'none' ? '—' : source === 'simulator' ? t('source_sim') : t('source_dev')} onPress={() => setDev(true)} />
        <Item icon="server" title={t('server')} sub={settings.server || '—'} />
      </Card>}

      <Card>
        <T v="label" style={{ marginBottom: 10 }}>{t('appearance')}</T>
        <Row gap={8} style={{ marginBottom: 8 }}><Icon name="moon" size={16} color={tm.ink3} /><T v="small">{t('theme')}</T></Row>
        <Seg<ThemePref> value={themePref} onChange={setThemePref} items={[['system', t('th_system')], ['light', t('th_light')], ['dark', t('th_dark')]]} />
        <Row gap={8} style={{ marginTop: 14, marginBottom: 8 }}><Icon name="globe" size={16} color={tm.ink3} /><T v="small">{t('language')}</T></Row>
        <Seg value={lang} onChange={setLang} items={[['ru', 'Рус'], ['ky', 'Кыр'], ['en', 'Eng']]} />
        <Row style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}><T v="h3">{t('big_mode')}</T><T v="small">{t('big_mode_sub')}</T></View>
          <Switch value={big} onValueChange={setBig} accessibilityLabel={t('big_mode')} />
        </Row>
      </Card>

      {user && <Button title={t('sign_out')} kind="ghost" icon="logout" onPress={signOut} />}

      <View style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
        <Row gap={6}><Icon name="pulse" size={16} color={tm.af} /><T style={{ fontFamily: F.displayBold }}>AFib Monitor</T><T v="mono">v2.2</T></Row>
        <T v="small" style={{ textAlign: 'center', paddingHorizontal: 20 }}>{t('disclaimer')}</T>
      </View>
      <DeviceSheet open={dev} onClose={() => setDev(false)} />
    </ScrollView>
  )
}

function FamilyCard() {
  const { theme: tm, t, toast } = useApp()
  const [info, setInfo] = useState<{ enabled: boolean; links: TgLink[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.telegram().then(setInfo).catch(() => undefined)
  useEffect(() => { load() }, [])
  const invite = async () => {
    setBusy(true)
    try {
      const r = await api.telegramLink()
      if (r.url) await Share.share({ message: t('family_share', { url: r.url }) })
      setTimeout(load, 15000)
    } catch (e) { toast((e as Error).message, 'af') }
    setBusy(false)
  }
  return (
    <Card>
      <Row gap={12} style={{ marginBottom: 8 }}>
        <View style={[s.ico, { backgroundColor: '#2aabee', width: 40, height: 40 }]}><Icon name="send" size={20} color="#fff" /></View>
        <T v="h3" style={{ flex: 1 }}>{t('family_tg')}</T>
      </Row>
      <T v="small" style={{ marginBottom: 12 }}>{t('family_tg_sub')}</T>
      {info && !info.enabled ? <T v="small" c={tm.warn}>{t('tg_off')}</T> : <>
        {info?.links.map(l => (
          <Row key={l.id} gap={10} style={{ paddingVertical: 8 }}>
            <View style={[s.dot, { backgroundColor: tm.ok }]} />
            <T style={{ flex: 1 }}>{l.name}</T>
            <Pressable onPress={async () => setInfo({ ...info, links: await api.telegramUnlink(l.id) })}><T v="small" c={tm.af}>{t('remove')}</T></Pressable>
          </Row>
        ))}
        <Button title={t('family_add')} kind="soft" icon="send" onPress={invite} loading={busy} style={{ marginTop: 6 }} />
      </>}
    </Card>
  )
}

function RiskCard() {
  const { theme: tm, t } = useApp()
  const [r, setR] = useState<Risk | null>(null)
  useEffect(() => { api.risk().then(setR).catch(() => undefined) }, [])
  if (!r) return null
  const c = r.level === 'high' ? [tm.af, tm.afSoft] : r.level === 'moderate' ? [tm.warn, tm.warnSoft] : [tm.ok, tm.okSoft]
  return (
    <Card>
      <T v="label" style={{ marginBottom: 10 }}>{t('risk_title')}</T>
      {!r.updated_at ? <T v="small">{t('risk_none')}</T> : (
        <Row gap={14}>
          <View style={[s.score, { backgroundColor: c[1] }]}><T style={{ fontFamily: F.displayBold, fontSize: 26 }} c={c[0]}>{r.cha2ds2_vasc}</T></View>
          <T v="small" style={{ flex: 1 }}>CHA₂DS₂-VA {r.cha2ds2_va}{r.annual_stroke_risk_pct != null ? ` · ~${r.annual_stroke_risk_pct}% ${t('per_year')}` : ''}</T>
        </Row>
      )}
    </Card>
  )
}

function FeedbackCard() {
  const { theme: tm, t, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [stars, setStars] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      await api.feedback({ rating: stars, text: text.trim() || undefined, platform: Platform.OS, app_version: '2.2.0' })
      toast(t('thanks'), 'ok'); setOpen(false); setStars(0); setText('')
    } catch (e) { toast((e as Error).message, 'af') }
    setBusy(false)
  }
  return (
    <Card style={{ paddingVertical: 6 }}>
      <Item icon="heart" title={t('rate_app')} sub={t('rate_sub')} onPress={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={t('rate_app')}>
        <Row gap={10} style={{ justifyContent: 'center', marginVertical: 8 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <Pressable key={n} onPress={() => setStars(n)} accessibilityLabel={`${n}`} hitSlop={6}>
              <T style={{ fontSize: 36, color: n <= stars ? tm.warn : tm.line }}>★</T>
            </Pressable>
          ))}
        </Row>
        <TextInput value={text} onChangeText={setText} placeholder={t('rate_ph')} placeholderTextColor={tm.ink3} multiline
          style={[s.input, { height: 110, paddingTop: 14, textAlignVertical: 'top', color: tm.ink, backgroundColor: tm.bg2, borderColor: tm.line, letterSpacing: 0, fontFamily: F.body, fontSize: 15 }]} />
        <Button title={t('send')} onPress={send} loading={busy} disabled={!stars} style={{ marginTop: 14, marginBottom: 20 }} />
      </Sheet>
    </Card>
  )
}

function MyDataCard() {
  const { theme: tm, t, toast, signOut, lang, setUser } = useApp()
  const [log, setLog] = useState<{ ts: string; who: string; action: string }[] | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [research, setResearch] = useState<boolean | null>(null)
  const [del, setDel] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.accessLog().then(setLog).catch(() => setLog([]))
    api.consents().then(c => setResearch(researchGiven(c))).catch(() => undefined)
  }, [])
  const exportData = async () => {
    try { const r = await api.exportLink(); await Linking.openURL(r.url) } catch (e) { toast((e as Error).message, 'af') }
  }
  const toggleResearch = async () => {
    const next = !research
    try {
      if (next) await api.setConsent('research', false)     // retire consents to older texts first
      const r = await api.setConsent('research', next)
      setResearch(researchGiven(r))
      setUser(await api.me())               // consent changes what the app may show (research / wellness)
    } catch (e) { toast((e as Error).message, 'af') }
  }
  const remove = async () => {
    setBusy(true)
    try { await api.deleteMe(pw); setDel(false); toast(t('deleted'), 'ok'); await signOut() }
    catch (e) { toast((e as Error).message, 'af') }
    setBusy(false)
  }
  const when = (iso: string) => new Date(iso).toLocaleString(locOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Card style={{ paddingVertical: 6 }}>
      <T v="label" style={{ marginTop: 10, marginBottom: 2 }}>{t('my_data')}</T>
      <Item icon="sync" title={t('export_data')} sub={t('export_sub')} onPress={exportData} />
      <Item icon="user" title={t('who_viewed')} sub={log == null ? '…' : log.length ? `${log[0].who} · ${when(log[0].ts)}` : t('nobody_viewed')}
        onPress={log && log.length ? () => setShowLog(!showLog) : undefined} />
      {showLog && log && log.slice(0, 20).map((a, i) => (
        <Row key={i} gap={8} style={{ paddingVertical: 6, paddingLeft: 48 }}>
          <T v="small" style={{ flex: 1 }}>{a.who} — {t(`act_${a.action}`)}</T><T v="mono">{when(a.ts)}</T>
        </Row>
      ))}
      <Item icon="book" title={t('research_toggle')} sub={t('consent_research')} onPress={research == null ? undefined : toggleResearch}
        right={<View style={[s.toggle, { backgroundColor: research ? tm.ok : tm.bg2 }]}><View style={[s.knob, { alignSelf: research ? 'flex-end' : 'flex-start' }]} /></View>} />
      <Pressable onPress={() => setDel(true)} style={{ paddingVertical: 14 }}><T c={tm.af} style={{ fontFamily: F.semi }}>{t('delete_account')}</T></Pressable>
      <Sheet open={del} onClose={() => { setDel(false); setPw('') }} title={t('delete_title')}>
        <T v="small" style={{ marginBottom: 12, lineHeight: 20 }}>{t('delete_text')}</T>
        <TextInput value={pw} onChangeText={setPw} secureTextEntry placeholder={t('password')} placeholderTextColor={tm.ink3}
          style={[s.input, { color: tm.ink, backgroundColor: tm.bg2, borderColor: tm.line, letterSpacing: 0, fontFamily: F.body }]} />
        <Button title={t('delete_btn')} kind="danger" onPress={remove} loading={busy} disabled={pw.length < 6} style={{ marginTop: 14, marginBottom: 20 }} />
      </Sheet>
    </Card>
  )
}

const s = StyleSheet.create({
  toggle: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  score: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  ico: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { height: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontFamily: F.mono, fontSize: 16, letterSpacing: 2 },
})
