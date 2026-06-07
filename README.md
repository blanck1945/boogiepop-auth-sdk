# boogiepop-auth-sdk

SDK de sesión/roles para ecosistema Boogiepop.

- Sin `login` en remotes.
- El host sigue siendo responsable de `POST /api/auth/login`.
- Host y remotes consumen `GET /api/auth/me` para hidratar sesión.

## Instalación

```bash
npm install @boogiepop/auth-sdk
```

## API core

```ts
import {
  resolveBoogiepopSession,
  hasRole,
  hasAnyRole,
} from '@boogiepop/auth-sdk'
```

## API React

```ts
import { useBoogiepopSession } from '@boogiepop/auth-sdk/react'
```

## Opciones principales

- `token`
- `apiBaseUrl`
- `tokenQueryParamKey` (default: `bpToken`)
- `tokenStorageKey` (default: `boogiepop:auth:token`)
- `hostBridgeModuleId` (default: `boogiepop_host/host-auth`)

## Publicación npm

1. `npm run build`
2. Configurar secreto `NPM_TOKEN` en GitHub
3. Publicar por tag `v*` o `workflow_dispatch` en `publish-npm.yml`
