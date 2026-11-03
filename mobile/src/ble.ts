import { AppState, PermissionsAndroid, Platform } from 'react-native'
import { BleManager, State, type BleError, type Device, type Subscription } from 'react-native-ble-plx'
import { accept, diagnose, DIAG_KEY, scanErrorKey, type Seen } from './blediag'
import { base64ToBytes, DEVICE_NAME, ECG_UUID, parseEcg, parseStatus, SERVICE_UUID, STATUS_UUID, type EcgPacket, type Status } from './protocol'

export type LinkState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'error'

/** Finds the AFib-Monitor board over BLE, connects and streams status packets. */
export class DeviceLink {
  private manager: BleManager | null = null
  private device: Device | null = null
  private sub: Subscription | null = null
  private ecgSub: Subscription | null = null
  rssi: number | null = null
  name: string | null = null
  private discSub: Subscription | null = null
  private wantConnected = false
  /** Attempt number: every scan callback, timer and await checks it, so Stop and a new attempt silence the old one. */
  private gen = 0
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(
    private onStatus: (s: Status) => void,
    private onState: (s: LinkState, detail?: string) => void,
    private onEcg: (p: EcgPacket) => void = () => undefined,
  ) {}

  private get ble() {
    if (!this.manager) this.manager = new BleManager()
    return this.manager
  }

