import { SERVICE_UUID } from './protocol'

/** What a Bluetooth scan reports about one device (the fields of react-native-ble-plx's Device we use). */
export type Seen = { id?: string; name?: string | null; localName?: string | null; serviceUUIDs?: string[] | null }

/** Why the phone did not find the board after the normal scan, from a short scan without a filter:
 *  - found: the board is there after all (advertises our service): connect to it;
 *  - old_firmware: a device named AFib… without our service: firmware from before the BLE protocol, reflash;
 *  - nothing_nearby: the phone sees no Bluetooth device at all: the phone's Bluetooth is the problem;
 *  - others_only: other devices are seen, the board is not: it is off (a power bank may switch itself off at a low
 *    current), still starting, or already linked to another phone or laptop (one link at a time; the board then
 *    shows "BT PHONE" and stops advertising). docs/CONNECT.md lists the same cases for a person. */
export type Diagnosis = 'found' | 'old_firmware' | 'nothing_nearby' | 'others_only'

const named = (d: Seen) => [d.name, d.localName].some(n => !!n && n.toLowerCase().startsWith('afib'))

/** Advertises the AFib Monitor service (scan filters may report UUIDs in either case). */
export function isOurs(d: Seen): boolean {
  return (d.serviceUUIDs ?? []).some(u => u.toLowerCase() === SERVICE_UUID)
}

/** A device the filtered scan returned is ours unless it clearly names itself as something else. The phone may
 *  remember an old name for the board (iOS caches it) or show a shortened one, so the name alone never rejects
 *  a device that advertises our service. */
export function accept(d: Seen): boolean {
  if (isOurs(d) || named(d)) return true
  return !d.name && !d.localName
}

export function diagnose(seen: Seen[]): { diagnosis: Diagnosis; device?: Seen; count: number } {
  const ours = seen.find(isOurs)
  if (ours) return { diagnosis: 'found', device: ours, count: seen.length }
  const old = seen.find(named)
  if (old) return { diagnosis: 'old_firmware', device: old, count: seen.length }
  return { diagnosis: seen.length ? 'others_only' : 'nothing_nearby', count: seen.length }
}

/** Message key for the app (mobile/src/i18n.ts). */
export const DIAG_KEY: Record<Exclude<Diagnosis, 'found'>, 'nf_old' | 'nf_nothing' | 'nf_others'> = {
  old_firmware: 'nf_old', nothing_nearby: 'nf_nothing', others_only: 'nf_others',
}

