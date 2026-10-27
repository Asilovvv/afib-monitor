import { Linking } from 'react-native'
import { parseJoin, type Join } from './joinlink'

/** Subscribe to incoming links (cold start + while running). Returns an unsubscribe. */
export function watchJoinLinks(on: (j: Join) => void): () => void {
  Linking.getInitialURL().then(u => { const j = parseJoin(u); if (j) on(j) }).catch(() => undefined)
  const sub = Linking.addEventListener('url', e => { const j = parseJoin(e.url); if (j) on(j) })
  return () => sub.remove()
}