  private async permissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true
    const api = Number(Platform.Version)
    const perms = api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
    const res = await PermissionsAndroid.requestMultiple(perms)
    return Object.values(res).every(r => r === PermissionsAndroid.RESULTS.GRANTED)
  }

  /** iOS reports "Unknown" for a moment after the manager is created; scanning then fails. Wait until the radio
   *  is ready (up to 5 s) and turn the other states into messages the person can act on. */
  private async radioReady(): Promise<string | null> {
    const why = (st: State) => st === State.PoweredOn ? null : st === State.PoweredOff ? 'bt_off'
      : st === State.Unauthorized ? 'bt_unauthorized' : st === State.Unsupported ? 'bt_unsupported' : 'ble_error'
    let st = await this.ble.state()
    if (st === State.Unknown || st === State.Resetting) {
      st = await new Promise<State>(res => {
        let done = false
        const sub = this.ble.onStateChange(x => {
          if (x !== State.Unknown && x !== State.Resetting && !done) { done = true; sub.remove(); res(x) }
        }, true)
        setTimeout(() => { if (!done) { done = true; sub.remove(); res(State.Unknown) } }, 5000)
      })
    }
    return why(st)
  }

  private alive(gen: number) { return gen === this.gen && this.wantConnected }

  private later(fn: () => void, ms: number) { this.timers.push(setTimeout(fn, ms)) }

  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = [] }

  /** Connect to the board. `reconnect`: the link dropped by itself; then the app keeps looking (with the text
   *  "Связь потеряна, переподключаюсь…") until the board is back or the person presses Stop, and never diagnoses:
   *  with the phone locked a scan sees little, so a diagnosis would be wrong. */
  async connect(reconnect = false) {
    if (this.device) { this.onState('connected', this.name ?? DEVICE_NAME); return }   // already linked: nothing to do
    this.ble.stopDeviceScan(); this.clearTimers()
    const gen = ++this.gen
    this.wantConnected = true
    if (!(await this.permissions())) { if (this.alive(gen)) this.onState('error', 'no_permission'); return }
    const notReady = await this.radioReady()
    if (!this.alive(gen)) return
    if (notReady) { this.onState('error', notReady); return }
    // Already linked to this phone at the system level (iOS can keep a link): the board does not advertise then,
    // so a scan would never find it.
    const linked = await this.ble.connectedDevices([SERVICE_UUID]).catch(() => [] as Device[])
    if (!this.alive(gen)) return
    if (linked[0]) { await this.attach(linked[0], gen, reconnect); return }
    if (reconnect) this.onState('connecting', 'reconnecting'); else this.onState('scanning')
    let settled = false
    this.later(() => {
      if (!this.alive(gen) || settled) return
      settled = true
      this.ble.stopDeviceScan()
      if (reconnect) this.retry(gen)
      else if (AppState.currentState === 'active') this.explainNotFound(gen).catch(() => this.alive(gen) && this.onState('error', 'not_found'))
      else this.onState('error', 'not_found')
    }, 15000)
    this.ble.startDeviceScan([SERVICE_UUID], null, (err, dev) => {
      if (!this.alive(gen) || settled) return
      if (err) {
        settled = true; this.clearTimers(); console.warn('BLE scan', err.message)
        if (reconnect) this.retry(gen); else this.onState('error', scanErrorKey(err))
        return
      }
      if (!dev || !accept(dev)) return
      settled = true
      this.ble.stopDeviceScan(); this.clearTimers()
      this.attach(dev, gen, reconnect)
    })
  }

  /** After a dropped link: look again in 5 s (Android allows only a few scan starts per 30 s). */
  private retry(gen: number) {
    this.onState('connecting', 'reconnecting')
    this.later(() => { if (this.alive(gen)) this.connect(true) }, 5000)
  }

  /** The filtered scan found nothing in 15 s: look 5 s without a filter and tell the person what is wrong
   *  (mobile/src/blediag.ts), or connect if the board turns up after all. */
  private async explainNotFound(gen: number) {
    this.onState('scanning', 'looking_around')
    const seen = new Map<string, Device>()
    const failure = await new Promise<BleError | null>(res => {
      this.ble.startDeviceScan(null, null, (err, dev) => {
        if (err) { res(err); return }
        if (dev) seen.set(dev.id, dev)
      })
      this.later(() => res(null), 5000)
    })
    this.ble.stopDeviceScan()
    if (!this.alive(gen)) return
    if (failure) { this.onState('error', scanErrorKey(failure)); return }
    const { diagnosis, device } = diagnose([...seen.values()] as Seen[])
    if (diagnosis === 'found' && device?.id) { await this.attach(seen.get(device.id)!, gen, false); return }
    this.onState('error', diagnosis === 'found' ? 'not_found' : DIAG_KEY[diagnosis])
  }

  private async attach(dev: Device, gen: number, reconnect: boolean) {
    this.cleanup()
    const drop = () => this.ble.cancelDeviceConnection(dev.id).then(() => undefined, () => undefined)
    try {
      this.onState('connecting', reconnect ? 'reconnecting' : undefined)
      const d = await dev.connect({ timeout: 10000, requestMTU: Platform.OS === 'android' ? 185 : undefined })
      if (!this.alive(gen)) { await drop(); return }      // Stop was pressed while connecting
      await d.discoverAllServicesAndCharacteristics()
      if (!this.alive(gen)) { await drop(); return }
      this.rssi = dev.rssi; this.name = d.name ?? dev.localName ?? DEVICE_NAME
      this.device = d
      this.discSub = d.onDisconnected(() => {
        this.cleanup()
        if (!this.alive(gen)) return
        this.onState('connecting', 'reconnecting')
        this.later(() => { if (this.alive(gen)) this.connect(true) }, 2000)
      })
      this.sub = d.monitorCharacteristicForService(SERVICE_UUID, STATUS_UUID, (e, ch) => {
        if (e || !ch?.value) return
        const s = parseStatus(base64ToBytes(ch.value))
        if (s) this.onStatus(s)
      })
      this.ecgSub = d.monitorCharacteristicForService(SERVICE_UUID, ECG_UUID, (e, ch) => {
        if (e || !ch?.value) return
        const p = parseEcg(base64ToBytes(ch.value))
        if (p) this.onEcg(p)
      })
      this.onState('connected', d.name ?? DEVICE_NAME)
    } catch (e) {
      console.warn('BLE connect', (e as Error).message)
      this.cleanup()
      await drop()                                       // a half-open link would keep the board silent ("BT PHONE")
      if (!this.alive(gen)) return
      if (reconnect) this.retry(gen); else this.onState('error', 'connect_failed')
    }
  }

  async readRssi(): Promise<number | null> {
    if (!this.device) return null
    try { const d = await this.device.readRSSI(); this.rssi = d.rssi } catch { /* not connected */ }
    return this.rssi
  }

  async disconnect() {
    this.wantConnected = false
    this.gen++
    this.clearTimers()
    this.ble.stopDeviceScan()
    const d = this.device
    this.cleanup()
    if (d) await d.cancelConnection().catch(() => undefined)
    this.onState('idle')
  }

  private cleanup() {
    this.sub?.remove(); this.sub = null
    this.ecgSub?.remove(); this.ecgSub = null
    this.discSub?.remove(); this.discSub = null
    this.device = null
  }
}
