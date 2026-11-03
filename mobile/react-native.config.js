// Native linking exceptions.
// react-native-purchases (RevenueCat, store subscriptions) is linked on iOS only when its public key is set for the
// build (EXPO_PUBLIC_RC_IOS): without the key src/billing.ts never loads it, and on the owner's Mac (October 2026)
// CocoaPods hung while downloading its pod, which stopped the whole iPhone build. Android always links it.
module.exports = {
  dependencies: {
    'react-native-purchases': process.env.EXPO_PUBLIC_RC_IOS ? {} : { platforms: { ios: null } },
  },
}
