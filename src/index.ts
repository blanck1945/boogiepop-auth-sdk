export type BoogiepopMePayload = {
  userId?: string
  email: string
  roles: string[]
}

export type BoogiepopUser = {
  id: string
  name: string
  email: string
}

export type BoogiepopSessionSnapshot = {
  user: BoogiepopUser | null
  roles: string[]
  token: string | null
  source: 'host-bridge' | 'token+me' | 'none'
  error: string | null
}

type HostBridgeSnapshot = {
  user: BoogiepopUser | null
  roles: string[]
  token: string | null
}

type HostBridgeModule = {
  getHostAuthSnapshot: () => Readonly<HostBridgeSnapshot>
  subscribeHostAuth?: (listener: () => void) => () => void
}

export type ResolveSessionOptions = {
  token?: string | null
  apiBaseUrl?: string | null
  tokenQueryParamKey?: string
  tokenStorageKey?: string
  hostBridgeModuleId?: string
  fetchImpl?: typeof fetch
}

const defaultSnapshot: BoogiepopSessionSnapshot = {
  user: null,
  roles: [],
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
    roles: snapshot.roles ?? [],
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
    readTokenFromBrowser(tokenQueryParamKey, tokenStorageKey)

  if (!token) return baseSnapshot
  if (token.startsWith('mock')) return { ...baseSnapshot, token }

  const apiBaseUrl = resolveApiBase(options?.apiBaseUrl)
  if (!apiBaseUrl) {
    return {
      ...baseSnapshot,
      token,
      error: 'Base URL no configurada para /api/auth/me',
    }
  }

  try {
    const me = await fetchAuthMe(token, apiBaseUrl, fetchImpl)
    return {
      user: {
        id: me.userId ?? baseSnapshot.user?.id ?? 'unknown',
        name: baseSnapshot.user?.name ?? deriveNameFromEmail(me.email),
        email: me.email,
      },
      roles: me.roles ?? baseSnapshot.roles,
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

export function hasRole(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles'> | null | undefined,
  expected: string,
): boolean {
  const normalized = expected.trim().toLowerCase()
  if (!normalized) return false
  return (snapshot?.roles ?? []).some((role) => role.trim().toLowerCase() === normalized)
}

export function hasAnyRole(
  snapshot: Pick<BoogiepopSessionSnapshot, 'roles'> | null | undefined,
  expectedRoles: string[] | null | undefined,
): boolean {
  const expected = (expectedRoles ?? []).filter((role) => role.trim().length > 0)
  if (!expected.length) return true
  return expected.some((role) => hasRole(snapshot, role))
}
