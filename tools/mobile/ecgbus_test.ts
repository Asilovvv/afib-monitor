// Lost Bluetooth packets must keep their place in time and be marked, so the 30-s check can refuse such a strip.
// Run from mobile/: npx -y tsx@4.19.2 ../tools/mobile/ecgbus_test.ts
import assert from 'node:assert/strict'
import { EcgBus } from '../../mobile/src/ecgbus'
import { ECG_PER_PACKET } from '../../mobile/src/protocol'

const pkt = (seq: number, v: number) => ({ seq, samples: Array(ECG_PER_PACKET).fill(v) })

const b = new EcgBus()
for (let s = 0; s < 10; s++) b.push(pkt(s, s))
assert.equal(b.total, 10 * ECG_PER_PACKET)
assert.equal(b.holes(b.total), 0)

b.push(pkt(13, 13))                      // packets 10, 11, 12 lost
assert.equal(b.lost, 3)
assert.equal(b.total, 14 * ECG_PER_PACKET, 'lost packets keep their time')
assert.equal(b.holes(b.total), 3 * ECG_PER_PACKET)
const tail = b.last(5 * ECG_PER_PACKET)
assert.deepEqual(tail.slice(0, ECG_PER_PACKET), Array(ECG_PER_PACKET).fill(9), 'hole filled with the last value')
assert.equal(tail[tail.length - 1], 13)

for (let s = 14; s < 14 + 4000 / ECG_PER_PACKET; s++) b.push(pkt(s % 65536, 1))   // later: clean window
assert.equal(b.holes(30 * 125), 0, 'a clean 30-s window has no holes')

const w = new EcgBus()                   // sequence number wraps around 65535 -> 0 without a hole
w.push(pkt(65534, 0)); w.push(pkt(65535, 0)); w.push(pkt(0, 0))
assert.equal(w.lost, 0)

const r = new EcgBus()                   // long silence (reconnect) is counted but not filled
r.push(pkt(0, 0)); r.push(pkt(500, 0))
assert.equal(r.lost, 499); assert.equal(r.total, 2 * ECG_PER_PACKET)
console.log('ecgbus: all checks passed')
