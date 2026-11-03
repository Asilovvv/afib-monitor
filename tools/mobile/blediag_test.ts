/* Why the phone did not find the board (mobile/src/blediag.ts). Run: npx -y tsx@4.19.2 tools/mobile/blediag_test.ts */
import assert from 'node:assert/strict'
import { accept, diagnose, DIAG_KEY, scanErrorKey } from '../../mobile/src/blediag'
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

// scan errors the person can fix get their own advice (react-native-ble-plx BleErrorCode)
assert.equal(scanErrorKey({ errorCode: 601 }), 'location_off')
assert.equal(scanErrorKey({ errorCode: 600 }), 'scan_busy')
assert.equal(scanErrorKey({ errorCode: 102 }), 'bt_off')
assert.equal(scanErrorKey({ errorCode: 101 }), 'bt_unauthorized')
assert.equal(scanErrorKey({ errorCode: 2 }), 'ble_error')
assert.equal(scanErrorKey(null), 'ble_error')

// every message the connection can end with exists in all three languages
const keys = [...Object.values(DIAG_KEY), 'looking_around', 'connect_failed', 'reconnecting', 'not_found',
  ...[100, 101, 102, 600, 601, 0].map(c => scanErrorKey({ errorCode: c }))]
for (const key of keys as (keyof typeof DICT.ru)[])
  for (const lang of ['ru', 'en', 'ky'] as const) assert.ok(DICT[lang][key]?.length > 15, `${lang}.${key}`)
// inference time: the u16 in the status packet saturates; the model takes about 73 ms (BOARD_DAY A5)
assert.equal(fmtInfer(65535), '≥ 65.5 ms')
assert.equal(fmtInfer(6020), '6.02 ms')
assert.equal(fmtInfer(0), '—')
console.log('blediag ok')
