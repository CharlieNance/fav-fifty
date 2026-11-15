# Fav Fifty — Frontend (Vue 3)

The web client for Fav Fifty: sign-in, lists with ranked items, tags and search, and
use without an account (lists saved on the device). How the lists feature is built is
in [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Stack

- **Vue 3** (`<script setup lang="ts">`) + **Vite** + **TypeScript**
- **Vue Router** — routing
- **Pinia** — app state (starting with the auth/session store)
- **Tailwind CSS v4** — styling, configured CSS-first via design tokens
- **Vitest** + **@vue/test-utils** — unit/component tests
- **Playwright** — a few real-browser journeys in `e2e/`
- **ESLint** + **Prettier** — lint & format

## Layout

```
frontend/
├── index.html              # app entry HTML
├── vite.config.ts          # Vite: Vue + Tailwind plugins, @/ alias, /api dev proxy, Vitest
├── eslint.config.js        # flat ESLint config (Vue + TS + Prettier)
├── src/
│   ├── main.ts             # bootstraps Vue, Pinia, Router; imports global CSS
│   ├── App.vue             # root shell — hosts <RouterView>
│   ├── assets/
│   │   └── main.css        # Tailwind import + design tokens (dark-first)
│   ├── router/
│   │   └── index.ts        # route table (views lazy-loaded)
│   ├── stores/             # Pinia: auth, clientConfig (limits), toasts
│   ├── api/
│   │   └── client.ts       # tiny typed fetch wrapper (the backend seam)
│   ├── components/         # shared: header, footer, buttons, ConfirmDialog, toasts
│   └── features/           # feature-oriented folders (group by feature, not layer)
│       ├── auth/           # login page, post-login redirect
│       ├── home/           # landing page
│       └── lists/          # lists, items, tags, on-device storage, import/claim
└── e2e/                    # Playwright specs (they start db + backend + frontend)
```

**Why feature folders:** as lists, auth, comments, and voting arrive, each gets its own
`features/<name>/` slice (views, components, composables, tests) instead of scattering
across type-based folders. Mirrors the backend's per-feature layering.

## Prerequisites

- **Node 22+** and npm (Node 22.12 / npm 10.9 used to scaffold).

## Running locally

```bash
npm install        # install dependencies
npm run dev        # dev server at http://localhost:5173
```

Calls to `/api/*` are proxied, unchanged, to the FastAPI backend at
`http://localhost:8000`, which serves everything under `/api/v1` (see `vite.config.ts`),
so run the backend too for anything that hits the API.

## Scripts

```bash
npm run dev           # start the dev server
npm run build         # type-check (vue-tsc) + production build to dist/
npm run preview       # serve the production build locally
npm run test          # run the test suite once (Vitest)
npm run test:watch    # watch mode
npm run test:e2e      # Playwright (Git Bash on Windows); own fresh servers on :5190/:8090
npm run type-check    # vue-tsc type-check only
npm run lint          # ESLint
npm run lint:fix      # ESLint with autofix
npm run format        # Prettier write
npm run format:check  # Prettier check (CI)
```

## Configuration

Client config comes from Vite env vars. **Only `VITE_`-prefixed vars are exposed to the
browser bundle — never put a secret in one.** Copy [`.env.example`](.env.example) to
`frontend/.env.local` (git-ignored); it documents the keys. Vite loads env files from
this folder, not the repo root.

- `VITE_API_BASE_URL` — base path for API calls. Defaults to `/api/v1`: the API shares
  the site's origin everywhere (proxied in dev, routed by CloudFront in prod), so it's
  normally left unset.

## Styling & design

Tailwind v4 is configured CSS-first in [`src/assets/main.css`](src/assets/main.css): a
`@theme` block defines **semantic design tokens** (`canvas`, `surface`, `ink`, `muted`,
`accent`, …) as the single source of truth. Components use the token utilities
(`bg-canvas`, `text-accent`, …), never raw hex — so re-theming means editing one block,
and a light theme is a later additive flip. Palette, type and motion decisions are in
[../docs/DESIGN.md](../docs/DESIGN.md).

See [../docs/NEXT_STEPS.md](../docs/NEXT_STEPS.md) for the roadmap.
