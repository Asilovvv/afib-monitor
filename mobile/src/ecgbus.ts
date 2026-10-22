import { ECG_FS, ECG_PER_PACKET, type EcgPacket } from './protocol'

/** Live ECG ring buffer, read by the waveform view without re-rendering the whole app.
 *  Lost Bluetooth packets are not simply skipped: that would glue the strip together, shorten the RR intervals around
 *  the hole and could turn a regular rhythm into an "irregular" one. Each lost packet keeps its place in time
 *  (filled with the last value, so the trace stays flat there) and is marked, so a check can refuse a strip with holes. */
export class EcgBus {
  readonly size = ECG_FS * 64          // 64 s: live trace, 10-s recordings and the 60-s Poincaré plot
  buf = new Float32Array(this.size)
  hole = new Uint8Array(this.size)     // 1 = sample stands in for a lost packet
  total = 0                 // samples placed in the timeline since start (received + filled)
  packets = 0
  lost = 0                  // lost packets
  private lastSeq = -1
  private subs = new Set<() => void>()
  /** Longest hole filled in place; a longer silence is a reconnect, not a hole in one strip. */
  static readonly MAX_FILL_PACKETS = Math.ceil((5 * ECG_FS) / ECG_PER_PACKET)

  private put(x: number, isHole: boolean) {
    const i = this.total % this.size
    this.buf[i] = x; this.hole[i] = isHole ? 1 : 0
    this.total++
  }

  push(p: EcgPacket) {
    if (this.lastSeq >= 0) {
      const gap = (p.seq - this.lastSeq - 1 + 65536) % 65536
      if (gap > 0 && gap < 1000) {
        this.lost += gap
        if (gap <= EcgBus.MAX_FILL_PACKETS) {
          const fill = this.total ? this.buf[(this.total - 1) % this.size] : 0
          for (let k = 0; k < gap * ECG_PER_PACKET; k++) this.put(fill, true)
        }
      }
    }
    this.lastSeq = p.seq
    for (const x of p.samples) this.put(x, false)
    this.packets++
    this.subs.forEach(f => f())
  }
  last(n: number): number[] {
    n = Math.min(n, this.total, this.size)
    const out = new Array<number>(n)
    for (let i = 0; i < n; i++) out[i] = this.buf[(this.total - n + i) % this.size]
    return out
  }
  /** Number of filled-in (missing) samples among the last n. */
  holes(n: number): number {
    n = Math.min(n, this.total, this.size)
    let h = 0
    for (let i = 0; i < n; i++) h += this.hole[(this.total - n + i) % this.size]
    return h
  }
  reset() { this.total = 0; this.packets = 0; this.lost = 0; this.lastSeq = -1; this.buf.fill(0); this.hole.fill(0) }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f) } }
}
