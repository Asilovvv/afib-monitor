import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Button, Card, Row, Sheet, T } from '../components/ui'
import { ECG_FS, ECG_PER_PACKET } from '../protocol'
import { snrDb } from '../snr'
import { useApp } from '../store'

/** Engineer's bench, hidden behind Device → Bench. Numbers for the board-day checklist (docs/BOARD_DAY.md):
 *  packet rate (expected 6.25/s at 125 Hz × 20 samples), lost packets in the last minute, SNR of the last 30 s
 *  (Notebook-16 definition, ml/SNR_REQUIREMENT.md: ≥ 9 dB / ≥ 18 dB), battery, chip inference time, protocol version.
 *  "Record 60 s" writes the raw samples to a CSV in the app's cache and opens the share sheet; nothing leaves the phone
 *  unless the person shares it. Not a patient feature: no verdicts here. */
const EXPECTED_PPS = ECG_FS / ECG_PER_PACKET
type Point = { t: number; packets: number; lost: number }

export function BenchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme: tm, t, source, status, battery, rssi, ecg, link, toast } = useApp()
  const [, setTick] = useState(0)
  const hist = useRef<Point[]>([])
  const [snr, setSnr] = useState<{ snr: number | null; beats: number } | null>(null)
  const [rec, setRec] = useState<{ start: number; startTotal: number } | null>(null)
  const [recLeft, setRecLeft] = useState(0)

  useEffect(() => {
    if (!open) return
    const iv = setInterval(() => {
      const now = Date.now()
      hist.current.push({ t: now, packets: ecg.packets, lost: ecg.lost })
      hist.current = hist.current.filter(p => now - p.t <= 65_000)
      setTick(x => x + 1)
      if (rec) {
        const left = Math.max(0, 60 - (now - rec.start) / 1000)
        setRecLeft(left)
        if (left === 0) finishRecording()
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [open, ecg, rec])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const iv = setInterval(() => { if (ecg.total >= 30 * ECG_FS) setSnr(snrDb(ecg.last(30 * ECG_FS), ECG_FS)) }, 5000)
    return () => clearInterval(iv)
  }, [open, ecg])

  const h = hist.current
  const win = (sec: number) => {
    const now = Date.now(); const first = h.find(p => now - p.t <= sec * 1000) ?? h[0]; const last = h[h.length - 1]
    if (!first || !last || last.t === first.t) return { pps: null as number | null, lost: 0 }
    return { pps: ((last.packets - first.packets) * 1000) / (last.t - first.t), lost: last.lost - first.lost }
  }
  const w10 = win(10), w60 = win(60)
  const holes30 = ecg.total ? ecg.holes(Math.min(ecg.total, 30 * ECG_FS)) : 0
  const connected = source !== 'none' && (source === 'simulator' || link.state === 'connected')
  useEffect(() => { if (!connected) setRec(null) }, [connected])

  const startRecording = () => { setRec({ start: Date.now(), startTotal: ecg.total }); setRecLeft(60) }
  const finishRecording = async () => {
    const r = rec; setRec(null)
    if (!r) return
    const n = Math.min(ecg.total - r.startTotal, ecg.size)
    if (n <= 0) { toast(t('bench_rec_lost'), 'info'); return }     // source restarted mid-recording
    const x = ecg.last(n)
    const lines = ['t_s,mv,filled']
    const holes = ecg.holes(n)
    for (let i = 0; i < n; i++) lines.push(`${(i / ECG_FS).toFixed(4)},${x[i].toFixed(4)},${ecg.hole[(ecg.total - n + i) % ecg.size]}`)
    const stamp = new Date(r.start).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const name = `afib_raw_${source}_${stamp}.csv`
    const header = `# AFib Monitor raw ECG, ${ECG_FS} Hz, source=${source}, ${n} samples, filled(lost)=${holes}, started=${new Date(r.start).toISOString()}\n`
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([header + lines.join('\n')], { type: 'text/csv' })
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
      } else {
        const FS: typeof import('expo-file-system') = require('expo-file-system')
        const Sharing: typeof import('expo-sharing') = require('expo-sharing')
        const f = new FS.File(FS.Paths.cache, name)
        f.write(header + lines.join('\n'))
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: name })
      }
      toast(t('bench_saved', { n: String(n), h: String(holes) }), 'ok')
    } catch (e) { toast((e as Error).message, 'af') }
  }

  const val = (v: number | null | undefined, unit = '', d = 1) => v == null || !isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`
  const ok = (good: boolean | null) => good == null ? tm.ink : good ? tm.ok : tm.af
  const Line = ({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) => (
    <Row style={[s.line, { borderBottomColor: tm.line }]}>
      <View style={{ flex: 1 }}><T>{label}</T>{hint && <T v="small" c={tm.ink3}>{hint}</T>}</View>
      <T v="mono" style={{ fontSize: 17, color: color ?? tm.ink }}>{value}</T>
    </Row>
  )
  return (
    <Sheet open={open} onClose={onClose} title={t('bench')}>
      <T v="small" style={{ marginBottom: 10, lineHeight: 18 }}>{t('bench_sub')}</T>
      {!connected && <Card style={{ marginBottom: 10, backgroundColor: tm.bg2 }}><T v="small">{t('bench_noconn')}</T></Card>}
      <Line label={t('bench_pps')} hint={`${t('bench_expected')} ${EXPECTED_PPS.toFixed(2)}/s`} value={val(w10.pps, '/s', 2)}
        color={w10.pps == null ? undefined : ok(Math.abs(w10.pps - EXPECTED_PPS) < 0.5)} />
      <Line label={t('bench_lost')} hint={t('bench_lost_hint')} value={`${w60.lost}`} color={ok(h.length < 5 ? null : w60.lost === 0)} />
      <Line label={t('bench_holes')} value={`${holes30}`} color={ok(ecg.total < 30 * ECG_FS ? null : holes30 === 0)} />
      <Line label="SNR · 30 s" hint={t('bench_snr_hint')} value={snr ? (snr.snr == null ? t('bench_few_beats', { n: String(snr.beats) }) : `${val(snr.snr, ' dB')} · ${snr.beats}`) : '…'}
        color={snr?.snr == null ? undefined : ok(snr.snr >= 9)} />
      <Line label={t('battery')} value={battery != null ? `${battery}%` : '—'} />
      <Line label={t('signal')} value={rssi != null ? `${rssi} dBm` : '—'} />
      <Line label={t('inference')} value={status?.inferUs ? `${(status.inferUs / 1000).toFixed(2)} ms` : '—'} />
      <Line label={t('bench_proto')} value={status ? `v1 · ${Math.round(status.deviceMs / 1000)} s` : '—'} />
      <Line label={t('bench_total')} value={`${ecg.packets} · −${ecg.lost}`} />
      <View style={{ marginTop: 16, gap: 8 }}>
        {rec
          ? <Button title={t('bench_recording', { s: String(Math.ceil(recLeft)) })} kind="soft" onPress={finishRecording} />
          : <Button title={t('bench_record')} icon="wave" onPress={startRecording} disabled={!connected} />}
        <T v="small" c={tm.ink3} style={{ lineHeight: 18 }}>{t('bench_record_hint')}</T>
      </View>
    </Sheet>
  )
}

const s = StyleSheet.create({
  line: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
})
