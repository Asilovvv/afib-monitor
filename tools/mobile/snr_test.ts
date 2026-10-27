/* SNR parity: the phone's TypeScript SNR (mobile/src/snr.ts) against the Notebook-16 Python definition
   (tools/mobile/snr_ref.py → fixtures/snr_cases.json). Pass: within ±1 dB on every case.
   Run: npx -y tsx@4.19.2 tools/mobile/snr_test.ts */
import { readFileSync } from 'fs'
import { snrDb } from '../../mobile/src/snr'

const cases = JSON.parse(readFileSync(new URL('./fixtures/snr_cases.json', import.meta.url), 'utf8')) as { name: string; fs: number; snr_db: number | null; beats: number; x: number[] }[]
let bad = 0
for (const c of cases) {
  const r = snrDb(c.x, c.fs)
  const ok = c.snr_db == null ? r.snr == null : r.snr != null && Math.abs(r.snr - c.snr_db) <= 1.0
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(12)} py ${c.snr_db?.toFixed(2)} dB (${c.beats} beats)  ts ${r.snr?.toFixed(2)} dB (${r.beats} beats)`)
}
if (bad) { console.error(`${bad} case(s) outside ±1 dB`); process.exit(1) }
console.log('SNR parity ok')
