import { useEffect, useState } from 'react'
import {
  resolveBoogiepopSession,
  subscribeBoogiepopSession,
  type BoogiepopSessionSnapshot,
  type ResolveSessionOptions,
} from './index'

export function useBoogiepopSession(options?: ResolveSessionOptions) {
  const [snapshot, setSnapshot] = useState<BoogiepopSessionSnapshot>({
    user: null,
    roles: [],
    token: null,
    source: 'none',
    error: null,
  })
  const [isHydrating, setIsHydrating] = useState(true)

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | null = null

    async function refresh() {
      const resolved = await resolveBoogiepopSession(options)
      if (disposed) return
      setSnapshot(resolved)
      setIsHydrating(false)
    }

    async function wireBridge() {
      await refresh()
      const maybeUnsub = await subscribeBoogiepopSession(
        () => {
          void refresh()
        },
        options?.hostBridgeModuleId,
      )
      if (!disposed) unsubscribe = maybeUnsub
    }

    void wireBridge()

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [options])

  return { snapshot, isHydrating }
}
