import { fmtDate } from '../i18n'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Battery, Button, Icon, Row, Sheet, T, type IconName } from '../components/ui'
import { BenchSheet } from './Bench'
import { useApp } from '../store'
import { useNow, fmtDur } from './Monitor'

function Line({ icon, label, value, extra }: { icon: IconName; label: string; value: string; extra?: React.ReactNode }) {
  const { theme: t } = useApp()
  return (
    <Row style={[s.line, { borderColor: t.line }]} gap={12}>
      <View style={[s.ico, { backgroundColor: t.bg2 }]}><Icon name={icon} size={18} color={t.ink2} /></View>
      <T style={{ flex: 1 }}>{label}</T>
      {extra}
      <T v="mono" c={t.ink}>{value}</T>
    </Row>
  )
}

export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme: tm, t, source, status, battery, rssi, ecg, connectedAt, stop, pending, lastSync, syncNow, user, lang } = useApp()
  const now = useNow(1000)
  const [bench, setBench] = useState(false)
  const bars = rssi == null ? 0 : rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1
  return (
    <Sheet open={open} onClose={onClose} title={t('device')}>
      <View style={[s.hero, { backgroundColor: tm.bg2 }]}>
        <View style={[s.board, { backgroundColor: tm.ink }]}>
          <View style={[s.screen, { backgroundColor: tm.dark ? '#000' : '#0b0d12' }]}>
            <T v="mono" c="#38f2b0" style={{ fontSize: 10 }}>{status ? `${Math.round(status.bpm)} BPM` : '…'}</T>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <T v="h3">{source === 'simulator' ? t('source_sim') : 'AFib-Monitor'}</T>
          <T v="small">{source === 'simulator' ? 'Synthetic ECG · 125 Hz' : t('source_dev')}</T>
        </View>
      </View>
      <Line icon="bolt" label={t('battery')} value={battery != null ? `${battery}%` : '—'} extra={<Battery level={battery} color={tm.ink3} />} />
      <Line icon="signal" label={t('signal')} value={rssi != null ? `${rssi} dBm` : '—'}
        extra={<Row gap={2}>{[1, 2, 3, 4].map(i => <View key={i} style={{ width: 4, height: 4 + i * 3, borderRadius: 1, backgroundColor: i <= bars ? tm.ok : tm.line }} />)}</Row>} />
      <Line icon="cpu" label={t('inference')} value={status?.inferUs ? `${(status.inferUs / 1000).toFixed(2)} ms` : '—'} />
      <Line icon="wave" label={t('packets')} value={`${ecg.packets}${ecg.lost ? ` · −${ecg.lost}` : ''}`} />
      <Line icon="clock" label={t('uptime')} value={connectedAt ? fmtDur(t, (now - connectedAt) / 1000) : '—'} />
      <Line icon="pulse" label={t('model')} value="TCN int8 · 27 KB" />
      <Line icon="sync" label={t('sync')} value={user ? (pending ? `${pending} ${t('pending')}` : lastSync ? fmtDate(lang, lastSync, { hour: '2-digit', minute: '2-digit' }) : t('never')) : '—'} />
      <Button title={t('bench')} kind="ghost" icon="cpu" onPress={() => setBench(true)} style={{ marginTop: 12 }} />
      <BenchSheet open={bench} onClose={() => setBench(false)} />
      <Row style={{ marginTop: 6 }} gap={10}>
        {user && <Button title={t('sync_now')} kind="soft" icon="sync" onPress={syncNow} style={{ flex: 1 }} />}
        {source !== 'none' && <Button title={t('stop')} kind="ghost" icon="x" onPress={() => { stop(); onClose() }} style={{ flex: 1 }} />}
      </Row>
    </Sheet>
  )
}

const s = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, marginBottom: 8 },
  board: { width: 64, height: 64, borderRadius: 14, padding: 7 },
  screen: { flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  line: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  ico: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
