import { readFileSync } from 'node:fs'
import { check, rPeaks, rPeaksAmp } from '../../mobile/src/rr.ts'
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let same = 0, peaksSame = 0, ampSame = 0, sqiDiff = 0
for (const c of cases) {
  const t = check(c.x)
  if (t.verdict === c.py.verdict) same++
  if (JSON.stringify(rPeaks(c.x)) === JSON.stringify(c.peaks)) peaksSame++
  if (JSON.stringify(rPeaksAmp(c.x)) === JSON.stringify(c.amp)) ampSame++
  if (Math.abs(t.bsqi - c.py.bsqi) > 1e-9) console.log('bsqi differs', t.bsqi, c.py.bsqi)
  sqiDiff = Math.max(sqiDiff, Math.abs(t.sqi - c.py.sqi))
}
console.log(`verdict same ${same}/${cases.length}, peaks identical ${peaksSame}/${cases.length}, 2nd detector identical ${ampSame}/${cases.length}, max |sqi diff| ${sqiDiff}`)
