export type BoogiepopFunctionalAbility = {
  name: string
  description: string | null
}

export type BoogiepopRole = {
  id: string
  name: string
  type: 'global' | 'app'
  applicationId: string | null
  abilities: BoogiepopFunctionalAbility[]
}

export type BoogiepopMePayload = {
  userId?: string
  email: string
  name?: string
  workspaces: string[]
  roles: BoogiepopRole[]
  abilities: BoogiepopFunctionalAbility[]
}

export type BoogiepopUser = {
  id: string
  name: string
  email: string
}

export type BoogiepopSessionSnapshot = {
  user: BoogiepopUser | null
  workspaces: string[]
  roles: BoogiepopRole[]
  abilities: BoogiepopFunctionalAbility[]
  token: string | null
  source: 'host-bridge' | 'token+me' | 'none'
  error: string | null
}

type HostBridgeSnapshot = {
  user: BoogiepopUser | null
  workspaces?: string[]
  /** Alias legacy del host bridge (`groups` en runtime). */
  groups?: string[]
  roles?: BoogiepopRole[]
  abilities?: BoogiepopFunctionalAbility[]
  token: string | null
}

type HostBridgeModule = {
  getHostAuthSnapshot: () => Readonly<HostBridgeSnapshot>
  subscribeHostAuth?: (listener: () => void) => () => void
}

// ─── Anonymous session (base user sin auth) ───────────────────────────────────

/**
 * Sesión base cuando no hay token.
 * Todos los checks `hasRole()`, `hasAbility()`, etc. retornan false.
 * Usar como valor por defecto en lugar de null para evitar null checks.
 */
export const ANONYMOUS_SESSION: Readonly<BoogiepopSessionSnapshot> = Object.freeze({
  user:       null,
  workspaces: [],
  roles:      [],
  abilities:  [],
  token:      null,
  source:     'none' as const,
  error:      null,
})

// ─── JWT decode (sin verificación de firma) ───────────────────────────────────

interface JwtPayload {
  sub?:        string
  email?:      string
  name?:       string
  username?:   string
  workspaces?: string[]
  exp?:        number
  [key: string]: unknown
}

/**
 * Decodifica el payload de un JWT sin verificar la firma.
 * Solo para lectura de claims en cliente — la validación real la hace el backend via /me.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, '=')

    return JSON.parse(atob(base64)) as JwtPayload
  } catch {
    return null
  }
}

function isJwtExpired(payload: JwtPayload): boolean {
  if (typeof payload.exp !== 'number') return false
  return Date.now() / 1000 > payload.exp
}

/**
 * Construye una `BoogiepopSessionSnapshot` a partir del JWT almacenado en el browser.
 * - Si no hay token o el token es inválido/expirado → retorna `ANONYMOUS_SESSION`.
 * - Si hay token → decodifica el payload y construye la sesión sin llamar a la red.
 *
 * `useAuthGuard` valida el token contra /me en cada cambio de ruta.
 */
export function resolveSessionFromJwt(
  token: string | null | undefined,
  storageKey = 'bp:auth:token',
): BoogiepopSessionSnapshot {
  const resolvedToken =
    token?.trim() ??
    (typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey)?.trim() : null) ??
    null

  if (!resolvedToken) return { ...ANONYMOUS_SESSION }

  const payload = decodeJwtPayload(resolvedToken)
  if (!payload || isJwtExpired(payload)) return { ...ANONYMOUS_SESSION }

  const userId = (payload.sub ?? payload.userId as string | undefined)?.trim()
  const email  = (payload.email ?? '').trim()
  const name   = (payload.name ?? payload.username ?? deriveNameFromEmail(email)).trim()

  return {
    user:       userId && email ? { id: userId, name, email } : null,
    workspaces: (payload.workspaces as string[] | undefined) ?? [],
    roles:      [],        // los roles los provee /me — no se embeben en el JWT por tamaño
    abilities:  [],
    token:      resolvedToken,
    source:     'token+me' as const,
    error:      null,
  }
}

export type ResolveSessionOptions = {
  token?: string | null
  apiBaseUrl?: string | null
  tokenQueryParamKey?: string
  tokenStorageKey?: string
  hostBridgeModuleId?: string
  fetchImpl?: typeof fetch
  /** Token de desarrollo local. Pasarlo desde la env var del framework (ej: import.meta.env.VITE_DEV_TOKEN).
   *  Tiene menor prioridad que un token real en sessionStorage. Solo aplica si no hay otro token. */
  devToken?: string | null
}

