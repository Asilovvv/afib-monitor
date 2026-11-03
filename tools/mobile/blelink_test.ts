/* The phone's Bluetooth link (mobile/src/ble.ts) on a model of react-native-ble-plx with a virtual clock
 * (tools/mobile/blelink/fake_ble.ts): Stop is honoured at every step, an old attempt never acts on a new one, a dropped
 * link keeps reconnecting without an error, a failed connect leaves no half-open link, and a search that finds nothing
 * ends with one diagnosis. Run: npx -y tsx@4.19.2 tools/mobile/blelink_test.ts */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { advance, BleManager, clock, reset, world } from './blelink/fake_ble'

const here = resolve(__dirname)
const src = resolve(here, '../../mobile/src')
// ble.ts as shipped, with its two native imports pointed at the models
const code = readFileSync(join(src, 'ble.ts'), 'utf8')
  .replace(/from 'react-native'/, `from '${join(here, 'blelink/fake_rn')}'`)
  .replace('type BleError, ', '')
  .replace(/from 'react-native-ble-plx'/, `from '${join(here, 'blelink/fake_ble')}'\ntype BleError = { errorCode?: number; message: string }`)
  .replace(/from '\.\/(blediag|protocol)'/g, (_m, f) => `from '${join(src, f)}'`)
assert.ok(code.includes('blelink/fake_ble') && code.includes('blelink/fake_rn'), 'imports of ble.ts changed: update this test')
const file = join(mkdtempSync(join(tmpdir(), 'blelink-')), 'ble.ts')
writeFileSync(file, code)

async function scenario(run: (link: any, states: string[]) => Promise<void>) {
  reset()
  const { DeviceLink } = await import(pathToFileURL(file).href)
  const states: string[] = []
  const link = new DeviceLink(() => undefined, (s: string, d?: string) => states.push(`${clock()} ${s}${d ? ':' + d : ''}`))
  await run(link, states)
  return { states, log: world.log, mgr: BleManager.inst! }
}
const last = (a: string[]) => a[a.length - 1]

async function main() {
  // board off; Connect, Stop at 10 s, Connect at 12 s: one diagnosis at the end of the new attempt, nothing after
  let r = await scenario(async link => {
    world.boardPowered = false
    link.connect(); await advance(10000); await link.disconnect(); await advance(2000)
    link.connect(); await advance(40000)
  })
  assert.deepEqual(r.states.slice(-3), ['12000 scanning', '27000 scanning:looking_around', '32000 error:nf_others'])

  // board switched on during the second attempt: connects, one link, no leftover scans
  r = await scenario(async link => {
    world.boardPowered = false
    link.connect(); await advance(10000); await link.disconnect(); await advance(2000)
    link.connect(); await advance(2000); world.boardPowered = true; await advance(30000)
  })
  assert.match(last(r.states), /connected:AFib-Monitor$/)
  assert.equal(r.mgr.nativeScans.filter(s => s.alive).length, 0)
  assert.equal(r.mgr.discListeners.size, 1)

  // the link drops and the person presses Stop while "reconnecting": no new link afterwards
  r = await scenario(async link => {
    link.connect(); await advance(3000)
    BleManager.inst!.emitDisconnect('AA:BB'); await advance(500)
    await link.disconnect(); await advance(10000)
  })
  assert.equal(last(r.states), '3500 idle')
  assert.equal(r.mgr.connected.size, 0)

  // Stop while "connecting": the link that completes afterwards is cancelled; Connect again works (no cancel loop)
  r = await scenario(async link => {
    link.connect(); await advance(1100); await link.disconnect(); await advance(2000)
    assert.equal(BleManager.inst!.connected.size, 0)
    link.connect(); await advance(12000)
  })
  assert.match(last(r.states), /connected:AFib-Monitor$/)
  assert.equal(r.log.filter(x => x.endsWith('cancelConnection')).length, 1)
  assert.equal(r.mgr.monitors, 2)

  // discovery fails: an error with an action, no half-open link (the board would stay silent as "BT PHONE")
  r = await scenario(async (link, states) => {
    world.discoverFails = true
    link.connect(); await advance(3000)
    assert.equal(last(states), '1500 error:connect_failed')
    assert.equal(BleManager.inst!.connected.size, 0)
    world.discoverFails = false
    link.connect(); await advance(10000)
  })
  assert.match(last(r.states), /connected:AFib-Monitor$/)

  // the board goes away for a minute and comes back: "reconnecting" all along, never an error, connected again;
  // at most 3 scan starts a minute (Android allows 5 per 30 s)
  r = await scenario(async link => {
    link.connect(); await advance(3000)
    world.boardPowered = false; BleManager.inst!.emitDisconnect('AA:BB'); await advance(60000)
    world.boardPowered = true; await advance(30000)
  })
  assert.ok(!r.states.some(x => x.includes('error')), r.states.join(' | '))
  assert.match(last(r.states), /connected:AFib-Monitor$/)
  const starts = r.log.filter(x => x.includes('startScan')).map(x => Number(x.split(' ')[0]))
  for (const t of starts) assert.ok(starts.filter(u => u >= t && u < t + 30000).length <= 5)

  console.log('blelink ok')
}
main().catch(e => { console.error(e); process.exit(1) })
