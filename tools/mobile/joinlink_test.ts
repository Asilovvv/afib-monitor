/* Invitation link parsing (mobile/src/joinlink.ts). Run: npx -y tsx@4.19.2 tools/mobile/joinlink_test.ts */
import assert from 'node:assert/strict'
import { joinUrl, parseJoin } from '../../mobile/src/joinlink'
assert.deepEqual(parseJoin('afibmonitor://join?doctor=demo42'), { kind: 'doctor', code: 'DEMO42' })
assert.deepEqual(parseJoin('https://afib-monitor.onrender.com/join?family=abc123&x=1'), { kind: 'family', code: 'ABC123' })
assert.equal(parseJoin('https://evil.example/?doctor=DEMO42'), null)          // not a /join page or our scheme
assert.equal(parseJoin('afibmonitor://join?doctor=ab'), null)                 // too short
assert.equal(parseJoin('afibmonitor://join?doctor=../../x'), null)            // only letters and digits
assert.equal(parseJoin(null), null)
assert.deepEqual(joinUrl('doctor', 'DEMO42', 'https://srv/'), { app: 'afibmonitor://join?doctor=DEMO42', web: 'https://srv/join?doctor=DEMO42' })
assert.equal(joinUrl('family', 'ABC123', '').web, null)
console.log('joinlink ok')
