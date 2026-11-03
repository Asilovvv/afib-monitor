import { PermissionsAndroid, Platform } from 'react-native'
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx'
import { accept, diagnose, DIAG_KEY, type Seen } from './blediag'
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

  async connect() {
    this.wantConnected = true
    if (!(await this.permissions())) { this.onState('error', 'no_permission'); return }
    const notReady = await this.radioReady()
    if (notReady) { this.onState('error', notReady); return }
    // Already linked to this phone (another screen, or iOS kept the link): the board does not advertise then,
    // so a scan would never find it.
    const linked = await this.ble.connectedDevices([SERVICE_UUID]).catch(() => [] as Device[])
    if (linked[0]) { await this.attach(linked[0]); return }
    this.onState('scanning')
    let done = false
    const timeout = setTimeout(() => {
      if (done) return
      done = true
      this.ble.stopDeviceScan()
      if (this.wantConnected && !this.device) this.explainNotFound().catch(() => this.onState('error', 'not_found'))
    }, 15000)
    this.ble.startDeviceScan([SERVICE_UUID], null, async (err, dev) => {
      if (done) return
      if (err) { done = true; clearTimeout(timeout); console.warn('BLE scan', err.message); this.onState('error', 'ble_error'); return }
      if (!dev || !accept(dev)) return
      done = true
      this.ble.stopDeviceScan(); clearTimeout(timeout)
      await this.attach(dev)
    })
  }

  /** The filtered scan found nothing in 15 s: look 5 s without a filter and tell the person what is wrong
   *  (mobile/src/blediag.ts), or connect if the board turns up after all. */
  private async explainNotFound() {
    this.onState('scanning', 'looking_around')
    const seen = new Map<string, Device>()
    await new Promise<void>(res => {
      this.ble.startDeviceScan(null, null, (err, dev) => {
        if (err) { res(); return }
        if (dev) seen.set(dev.id, dev)
      })
      setTimeout(() => { this.ble.stopDeviceScan(); res() }, 5000)
    })
    if (!this.wantConnected) return
    const { diagnosis, device } = diagnose([...seen.values()] as Seen[])
    if (diagnosis === 'found' && device?.id) { await this.attach(seen.get(device.id)!); return }
    this.onState('error', diagnosis === 'found' ? 'not_found' : DIAG_KEY[diagnosis])
  }

  private async attach(dev: Device) {
    try {
      this.onState('connecting')
      const d = await dev.connect({ timeout: 10000, requestMTU: Platform.OS === 'android' ? 185 : undefined })
      this.rssi = dev.rssi; this.name = d.name ?? dev.localName ?? DEVICE_NAME
      await d.discoverAllServicesAndCharacteristics()
      this.device = d
      this.discSub = d.onDisconnected(() => {
        this.cleanup()
        if (this.wantConnected) { this.onState('connecting', 'reconnecting'); setTimeout(() => this.connect(), 2000) }
        else this.onState('idle')
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
      this.onState('error', 'connect_failed')
    }
  }

  async readRssi(): Promise<number | null> {
    if (!this.device) return null
    try { const d = await this.device.readRSSI(); this.rssi = d.rssi } catch { /* not connected */ }
    return this.rssi
  }

  async disconnect() {
    this.wantConnected = false
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
