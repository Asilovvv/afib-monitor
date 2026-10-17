import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native'
import { api, settings, type Risk, type TgLink } from '../api'
import { Button, Card, Icon, Row, Seg, T, type IconName } from '../components/ui'
import { useApp, type ThemePref } from '../store'
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

export default function Profile({ onSignIn }: { onSignIn: () => void }) {
  const { theme: tm, t, user, setUser, signOut, lang, setLang, themePref, setThemePref, toast, source } = useApp()
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
      <T v="h1">{t('profile')}</T>

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

      {user && (
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
                  style={[s.input, { color: tm.ink, backgroundColor: tm.bg2, borderColor: tm.line, flex: 1 }]} />
                <Button title={t('link')} onPress={link} loading={busy} disabled={code.length < 4} />
              </Row>
            </>
          )}
        </Card>
      )}

      {user && <FamilyCard />}
      {user && <RiskCard />}

      <Card style={{ paddingVertical: 6 }}>
        <Item icon="bt" title={t('device')} sub={source === 'none' ? '—' : source === 'simulator' ? t('source_sim') : t('source_dev')} onPress={() => setDev(true)} />
        <Item icon="server" title={t('server')} sub={settings.server || '—'} />
      </Card>

      <Card>
        <T v="label" style={{ marginBottom: 10 }}>{t('appearance')}</T>
        <Row gap={8} style={{ marginBottom: 8 }}><Icon name="moon" size={16} color={tm.ink3} /><T v="small">{t('theme')}</T></Row>
        <Seg<ThemePref> value={themePref} onChange={setThemePref} items={[['system', t('th_system')], ['light', t('th_light')], ['dark', t('th_dark')]]} />
        <Row gap={8} style={{ marginTop: 14, marginBottom: 8 }}><Icon name="globe" size={16} color={tm.ink3} /><T v="small">{t('language')}</T></Row>
        <Seg value={lang} onChange={setLang} items={[['ru', 'Рус'], ['ky', 'Кыр'], ['en', 'Eng']]} />
      </Card>

      {user && <Button title={t('sign_out')} kind="ghost" icon="logout" onPress={signOut} />}

      <View style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
        <Row gap={6}><Icon name="pulse" size={16} color={tm.af} /><T style={{ fontFamily: F.displayBold }}>AFib Monitor</T><T v="mono">v2.1</T></Row>
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

const s = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  score: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  ico: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { height: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontFamily: F.mono, fontSize: 16, letterSpacing: 2 },
})
