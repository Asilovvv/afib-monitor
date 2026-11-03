// Minimal model of react-native-ble-plx 3.5.1 (JS layer + Android native semantics: connectToDevice cancels an existing
// link first, connectedDevices lists only links with discovered services, a new scan does not stop the old native one)
// on a virtual clock, for tools/mobile/blelink_test.ts. The world: the board (AFib-Monitor, our service) and a watch.
import { Platform } from './fake_rn'

// ---------------- virtual clock
type T = { id: number; at: number; fn: () => void }
let now = 0, seq = 0
const timers: T[] = []
const realSetImmediate = setImmediate
;(globalThis as any).setTimeout = (fn: () => void, ms = 0) => { const t = { id: ++seq, at: now + ms, fn }; timers.push(t); return t.id }
;(globalThis as any).clearTimeout = (id: number) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
export const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => realSetImmediate(r)) }
export async function advance(ms: number) {
  const end = now + ms
  await flush()
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id)
    const t = timers[0]
    if (!t || t.at > end) break
    timers.shift(); now = t.at; t.fn(); await flush()
  }
  now = end
}
export const clock = () => now
/** Fresh clock, world and manager for the next scenario. */
export function reset() {
  now = 0; seq = 0; timers.length = 0
  Object.assign(world, { boardPowered: true, boardConnected: false, discoverFails: false, log: [] })
  BleManager.inst = null
}

// ---------------- world
export const SERVICE = '8f1e0001-4b6a-4c5e-9a0b-3a1f2e7d0001'
export const world = {
  boardPowered: true, boardConnected: false, discoverFails: false,
  log: [] as string[],
}
const BOARD = { id: 'AA:BB', name: 'AFib-Monitor', localName: 'AFib-Monitor', serviceUUIDs: [SERVICE], rssi: -60 }
const WATCH = { id: 'WW:WW', name: 'Mi Band 8', localName: null, serviceUUIDs: ['0000fee0-0000-1000-8000-00805f9b34fb'], rssi: -50 }

export enum State { Unknown = 'Unknown', Resetting = 'Resetting', Unsupported = 'Unsupported', Unauthorized = 'Unauthorized', PoweredOff = 'PoweredOff', PoweredOn = 'PoweredOn' }
export type Subscription = { remove(): void }

type Listener = (e: any, d: any) => any
export class BleManager {
  static inst: BleManager | null = null
  _scanEventSubscription: Subscription | null = null
  scanListeners = new Set<Listener>()      // EventEmitter listeners for ScanEvent
  nativeScans: { filter: string[] | null; alive: boolean }[] = []
  currentNative: { filter: string[] | null; alive: boolean } | null = null
  connected = new Map<string, { services: boolean }>()   // Android module's connectedDevices
  discListeners = new Set<{ id: string; fn: Listener }>()
  monitors = 0
  constructor() { if (BleManager.inst) return BleManager.inst; BleManager.inst = this; this.tick() }
  private tick() {
    setTimeout(() => {
      for (const s of this.nativeScans.filter(s => s.alive)) {
        const devs = [WATCH, ...(world.boardPowered && !world.boardConnected ? [BOARD] : [])]
        for (const d of devs) {
          if (s.filter && !d.serviceUUIDs.some(u => s.filter!.includes(u))) continue
          for (const l of [...this.scanListeners]) l(null, new Device({ ...d }, this))
        }
      }
      this.tick()
    }, 1000)
  }
  async state() { return State.PoweredOn }
  onStateChange(fn: (s: State) => void, emit = false) { if (emit) this.state().then(fn); return { remove() {} } }
  async startDeviceScan(uuids: string[] | null, _o: any, listener: Listener) {
    // JS: overwrites _scanEventSubscription without removing the old one (BleManager.js:376)
    this.scanListeners.add(listener)
    this._scanEventSubscription = { remove: () => this.scanListeners.delete(listener) }
    // Android native: overwrites scanSubscription without disposing the old one (BleModule.java:1198)
    const s = { filter: uuids, alive: true }
    if (Platform.OS !== 'android' && this.currentNative) this.currentNative.alive = false
    this.nativeScans.push(s); this.currentNative = s
    world.log.push(`${now} startScan(${uuids ? 'filtered' : 'ALL'})`)
  }
  async stopDeviceScan() {
    this._scanEventSubscription?.remove(); this._scanEventSubscription = null
    if (this.currentNative) { this.currentNative.alive = false; this.currentNative = null }
    world.log.push(`${now} stopScan`)
  }
  async connectedDevices(_u: string[]) {
    return [...this.connected.entries()].filter(([, v]) => v.services).map(([id]) => new Device({ ...BOARD, id, rssi: null }, this))
  }
  async isDeviceConnected(id: string) { return this.connected.has(id) }
  emitDisconnect(id: string) {
    this.connected.delete(id); world.boardConnected = false
    for (const l of [...this.discListeners]) if (l.id === id) l.fn(null, { id })
  }
  async cancelDeviceConnection(id: string) {
    if (!this.connected.has(id)) throw new Error('not connected')
    world.log.push(`${now} cancelConnection`)
    this.emitDisconnect(id)
  }
  async connectToDevice(id: string, _o: any) {
    if (Platform.OS === 'android' && (await this.isDeviceConnected(id))) await this.cancelDeviceConnection(id)
    await new Promise(r => setTimeout(r, 300))
    if (!world.boardPowered) throw new Error('timeout')
    this.connected.set(id, { services: false }); world.boardConnected = true
    world.log.push(`${now} CONNECTED`)
    return new Device({ ...BOARD, id }, this)
  }
}

export class Device {
  id!: string; name!: string | null; localName!: string | null; rssi!: number | null; serviceUUIDs!: string[] | null
  constructor(n: any, private m: BleManager) { Object.assign(this, n) }
  connect(o?: any) { return this.m.connectToDevice(this.id, o) }
  async discoverAllServicesAndCharacteristics() {
    await new Promise(r => setTimeout(r, 200))
    if (world.discoverFails) throw new Error('GATT 133')
    const c = this.m.connected.get(this.id); if (c) c.services = true
    return this
  }
  onDisconnected(fn: Listener) { const e = { id: this.id, fn }; this.m.discListeners.add(e); return { remove: () => this.m.discListeners.delete(e) } }
  monitorCharacteristicForService(_s: string, _c: string, _fn: Listener) { this.m.monitors++; return { remove: () => { this.m.monitors-- } } }
  cancelConnection() { return this.m.cancelDeviceConnection(this.id) }
  async readRSSI() { return this }
}
