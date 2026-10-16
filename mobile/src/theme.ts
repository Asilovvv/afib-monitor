import { RhythmState } from './protocol'

/** Same palette as the doctor portal: warm "paper" light theme and deep "ink" dark theme. */
export const light = {
  dark: false,
  bg: '#f3f0ea', bg2: '#ebe6dd', card: '#fffdf9', line: '#e4ddd1', track: '#efe9df',
  ink: '#16151a', ink2: '#47444d', ink3: '#8c8792',
  accent: '#1d5bd8', accentSoft: '#e3ebfd',
  af: '#e0433f', afInk: '#c0201d', afSoft: '#fde7e5',
  ok: '#138a4a', okSoft: '#cfeedd', warn: '#d9930f', warnSoft: '#fbf0d6',
  wait: '#6f6a75', waitSoft: '#ece8e1',
  paper: '#fff7f4', gridMinor: '#f7d6cf', gridMajor: '#eba79b',
  trace: '#16151a', primaryText: '#fffdf9',
}
export type Theme = typeof light

export const dark: Theme = {
  dark: true,
  bg: '#0b0d12', bg2: '#10131a', card: '#13161e', line: '#252a36', track: '#1c202a',
  ink: '#eceaf1', ink2: '#b4b1bc', ink3: '#7c7987',
  accent: '#6d9cff', accentSoft: '#1a2643',
  af: '#ff5d57', afInk: '#ff7a74', afSoft: '#3a1717',
  ok: '#3ddc84', okSoft: '#173b28', warn: '#f2b33d', warnSoft: '#3a2c10',
  wait: '#9f9ba8', waitSoft: '#22252e',
  paper: '#07090d', gridMinor: '#141a22', gridMajor: '#1f2833',
  trace: '#38f2b0', primaryText: '#0b0d12',
}

export const F = {
  display: 'Unbounded_600SemiBold',
  displayBold: 'Unbounded_700Bold',
  body: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semi: 'IBMPlexSans_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
}

export function stateTone(t: Theme, s: RhythmState | undefined | null) {
  switch (s) {
    case RhythmState.Normal: return { fg: t.ok, soft: t.okSoft, key: 'st_normal' as const }
    case RhythmState.AFib: return { fg: t.af, soft: t.afSoft, key: 'st_afib' as const }
    case RhythmState.NoSignal: return { fg: t.warn, soft: t.warnSoft, key: 'st_nosignal' as const }
    default: return { fg: t.wait, soft: t.waitSoft, key: 'st_collecting' as const }
  }
}
