import { ECG_FS, ECG_PER_PACKET, RhythmState, type EcgPacket, type Status } from './protocol'

/**
 * Device simulator for demos without the board. Produces exactly what the firmware sends:
 * a status packet every second and a 20-sample ECG packet every 160 ms (125 Hz),
 * with a synthetic ECG whose rhythm follows the scenario: 8 s collecting → 70 s normal → 45 s AF → …
 */
const g = (t: number, c: number, a: number, w: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w))

export class Simulator {
  private statusTimer: ReturnType<typeof setInterval> | null = null
  private ecgTimer: ReturnType<typeof setInterval> | null = null
  private t0 = Date.now()
  private seq = 0
  private n = 0                  // samples generated
  private beatAt = 0             // time of the current beat, s
  private nextBeat = 0.85
  private rrs: number[] = []
  private battery = 87
  private wander = 0

  constructor(
    private onStatus: (s: Status) => void,
    private onEcg: (p: EcgPacket) => void,
    private cycle = { normal: 70, af: 45 },
  ) {}

  start() {
    this.stop()
    this.t0 = Date.now(); this.n = 0; this.seq = 0; this.beatAt = 0; this.nextBeat = 0.85; this.rrs = []
    this.statusTimer = setInterval(() => this.status(), 1000)
    this.ecgTimer = setInterval(() => this.ecg(), (1000 * ECG_PER_PACKET) / ECG_FS)
    this.status()
  }

  stop() {
    if (this.statusTimer) clearInterval(this.statusTimer)
    if (this.ecgTimer) clearInterval(this.ecgTimer)
    this.statusTimer = this.ecgTimer = null
  }

  get running() { return this.statusTimer !== null }

  /** Scenario state at elapsed time (s). */
  private phase(sec: number): RhythmState {
    if (sec < 8) return RhythmState.Collecting
    const p = (sec - 8) % (this.cycle.normal + this.cycle.af)
    return p < this.cycle.normal ? RhythmState.Normal : RhythmState.AFib
  }

  private status() {
    const sec = (Date.now() - this.t0) / 1000
    const state = this.phase(sec)
    this.battery = Math.max(5, this.battery - 1 / 600)
    const mean = this.rrs.length ? this.rrs.reduce((a, b) => a + b, 0) / this.rrs.length : 0.85
    const af = state === RhythmState.AFib
    this.onStatus({
      state,
      prob: state === RhythmState.Collecting ? 0 : af ? 0.86 + Math.random() * 0.13 : Math.random() * 0.08,
      bpm: state === RhythmState.Collecting ? 0 : Math.round((600 / mean)) / 10,
      deviceMs: Date.now() - this.t0,
      inferUs: state === RhythmState.Collecting ? 0 : 880 + Math.round(Math.random() * 160),
      battery: Math.round(this.battery),
      at: Date.now(),
    })
  }

  private ecg() {
    const out: number[] = []
    for (let k = 0; k < ECG_PER_PACKET; k++) {
      const t = this.n / ECG_FS
      const af = this.phase(t) === RhythmState.AFib
      if (t >= this.beatAt + this.nextBeat) {
        this.beatAt += this.nextBeat
        this.rrs.push(this.nextBeat); if (this.rrs.length > 8) this.rrs.shift()
        this.nextBeat = af ? 0.4 + Math.random() * 0.55 : 0.84 + (Math.random() - 0.5) * 0.05
      }
      const dt = t - this.beatAt
      const tt = dt < this.nextBeat - 0.25 ? dt : dt - this.nextBeat     // nearest beat
      let v = g(tt, 0, 1.2, 0.012) + g(tt, -0.025, -0.15, 0.009) + g(tt, 0.028, -0.3, 0.011) + g(tt, 0.26, 0.32, 0.045)
      if (!af) v += g(tt, -0.17, 0.15, 0.025)
      else v += 0.06 * Math.sin(2 * Math.PI * 6.2 * t) + 0.03 * Math.sin(2 * Math.PI * 4.1 * t + 1)
      this.wander = 0.995 * this.wander + 0.005 * (Math.random() - 0.5)
      v += 0.08 * Math.sin(2 * Math.PI * 0.25 * t) + this.wander + 0.012 * (Math.random() - 0.5)
      out.push(v)
      this.n++
    }
    this.onEcg({ seq: this.seq++ & 0xffff, samples: out })
  }
}
