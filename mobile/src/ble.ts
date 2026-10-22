import { PermissionsAndroid, Platform } from 'react-native'
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx'
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
    this.onState('scanning')
    const timeout = setTimeout(() => {
      this.ble.stopDeviceScan()
      if (!this.device) this.onState('error', 'not_found')
    }, 15000)
    this.ble.startDeviceScan([SERVICE_UUID], null, async (err, dev) => {
      if (err) { clearTimeout(timeout); console.warn('BLE scan', err.message); this.onState('error', 'ble_error'); return }
      if (!dev || (dev.name && dev.name !== DEVICE_NAME && dev.localName !== DEVICE_NAME)) return
      this.ble.stopDeviceScan(); clearTimeout(timeout)
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
        this.onState('error', 'ble_error')
      }
    })
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
