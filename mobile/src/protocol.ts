/**
 * BLE protocol of the AFib Monitor (ESP32-S3 firmware, afib_main.cpp), all little-endian.
 *
 * STATUS  …0002  13 bytes, notify ~1/s and on every prediction
 *   u8 version=1 | u8 state | u16 prob*1000 | u16 bpm*10 | u32 t_ms | u16 infer_us | u8 battery %
 * ECG     …0003  46 bytes, notify every 20 samples (125 Hz → 6.25 packets/s)
 *   u16 seq | f32 scale | 20 × i16   (mV = i16 * scale)
 */
export const SERVICE_UUID = '8f1e0001-4b6a-4c5e-9a0b-3a1f2e7d0001'
export const STATUS_UUID = '8f1e0002-4b6a-4c5e-9a0b-3a1f2e7d0001'
export const ECG_UUID = '8f1e0003-4b6a-4c5e-9a0b-3a1f2e7d0001'
export const DEVICE_NAME = 'AFib-Monitor'
export const ECG_FS = 125
export const ECG_PER_PACKET = 20

export enum RhythmState { Collecting = 0, Normal = 1, AFib = 2, NoSignal = 3 }

export type Status = {
  state: RhythmState
  prob: number        // AFib probability 0..1
  bpm: number
  deviceMs: number    // device uptime, ms
  inferUs: number     // model inference time on the chip, µs
  battery: number | null
  at: number          // phone time when received, ms
}

export type EcgPacket = { seq: number; samples: number[] }

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function parseStatus(bytes: Uint8Array, at = Date.now()): Status | null {
  if (bytes.length < 12 || bytes[0] !== 1) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const state = v.getUint8(1)
  if (state > 3) return null
  const batt = bytes.length >= 13 ? v.getUint8(12) : 255
  return {
    state,
    prob: v.getUint16(2, true) / 1000,
    bpm: v.getUint16(4, true) / 10,
    deviceMs: v.getUint32(6, true),
    inferUs: v.getUint16(10, true),
    battery: batt <= 100 ? batt : null,
    at,
  }
}

export function parseEcg(bytes: Uint8Array): EcgPacket | null {
  if (bytes.length < 6 + 2 * ECG_PER_PACKET) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const seq = v.getUint16(0, true)
  const scale = v.getFloat32(2, true)
  if (!isFinite(scale) || scale <= 0) return null
  const samples: number[] = []
  for (let i = 0; i < ECG_PER_PACKET; i++) samples.push(v.getInt16(6 + 2 * i, true) * scale)
  return { seq, samples }
}

/** Builds packets (used by the simulator and the tests). */
export function encodeStatus(s: Omit<Status, 'at'>): Uint8Array {
  const b = new Uint8Array(13)
  const v = new DataView(b.buffer)
  v.setUint8(0, 1); v.setUint8(1, s.state)
  v.setUint16(2, Math.round(s.prob * 1000), true)
  v.setUint16(4, Math.round(s.bpm * 10), true)
  v.setUint32(6, s.deviceMs >>> 0, true)
  v.setUint16(10, Math.min(65535, s.inferUs), true)
  v.setUint8(12, s.battery ?? 255)
  return b
}

export function encodeEcg(seq: number, samples: number[]): Uint8Array {
  const b = new Uint8Array(6 + 2 * ECG_PER_PACKET)
  const v = new DataView(b.buffer)
  const peak = Math.max(1e-3, ...samples.map(Math.abs))
  const scale = peak / 32000
  v.setUint16(0, seq & 0xffff, true); v.setFloat32(2, scale, true)
  samples.slice(0, ECG_PER_PACKET).forEach((x, i) => v.setInt16(6 + 2 * i, Math.round(x / scale), true))
  return b
}
