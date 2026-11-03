export const Platform = { OS: 'android' as string, Version: 33 }
export const PermissionsAndroid = {
  PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
  RESULTS: { GRANTED: 'granted' },
  requestMultiple: async (p: string[]) => Object.fromEntries(p.map(x => [x, 'granted'])),
}
export const AppState = { currentState: 'active' as string }
