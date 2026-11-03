/* Why the phone did not find the board (mobile/src/blediag.ts). Run: npx -y tsx@4.19.2 tools/mobile/blediag_test.ts */
import assert from 'node:assert/strict'
import { accept, diagnose, DIAG_KEY } from '../../mobile/src/blediag'
import { DICT } from '../../mobile/src/i18n'
import { fmtInfer, SERVICE_UUID } from '../../mobile/src/protocol'

const board = { id: 'b', name: 'AFib-Monitor', localName: 'AFib-Monitor', serviceUUIDs: [SERVICE_UUID.toUpperCase()] }
const watch = { id: 'w', name: 'Mi Band 8', localName: null, serviceUUIDs: ['0000fee0-0000-1000-8000-00805f9b34fb'] }
const old = { id: 'o', name: null, localName: 'AFib Monitor', serviceUUIDs: null }

// the filtered scan: a remembered or shortened name never rejects a device that advertises our service
assert.ok(accept({ name: 'ESP32', localName: 'AFib-Mon', serviceUUIDs: [SERVICE_UUID] }))
assert.ok(accept({ name: null, localName: null }))
assert.ok(!accept({ name: 'Mi Band 8', localName: null, serviceUUIDs: null }))

assert.deepEqual(diagnose([watch, board]), { diagnosis: 'found', device: board, count: 2 })   // UUIDs in upper case too
assert.equal(diagnose([watch, old]).diagnosis, 'old_firmware')
assert.equal(diagnose([watch]).diagnosis, 'others_only')
assert.equal(diagnose([]).diagnosis, 'nothing_nearby')

// every message the diagnosis can show exists in all three languages
for (const key of [...Object.values(DIAG_KEY), 'looking_around', 'connect_failed'] as const)
  for (const lang of ['ru', 'en', 'ky'] as const) assert.ok(DICT[lang][key]?.length > 20, `${lang}.${key}`)
// inference time: the u16 in the status packet saturates; the model takes about 73 ms (BOARD_DAY A5)
assert.equal(fmtInfer(65535), '≥ 65.5 ms')
assert.equal(fmtInfer(6020), '6.02 ms')
assert.equal(fmtInfer(0), '—')
console.log('blediag ok')
