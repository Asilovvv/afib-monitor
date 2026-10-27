/* Verdict guard on the phone: tools/parity/guard_strips.json holds 10 strips with FROZEN verdicts. Any change to
   mobile/src/rr.ts that moves a verdict fails here. Run: npx -y tsx@4.19.2 tools/mobile/guard_test.ts */
import { readFileSync } from 'fs'
import { check } from '../../mobile/src/rr'

const cases = JSON.parse(readFileSync(new URL('../parity/guard_strips.json', import.meta.url), 'utf8')) as { name: string; fs: number; expected: string; beats: number; x: number[] }[]
let bad = 0
for (const c of cases) {
  const r = check(c.x, c.fs)
  const ok = r.verdict === c.expected && r.beats === c.beats
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(14)} expected ${c.expected}/${c.beats}  got ${r.verdict}/${r.beats}`)
}
if (bad) { console.error(`${bad} guard strip(s) changed verdict — this is a change to the medical rule; it needs a notebook, not a fix here`); process.exit(1) }
console.log('verdict guard ok (phone)')
