/* Uploads to the server, one at a time (mobile/src/sync.ts). Run: npx -y tsx@4.19.2 tools/mobile/sync_test.ts */
import assert from 'node:assert/strict'
import { BATCH, drain, singleFlight, type Queues } from '../../mobile/src/sync'

type Item = { id: string }
const tick = () => new Promise<void>(r => setTimeout(r, 0))

/** A server that answers each request only when the test says so (a server waking up takes up to a minute). */
function slowServer() {
  const got: string[] = []
  const waiting: (() => void)[] = []
  let failNext = false
  const req = (ids: string[]) => new Promise<void>((resolve, reject) => {
    got.push(...ids)
    waiting.push(() => { if (failNext) { failNext = false; reject(new Error('timeout')) } else resolve() })
  })
  return {
    got, failNext: () => { failNext = true },
    async answerAll() { while (waiting.length) { waiting.shift()!(); await tick() } },
    async answerOne() { waiting.shift()!(); await tick() },
    api: { symptom: (s: Item) => req([s.id]), ecg: (e: Item) => req([e.id]), upload: (r: Item[]) => req(r.map(x => x.id)) },
  }
}
const queues = (): Queues<Item, Item, Item> => ({
  sym: [{ id: 's1' }, { id: 's2' }], ecg: [{ id: 'e1' }, { id: 'e2' }], readings: [{ id: 'r1' }, { id: 'r2' }],
})
const ALL = ['s1', 's2', 'e1', 'e2', 'r1', 'r2']

async function main() {
  // the failure this module exists for: two uploads side by side, as the app ran them before
  {
    const srv = slowServer(), q = queues()
    const a = drain(q, srv.api), b = drain(q, srv.api)
    await srv.answerAll(); await Promise.all([a, b])
    const lost = ALL.filter(id => !srv.got.includes(id))
    assert.ok(lost.length > 0 || srv.got.length > ALL.length, 'two unguarded uploads send something twice or lose it')
  }

  // the same calls through singleFlight: every item exactly once, nothing left, in order
  {
    const srv = slowServer(), q = queues()
    const sync = singleFlight(async () => { await drain(q, srv.api) })
    const a = sync(), b = sync(), c = sync()
    for (let i = 0; i < 20; i++) await srv.answerAll()
    await Promise.all([a, b, c])
    assert.deepEqual(srv.got, ALL)
    assert.deepEqual([q.sym.length, q.ecg.length, q.readings.length], [0, 0, 0])
  }

  // an ECG recorded during a run is in the run that the caller awaits (the app then says "sent", not "saved on phone")
  {
    const srv = slowServer(), q = queues()
    const sync = singleFlight(async () => { await drain(q, srv.api) })
    const first = sync()
    await tick()
    q.ecg.push({ id: 'e3' })
    const mine = sync()
    for (let i = 0; i < 20; i++) await srv.answerAll()
    await mine
    assert.ok(srv.got.includes('e3') && q.ecg.length === 0)
    await first
    assert.equal(srv.got.filter(x => x === 'e3').length, 1)
  }

  // a failure keeps the rest, reports what went before it, and a later run resumes: only the failed item goes twice
  {
    const srv = slowServer(), q = queues()
    const run = drain(q, srv.api)
    await srv.answerOne()          // s1 accepted; s2 is on its way
    srv.failNext()
    await srv.answerOne()          // s2 times out
    const r = await run
    assert.ok(r.sent && r.error instanceof Error && r.error.message === 'timeout')
    assert.deepEqual(q.sym.map(x => x.id), ['s2'])
    const again = drain(q, srv.api)
    for (let i = 0; i < 20; i++) await srv.answerAll()
    assert.equal((await again).error, null)
    assert.deepEqual(srv.got, ['s1', 's2', 's2', 'e1', 'e2', 'r1', 'r2'])
  }

  // readings go in batches of BATCH
  {
    const sizes: number[] = []
    const q: Queues<Item, Item, Item> = { sym: [], ecg: [], readings: Array.from({ length: BATCH * 2 + 5 }, (_, i) => ({ id: 'r' + i })) }
    const r = await drain(q, { symptom: async () => undefined, ecg: async () => undefined, upload: async b => { sizes.push(b.length) } })
    assert.deepEqual(sizes, [BATCH, BATCH, 5]); assert.equal(q.readings.length, 0); assert.ok(r.sent)
  }

  // nothing queued: nothing sent, no error
  assert.deepEqual(await drain({ sym: [], ecg: [], readings: [] }, slowServer().api), { sent: false, error: null })

  // a run that throws does not leave singleFlight stuck
  {
    let n = 0
    const sync = singleFlight(async () => { n++; if (n === 1) throw new Error('x') })
    await sync().catch(() => undefined)
    await sync()
    assert.equal(n, 2)
  }
  // a 20 s timer keeps calling while every run is slow (server asleep): a caller still gets its answer after its run
  {
    let runs = 0
    const ends: (() => void)[] = []
    const sync = singleFlight(() => { runs++; return new Promise<void>(r => ends.push(r)) })
    sync()                                   // run 1 (the timer)
    let mineDone = false
    const mine = sync().then(() => { mineDone = true })   // the symptom sheet: waits for run 2
    ends.shift()!(); await tick(); await tick()           // run 1 ends, run 2 starts
    sync()                                   // the timer again, during run 2: asks for run 3
    ends.shift()!(); await tick(); await tick()           // run 2 ends
    await Promise.race([mine, new Promise(r => setTimeout(r, 200))])
    assert.ok(mineDone && runs === 3, 'the caller is not held by runs after its own')
    ends.shift()!(); await tick()
  }
  console.log('sync: ok')
}
main().catch(e => { console.error(e); process.exit(1) })
