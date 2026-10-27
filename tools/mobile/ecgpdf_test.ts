/* ECG paper page (mobile/src/ecgpdf.ts): standard scale and the non-diagnosis note must always be present.
   Run: npx -y tsx@4.19.2 tools/mobile/ecgpdf_test.ts */
import assert from 'node:assert/strict'
import { ecgHtml } from '../../mobile/src/ecgpdf'
const x = Array.from({ length: 30 * 125 }, (_, i) => Math.sin(i / 7) * 0.5)
for (const lang of ['ru', 'ky', 'en'] as const) {
  const h = ecgHtml({ samples: x, fs: 125, ts: 0, bpm: 70, verdict: 'regular', name: 'A <B>' }, lang, true)
  assert.ok(h.includes('25'), 'scale'); assert.ok(h.includes('10'), 'gain')
  assert.equal((h.match(/<svg /g) || []).length, 1, 'one A4 page for 30 s')
  assert.equal((h.match(/0–10 s|10–20 s|20–30 s/g) || []).length, 3, 'three 10-s rows')
  assert.ok(h.includes('A &lt;B&gt;'), 'name escaped')
  assert.ok(/Не является диагнозом|Not a diagnosis|Диагноз эмес/.test(h), 'note present in ' + lang)
}
assert.ok(!ecgHtml({ samples: x, fs: 125, ts: 0, bpm: 70, name: 'Secret' }, 'ru', false).includes('Secret'), 'name withheld when not allowed')
assert.equal((ecgHtml({ samples: Array(60 * 125).fill(0), fs: 125, ts: 0, bpm: null }, 'ru', false).match(/<svg /g) || []).length, 2, '60 s → two pages')
console.log('ecgpdf ok')
