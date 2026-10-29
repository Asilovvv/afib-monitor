import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native'
import { api, settings, type FamilyCard as CardT } from '../api'
import { joinUrl } from '../joinlink'
import { Button, Card, Icon, Row, T } from '../components/ui'
import { fmtDate } from '../i18n'
import { useApp } from '../store'
import { F } from '../theme'

/** Home screen of a relative: one card per patient, plain words only (checks, rhythm words, typed-in blood pressure,
 *  pills). Refreshes every minute while open. Nothing here is a medical finding, and the screen says so. */
export function FamilyHome({ onProfile }: { onProfile: () => void }) {
  const { theme: tm, t, lang, toast, user } = useApp()
  const [cards, setCards] = useState<CardT[] | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setCards(await api.familyPatients()) } catch { /* offline */ } }, [])
  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv) }, [load])

  const add = async () => {
    if (code.trim().length < 4) return
    setBusy(true)
    try { setCards(await api.familyLink(code.trim())); setCode(''); toast(t('saved'), 'ok') }
    catch (e) { toast((e as Error).message, 'af') }
    setBusy(false)
  }
  const leave = (c: CardT) => {
    const go = async () => { try { await api.familyLeave(c.id); load() } catch { toast(t('day_offline'), 'info') } }
    if (Platform.OS === 'web') { go(); return }
    Alert.alert(t('fam_leave'), c.name, [{ text: t('cancel'), style: 'cancel' }, { text: t('fam_leave'), style: 'destructive', onPress: go }])
  }
  const when = (iso: string) => fmtDate(lang, iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const online = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 2 * 60e3

  return (
    <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h1">{t('fam_home')}</T>
        <Pressable onPress={onProfile} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('profile')}><Icon name="user" color={tm.ink2} /></Pressable>
      </Row>
      <T v="small" style={{ marginBottom: 14 }}>{user?.name}</T>

      {cards?.map(c => {
        const last = c.checks_today.last
        const verdictColor = last?.verdict === 'regular' ? tm.ok : last?.verdict === 'irregular' ? tm.warn : tm.ink2
        return (
          <Card key={c.id} style={{ marginBottom: 14 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="h2">{c.name}</T>
              {online(c.last_seen) && <Row gap={6}><View style={[s.dot, { backgroundColor: tm.ok }]} /><T v="small">{t('fam_seen')}</T></Row>}
            </Row>
            <View style={[s.block, { backgroundColor: tm.bg2 }]}>
              <T v="label">{t('fam_checks')}</T>
              <T v="h2" c={c.checks_today.plan && c.checks_today.done < c.checks_today.due ? tm.warn : tm.ink}>
                {c.checks_today.plan ? `${c.checks_today.done} / ${c.checks_today.due}` : String(c.checks_today.checks)}
              </T>
              {last
                ? <T c={verdictColor} style={{ fontFamily: F.semi }}>{t(`fam_verdict_${last.verdict}`)} · {when(last.ts)}</T>
                : <T v="small">{t('fam_no_check')}</T>}
            </View>
            <Row gap={10}>
              <View style={[s.block, { backgroundColor: tm.bg2, flex: 1 }]}>
                <T v="label">{t('fam_bp')}</T>
                {c.bp ? <><T v="num" style={{ fontSize: 24 }}>{c.bp.systolic}/{c.bp.diastolic}</T><T v="small">{when(c.bp.ts)}</T></> : <T v="small">—</T>}
              </View>
              <View style={[s.block, { backgroundColor: tm.bg2, flex: 1 }]}>
                <T v="label">{t('fam_meds')}</T>
                {c.meds_today.total ? <T v="num" style={{ fontSize: 24 }}>{c.meds_today.taken} / {c.meds_today.due}</T> : <T v="small">—</T>}
              </View>
            </Row>
            <Pressable onPress={() => leave(c)} style={{ marginTop: 10, alignSelf: 'flex-end' }} hitSlop={8}><T v="small" c={tm.ink3}>{t('fam_leave')}</T></Pressable>
          </Card>
        )
      })}

      <Card>
        <T v="h3">{t('fam_add')}</T>
        {!cards?.length && <T v="small" style={{ marginTop: 6 }}>{t('fam_empty')}</T>}
        <TextInput value={code} onChangeText={x => setCode(x.toUpperCase())} placeholder="ABC123" placeholderTextColor={tm.ink3}
          autoCapitalize="characters" maxLength={6} style={[s.input, { borderColor: tm.line, color: tm.ink, backgroundColor: tm.bg2, marginTop: 10, textAlign: 'center' }]} />
        <Button title={t('fam_add')} icon="plus" onPress={add} loading={busy} disabled={code.trim().length < 4} style={{ marginTop: 10 }} />
      </Card>
      <T v="small" style={{ marginTop: 14, lineHeight: 19 }}>{t('fam_tg_hint')}</T>
      <T v="small" style={{ marginTop: 8, lineHeight: 19 }} c={tm.ink3}>{t('fam_note')}</T>
    </ScrollView>
  )
}

/** Patient side: give a relative a code, see who watches, disconnect. */
export function RelativesCard() {
  const { theme: tm, t, user, toast, lang, openPlan } = useApp()
  const [list, setList] = useState<{ id: number; name: string; since: string }[]>([])
  const [code, setCode] = useState<string | null>(null)
  const load = useCallback(async () => { try { setList(await api.myFamily()) } catch { /* offline */ } }, [])
  useEffect(() => { load() }, [load])
  if (!user) return null
  const invite = async () => { try { setCode((await api.familyInvite()).code) } catch { toast(t('day_offline'), 'info') } }
  const revoke = (l: { id: number; name: string }) => {
    const go = async () => { try { await api.revokeFamily(l.id); load() } catch { toast(t('day_offline'), 'info') } }
    if (Platform.OS === 'web') { go(); return }
    Alert.alert(t('fam_revoke'), l.name, [{ text: t('cancel'), style: 'cancel' }, { text: t('fam_revoke'), style: 'destructive', onPress: go }])
  }
  return (
    <Card style={{ marginTop: 14 }}>
      <Row gap={8} style={{ marginBottom: 6 }}><T style={{ fontSize: 20 }}>👪</T><T v="h3">{t('fam_title')}</T></Row>
      <T v="small" style={{ marginBottom: 10, lineHeight: 19 }}>{t('fam_sub')}</T>
      {list.length ? list.map(l => (
        <Row key={l.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
          <T>{l.name} <T v="small">· {t('fam_since')} {fmtDate(lang, l.since, { day: 'numeric', month: 'short' })}</T></T>
          <Pressable onPress={() => revoke(l)} hitSlop={8}><T v="small" c={tm.af}>{t('fam_revoke')}</T></Pressable>
        </Row>
      )) : <T v="small" c={tm.ink3}>{t('fam_none')}</T>}
      {code ? (
        <View style={[s.block, { backgroundColor: tm.accentSoft, alignItems: 'center', marginTop: 10 }]}>
          <T v="label">{t('fam_code_ready')}</T>
          <T style={{ fontFamily: F.displayBold, fontSize: 34, letterSpacing: 6 }}>{code}</T>
          <T v="small" style={{ textAlign: 'center', lineHeight: 18 }}>{t('fam_code_hint')}</T>
          <Button title={t('join_share')} kind="soft" icon="send" style={{ marginTop: 10, alignSelf: 'stretch' }}
            onPress={() => { const u = joinUrl('family', code, settings.server); Share.share({ message: t('join_share_family', { code, url: u.web ?? u.app }) }).catch(() => undefined) }} />
        </View>
      ) : user.plan !== 'family' && list.length >= 1
        ? <Button title={t('pl_more_family')} kind="soft" icon="star" onPress={() => openPlan('family_watchers')} style={{ marginTop: 10 }} />
        : <Button title={t('fam_invite')} kind="soft" icon="plus" onPress={invite} style={{ marginTop: 10 }} />}
    </Card>
  )
}

const s = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40 },
  block: { borderRadius: 14, padding: 12, marginTop: 10, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, fontFamily: F.displayBold, fontSize: 20, letterSpacing: 3 },
})
