import { useEffect, useRef, useState } from 'react'
import {
  resolveBoogiepopSession,
  subscribeBoogiepopSession,
  validateToken,
  type BoogiepopSessionSnapshot,
  type ResolveSessionOptions,
} from './index'

// ─── useAuthGuard ─────────────────────────────────────────────────────────────

export interface AuthGuardOptions {
  /**
   * Valor que cambia en cada cambio de ruta (ej: `location.pathname`).
   * El guard re-valida el token cada vez que este valor cambia.
   * Sin dependencia de react-router — el consumer pasa lo que corresponda.
   */
  trigger?: unknown
  /** Token actual. Si es null/empty/mock, el guard no hace nada. */
  token: string | null
  /** Base URL del API (ej: `import.meta.env.VITE_API_BASE_URL`). */
  apiBaseUrl?: string | null
  /** Llamado cuando el token expira o el backend retorna 401/error. */
  onExpired: () => void
  /**
   * Llamado cuando /me responde OK — recibe los datos frescos del usuario.
   * Usar para actualizar roles, abilities y workspaces en el estado de la app.
   */
  onRefresh?: (me: import('./index').BoogiepopMePayload) => void
  /** Si true, skippea la validación (útil para deshabilitar en dev sin backend). */
  skip?: boolean
}

/**
 * Valida el token contra /api/auth/me en cada cambio de ruta y en el montaje.
 * Si el token expira o es inválido → llama onExpired().
 *
 * Uso:
 * ```tsx
 * const { isValidating } = useAuthGuard({
 *   trigger: location.pathname,   // de react-router
 *   token: session?.token ?? null,
 *   apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
 *   onExpired: logout,
 * })
 * ```
 */
export function useAuthGuard(options: AuthGuardOptions): { isValidating: boolean } {
  const [isValidating, setIsValidating] = useState(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const { token, apiBaseUrl, onExpired, skip } = optionsRef.current

    if (skip || !token || token.trim() === '' || token.startsWith('mock')) return

    let cancelled = false
    setIsValidating(true)

    validateToken(token, apiBaseUrl)
      .then((me) => {
        if (cancelled) return
        setIsValidating(false)
        optionsRef.current.onRefresh?.(me)
      })
      .catch(() => {
        if (!cancelled) {
          setIsValidating(false)
          onExpired()
        }
      })

    return () => {
      cancelled = true
      setIsValidating(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.trigger, options.token, options.skip])

  return { isValidating }
}

// ─── useBoogiepopSession ──────────────────────────────────────────────────────

export function useBoogiepopSession(options?: ResolveSessionOptions) {
  const [snapshot, setSnapshot] = useState<BoogiepopSessionSnapshot>({
    user: null,
    workspaces: [],
    roles: [],
    abilities: [],
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
        () => { void refresh() },
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