const defaultSnapshot: BoogiepopSessionSnapshot = {
  user: null,
  workspaces: [],
  roles: [],
  abilities: [],
  token: null,
  source: 'none',
  error: null,
}

function deriveNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user'
  return local.trim() || 'user'
}

function normalizeBase(value: string): string {
  return value.replace(/\/$/, '')
}

function resolveApiBase(explicit?: string | null): string | null {
  const chosen = explicit?.trim()
  if (chosen) return normalizeBase(chosen)
  if (typeof window !== 'undefined') return normalizeBase(window.location.origin)
  return null
}

function readTokenFromBrowser(queryKey: string, storageKey: string): string | null {
  if (typeof window === 'undefined') return null
  const fromQuery = new URLSearchParams(window.location.search).get(queryKey)?.trim()
  if (fromQuery) return fromQuery
  const fromStorage = window.sessionStorage.getItem(storageKey)?.trim()
  return fromStorage || null
}

async function fetchAuthMe(
  token: string,
  apiBaseUrl: string,
  fetchImpl: typeof fetch,
): Promise<BoogiepopMePayload> {
  const response = await fetchImpl(`${apiBaseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`No se pudo leer /api/auth/me (${response.status})`)
  }
  return response.json() as Promise<BoogiepopMePayload>
}

async function loadHostBridge(moduleId: string): Promise<HostBridgeModule | null> {
  try {
    const mod = (await import(/* @vite-ignore */ moduleId)) as Partial<HostBridgeModule>
    if (typeof mod?.getHostAuthSnapshot !== 'function') return null
    return {
      getHostAuthSnapshot: mod.getHostAuthSnapshot,
      subscribeHostAuth: mod.subscribeHostAuth,
    }
  } catch {
    return null
  }
}

function fromHostBridge(snapshot: HostBridgeSnapshot): BoogiepopSessionSnapshot {
  return {
    user: snapshot.user ?? null,
    workspaces: snapshot.workspaces ?? snapshot.groups ?? [],
    roles: snapshot.roles ?? [],
    abilities: snapshot.abilities ?? [],
    token: snapshot.token ?? null,
    source: 'host-bridge',
    error: null,
  }
}

export async function resolveBoogiepopSession(
  options?: ResolveSessionOptions,
): Promise<BoogiepopSessionSnapshot> {
  const tokenQueryParamKey = options?.tokenQueryParamKey?.trim() || 'bpToken'
  const tokenStorageKey = options?.tokenStorageKey?.trim() || 'boogiepop:auth:token'
  const hostBridgeModuleId = options?.hostBridgeModuleId?.trim() || 'boogiepop_host/host-auth'
  const fetchImpl = options?.fetchImpl ?? fetch

  let baseSnapshot: BoogiepopSessionSnapshot = { ...defaultSnapshot }
  const bridge = await loadHostBridge(hostBridgeModuleId)
  if (bridge) {
    baseSnapshot = fromHostBridge(bridge.getHostAuthSnapshot())
  }

  const token =
    options?.token?.trim() ??
    baseSnapshot.token ??
    readTokenFromBrowser(tokenQueryParamKey, tokenStorageKey) ??
    options?.devToken?.trim() ??
    null

  if (!token) return baseSnapshot
  if (token.startsWith('mock')) return { ...baseSnapshot, token }

  const apiBaseUrl = resolveApiBase(options?.apiBaseUrl)
  if (!apiBaseUrl) {
    return { ...baseSnapshot, token, error: 'Base URL no configurada para /api/auth/me' }
  }

  try {
    const me = await fetchAuthMe(token, apiBaseUrl, fetchImpl)
    return {
      user: {
        id: me.userId ?? baseSnapshot.user?.id ?? 'unknown',
        name: me.name ?? baseSnapshot.user?.name ?? deriveNameFromEmail(me.email),
        email: me.email,
      },
      workspaces: me.workspaces ?? baseSnapshot.workspaces,
      roles: me.roles ?? baseSnapshot.roles,
      abilities: me.abilities ?? baseSnapshot.abilities,
      token,
      source: baseSnapshot.source === 'host-bridge' ? 'host-bridge' : 'token+me',
      error: null,
    }
  } catch (error) {
    return {
      ...baseSnapshot,
      token,
      error: error instanceof Error ? error.message : 'Fallo resolviendo sesión',
    }
  }
}

export async function subscribeBoogiepopSession(
  listener: () => void,
  hostBridgeModuleId = 'boogiepop_host/host-auth',
): Promise<(() => void) | null> {
  const bridge = await loadHostBridge(hostBridgeModuleId)
  if (!bridge || typeof bridge.subscribeHostAuth !== 'function') return null
  return bridge.subscribeHostAuth(listener)
}

export function hasWorkspace(
  snapshot: Pick<BoogiepopSessionSnapshot, 'workspaces'> | null | undefined,
  expected: string,
): boolean {
  const normalized = expected.trim().toLowerCase()
  if (!normalized) return false
  return (snapshot?.workspaces ?? []).some((w) => w.trim().toLowerCase() === normalized)
}

export function hasRole(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles'> | null | undefined,
  roleName: string,
  applicationId?: string,
): boolean {
  const normalized = roleName.trim().toLowerCase()
  if (!normalized) return false
  return (snapshot?.roles ?? []).some(
    (r) =>
      r.name.trim().toLowerCase() === normalized &&
      (applicationId === undefined || r.applicationId === applicationId),
  )
}

export function hasAnyRole(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles'> | null | undefined,
  roleNames: string[] | null | undefined,
  applicationId?: string,
): boolean {
  const expected = (roleNames ?? []).filter((r) => r.trim().length > 0)
  if (!expected.length) return true
  return expected.some((r) => hasRole(snapshot, r, applicationId))
}

export function hasAbility(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles' | 'abilities'> | null | undefined,
  abilityName: string,
  applicationId?: string,
): boolean {
  const normalized = abilityName.trim().toLowerCase()
  if (!normalized) return false

  // Direct ability
  const hasDirect = (snapshot?.abilities ?? []).some(
    (a) => a.name.trim().toLowerCase() === normalized,
  )
  if (hasDirect) return true

  // Via role (optionally scoped to app)
  return (snapshot?.roles ?? [])
    .filter((r) => applicationId === undefined || r.applicationId === applicationId)
    .some((r) => r.abilities.some((a) => a.name.trim().toLowerCase() === normalized))
}

// ─── validateToken ────────────────────────────────────────────────────────────

/**
 * Valida un token contra /api/auth/me.
 * Lanza si el token es inválido o el backend retorna error.
 * Usar en guards de ruta y en interceptores de request.
 */
export async function validateToken(
  token: string,
  apiBaseUrl?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<BoogiepopMePayload> {
  const base = resolveApiBase(apiBaseUrl)
  if (!base) throw new Error('boogiepop-auth-sdk: apiBaseUrl no configurado para validateToken')
  return fetchAuthMe(token, base, fetchImpl)
}

// ─── createAuthenticatedFetch ─────────────────────────────────────────────────

export interface AuthenticatedFetchOptions {
  /** Función que retorna el token actual (puede cambiar en runtime). */
  getToken: () => string | null
  /** Callback cuando el servidor retorna 401 — típicamente llama a logout(). */
  onExpired?: () => void
}

/**
 * Retorna un wrapper de fetch que:
 * 1. Agrega `Authorization: Bearer <token>` automáticamente.
 * 2. Si la respuesta es 401, llama onExpired().
 *
 * Reemplaza el fetch nativo en cada request autenticado para
 * que la lógica de expiración no se repita en cada llamada.
 */
export function createAuthenticatedFetch(options: AuthenticatedFetchOptions): typeof fetch {
  return async function authFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const token = options.getToken()
    const headers = new Headers(init?.headers)

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const response = await fetch(input, { ...init, headers })

    if (response.status === 401) {
      options.onExpired?.()
    }

    return response
  }
}

export function getAbilitiesForApp(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles' | 'abilities'> | null | undefined,
  applicationId: string,
): string[] {
  const fromRoles = (snapshot?.roles ?? [])
    .filter((r) => r.applicationId === applicationId)
    .flatMap((r) => r.abilities.map((a) => a.name))

  const direct = (snapshot?.abilities ?? []).map((a) => a.name)

  return [...new Set([...fromRoles, ...direct])]
}
