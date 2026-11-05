/** Upload queues to the server, one run at a time (used by src/store.tsx).
 *
 * The app starts an upload from several places: every 20 s, after an ECG recording, after "Check me", 5 s after an
 * AF onset. A free server takes up to a minute to wake up, so two uploads used to run side by side: both sent the
 * head of a queue, then both removed one item, and the second removal dropped an item that was never sent.
 * `singleFlight` lets only one run go; a call during a run asks for one more run after it, and its caller awaits
 * that run, so data queued just before the call is in it. `drain` removes exactly the item it sent.
 */

export type Queues<S, E, R> = { sym: S[]; ecg: E[]; readings: R[] }
export type Sender<S, E, R> = { symptom: (s: S) => Promise<unknown>; ecg: (e: E) => Promise<unknown>; upload: (r: R[]) => Promise<unknown> }

export const BATCH = 2000

/** Remove what was sent from the head. False if the head changed under us: then stop rather than send it again forever. */
function removeHead<T>(q: T[], sent: T[]): boolean {
  if (q.length < sent.length || !sent.every((x, i) => q[i] === x)) return false
  q.splice(0, sent.length)
  return true
}

/** Send everything queued, oldest first; stops at the first failure and keeps the rest.
 * Never throws: `sent` says whether anything went (also before a failure), `error` is the failure, if any. */
export async function drain<S, E, R>(q: Queues<S, E, R>, api: Sender<S, E, R>): Promise<{ sent: boolean; error: Error | null }> {
  let sent = false
  try {
    while (q.sym.length) { const s = q.sym[0]; await api.symptom(s); sent = true; if (!removeHead(q.sym, [s])) break }
    while (q.ecg.length) { const e = q.ecg[0]; await api.ecg(e); sent = true; if (!removeHead(q.ecg, [e])) break }
    while (q.readings.length) { const b = q.readings.slice(0, BATCH); await api.upload(b); sent = true; if (!removeHead(q.readings, b)) break }
    return { sent, error: null }
  } catch (e) {
    return { sent, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

/** One run at a time. A call during a run gets the next run (one for all such calls) and resolves when that run
 * ends, so it waits for at most the current run plus its own, even while a 20 s timer keeps calling. */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let running = false
  let next: { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } | null = null
  const start = (): Promise<void> => {
    running = true
    return (async () => {
      try { await run() } finally {
        running = false
        if (next) { const n = next; next = null; start().then(n.resolve, n.reject) }
      }
    })()
  }
  return () => {
    if (!running) return start()
    if (!next) {
      let resolve!: () => void, reject!: (e: unknown) => void
      const promise = new Promise<void>((a, b) => { resolve = a; reject = b })
      next = { promise, resolve, reject }
    }
    return next.promise
  }
}
