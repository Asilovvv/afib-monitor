import { useEffect, useState } from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { api, type PlanInfo } from '../api'
import { billingAvailable, buy, manageUrl, offers, restore, type Offer } from '../billing'
import { Button, Card, Icon, Row, Sheet, T } from '../components/ui'
import { locOf } from '../i18n'
import { useApp } from '../store'
import { F } from '../theme'

/** "What's included": two honest columns. Everything about safety is in the free column and stays there; the paid
 *  column is convenience, memory and family. Same verdict on both — the screen says so in words. The purchase button
 *  only appears when the store SDK is configured; otherwise the price is shown with "soon". */
const ROWS: { key: string; free: boolean | string; family: boolean | string }[] = [
  { key: 'pl_check', free: true, family: true },
  { key: 'pl_sos', free: true, family: true },
  { key: 'pl_doctor', free: true, family: true },
  { key: 'pl_export', free: true, family: true },
  { key: 'pl_history', free: '30', family: '∞' },
  { key: 'pl_family', free: '1', family: '5' },
  { key: 'pl_photo', free: false, family: true },
  { key: 'pl_bot', free: false, family: true },
  { key: 'pl_backup', free: false, family: true },
]

export function PlanSheet({ open, onClose, reason }: { open: boolean; onClose: () => void; reason?: string | null }) {
  const { theme: tm, t, lang, toast, refreshUser } = useApp()
  const [info, setInfo] = useState<PlanInfo | null>(null)
  const [offs, setOffs] = useState<Offer[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (open) { api.myPlan().then(setInfo).catch(() => undefined); offers().then(setOffs) } }, [open])
  const paid = info?.plan === 'family'
  const until = info?.until ? new Date(info.until).toLocaleDateString(locOf(lang), { day: 'numeric', month: 'long' }) : null
  const price = info?.prices_som.family

  const purchase = async (o: Offer) => {
    setBusy(o.id)
    const r = await buy(o.id)
    setBusy(null)
    if (r === 'ok') { await refreshUser(); api.myPlan().then(setInfo).catch(() => undefined); toast(t('pl_thanks'), 'ok') }
    else if (r === 'error') toast(t('pl_store_err'), 'info')
  }
  const doRestore = async () => { setBusy('restore'); const ok = await restore(); setBusy(null); if (ok) { await refreshUser(); toast(t('pl_thanks'), 'ok') } else toast(t('pl_nothing'), 'info') }
  const cell = (v: boolean | string) => v === true ? <Icon name="check" color={tm.ok} size={18} /> : v === false ? <Icon name="x" color={tm.ink3} size={16} /> : <T style={{ fontFamily: F.semi }}>{v}</T>

  return (
    <Sheet open={open} onClose={onClose} title={t('pl_title')}>
      {reason && <View style={[s.note, { backgroundColor: tm.accentSoft }]}><T style={{ lineHeight: 20 }}>{t(`pl_why_${reason}`)}</T></View>}
      <T v="small" style={{ lineHeight: 19, marginBottom: 12 }}>{t('pl_sub')}</T>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row style={[s.row, { backgroundColor: tm.bg2 }]}><View style={{ flex: 1 }} /><T v="label" style={s.col}>{t('pl_free')}</T><T v="label" style={[s.col, { color: tm.accent }]}>{t('pl_fam')}</T></Row>
        {ROWS.map(r => (
          <Row key={r.key} style={[s.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tm.line }]}>
            <T style={{ flex: 1, fontSize: 14.5, lineHeight: 19 }}>{t(r.key)}</T>
            <View style={s.col}>{cell(r.free)}</View><View style={s.col}>{cell(r.family)}</View>
          </Row>
        ))}
      </Card>
      <T v="small" style={{ marginTop: 10, lineHeight: 18 }} c={tm.ink3}>{t('pl_same_verdict')}</T>

      <View style={{ marginTop: 16, gap: 10 }}>
        {paid ? (
          <>
            <T v="h3">{info?.source === 'trial' ? t('pl_trial_on', { d: until ?? '' }) : t('pl_fam_on', { d: until ?? '' })}</T>
            {info?.source === 'revenuecat' && <Button title={t('pl_manage')} kind="soft" onPress={() => Linking.openURL(manageUrl())} />}
          </>
        ) : (
          <>
            {price && <T v="h3">{t('pl_price', { m: String(price.month), y: String(price.year) })}</T>}
            {billingAvailable() && offs.length > 0 ? offs.map(o => (
              <Button key={o.id} title={`${o.period === 'year' ? t('pl_year') : t('pl_month')} · ${o.price}`} onPress={() => purchase(o)} loading={busy === o.id} />
            )) : <View style={[s.note, { backgroundColor: tm.bg2 }]}><T v="small" style={{ lineHeight: 18 }}>{t('pl_soon')}</T></View>}
            {billingAvailable() && <Button title={t('pl_restore')} kind="ghost" onPress={doRestore} loading={busy === 'restore'} />}
          </>
        )}
      </View>
      <T v="small" style={{ marginTop: 12, lineHeight: 18 }} c={tm.ink3}>{t('pl_fair')}</T>
    </Sheet>
  )
}

const s = StyleSheet.create({
  row: { paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  col: { width: 76, alignItems: 'center', textAlign: 'center' },
  note: { borderRadius: 12, padding: 12, marginBottom: 10 },
})
