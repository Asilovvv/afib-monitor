import { Platform } from 'react-native'

/** Store subscriptions ("Family") through RevenueCat, which talks to App Store / Google Play and sends renewals and
 *  cancellations to our server (/api/billing/revenuecat). The server is the only source of truth for the plan: the app
 *  never unlocks anything on its own after a purchase, it re-reads /api/me/plan.
 *
 *  Off until the keys exist. EXPO_PUBLIC_RC_IOS / EXPO_PUBLIC_RC_ANDROID are RevenueCat *public* SDK keys (safe in the
 *  app binary by design); secret keys and the webhook secret live only on the server. Without keys every function here
 *  says "not available" and the screen shows the price with a "coming soon" note. No dark patterns: cancelling is the
 *  phone's own subscription settings, one tap away (manageUrl). */
const KEY = Platform.select({ ios: process.env.EXPO_PUBLIC_RC_IOS, android: process.env.EXPO_PUBLIC_RC_ANDROID }) ?? ''
export const ENTITLEMENT = 'family'
export type Offer = { id: string; period: 'month' | 'year'; price: string }   // price: localized string from the store

let ready = false
function rc(): typeof import('react-native-purchases').default | null {
  if (!KEY || Platform.OS === 'web') return null
  try { return require('react-native-purchases').default } catch { return null }
}

export function billingAvailable() { return !!rc() }

/** Call after login with our numeric user id, so the webhook can find the account. */
export async function billingLogin(userId: number) {
  const P = rc(); if (!P) return
  try {
    if (!ready) { P.configure({ apiKey: KEY, appUserID: String(userId) }); ready = true }
    else await P.logIn(String(userId))
  } catch { /* store unreachable: the screen falls back to prices only */ }
}

export async function billingLogout() {
  const P = rc(); if (!P || !ready) return
  try { await P.logOut() } catch { /* ignore */ }
}

export async function offers(): Promise<Offer[]> {
  const P = rc(); if (!P || !ready) return []
  try {
    const o = await P.getOfferings()
    const pk = o.current?.availablePackages ?? []
    return pk.map(p => ({ id: p.identifier, period: /annual|year/i.test(p.packageType) ? 'year' as const : 'month' as const, price: p.product.priceString }))
  } catch { return [] }
}

/** Returns true when the store confirmed the purchase; the caller then re-reads the plan from the server. */
export async function buy(offerId: string): Promise<'ok' | 'cancelled' | 'error'> {
  const P = rc(); if (!P || !ready) return 'error'
  try {
    const o = await P.getOfferings()
    const pk = o.current?.availablePackages.find(p => p.identifier === offerId)
    if (!pk) return 'error'
    const r = await P.purchasePackage(pk)
    return r.customerInfo.entitlements.active[ENTITLEMENT] ? 'ok' : 'error'
  } catch (e) { return (e as { userCancelled?: boolean }).userCancelled ? 'cancelled' : 'error' }
}

export async function restore(): Promise<boolean> {
  const P = rc(); if (!P || !ready) return false
  try { const info = await P.restorePurchases(); return !!info.entitlements.active[ENTITLEMENT] } catch { return false }
}

/** Where to cancel: the phone's own subscription page (Apple / Google), never a form of ours. */
export function manageUrl() {
  return Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions'
}
