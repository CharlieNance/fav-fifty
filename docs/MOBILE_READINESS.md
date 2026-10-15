# Mobile Readiness (iOS + Android) — What the Backend and Deploy Need

Planning doc. The owner plans **Android and iOS apps** eventually, talking to the same
Python backend. Nothing here is urgent, but several items are **cheap now and
expensive later** (API paths, auth shape), so they're called out before launch.
Status from [QUESTIONS.md](QUESTIONS.md):

- **Q18:** the app technology is **deferred** (mobile comes later). Capacitor is the
  lead candidate; the owner will look into it, and would rather not rewrite the
  frontend. Apple comes **last**; the $99/year Apple fee and the $25 Google fee are
  accepted.
- **Q19:** the API URL is decided: `https://favfifty.com/api/v1`.

**Short version:** the backend design (stateless, a REST + Pydantic/OpenAPI contract,
the auth seam) is a good base. The real gaps are **(1) auth that works without
browser cookies**, **(2) a versioned, stable API URL**, **(3) Apple-specific store
rules** (Sign in with Apple, in-app account deletion), and **(4) treating the API as
something old app versions will call for years.**

## 1. App technology (deferred, Q18; Capacitor is the lead candidate)

| Option | Reuse of today's Vue code | Effort for a solo dev | Notes |
| --- | --- | --- | --- |
| **Capacitor** (wrap the Vue SPA in native shells) | High: the same components, Tailwind, stores and repositories | Lowest | Native plugins for secure storage, deep links, share sheet and push. Feels "web-ish" unless polished. **Recommended to start.** |
| React Native / Flutter | None (rewrite the UI) | High | A true native feel; a second UI codebase to keep in sync. |
| Native Swift + Kotlin | None, twice | Highest | Best platform feel; two more codebases. |

Whatever we pick, the **backend requirements below are the same**. That's the point
of the API-first shape.

## 2. Auth without cookies (the biggest backend change)

Today: the browser goes to `GET /auth/login` → Cognito → `GET /auth/callback` on the
backend → the backend sets an **HttpOnly session cookie** (signed `{uid, tv}`) →
redirect to the SPA. That's right for the web, but cookies are unreliable in native
apps and WebViews (Capacitor's origin is `capacitor://localhost`, and iOS WebViews
restrict cross-site cookies).

**Plan (additive; the web flow doesn't change):**

1. The app opens the login page in the **system browser sheet**
   (`ASWebAuthenticationSession` on iOS, Custom Tabs on Android), never an embedded
   WebView, which Google blocks for OAuth.
2. `GET /auth/login?client=mobile&app_challenge=<PKCE challenge>`. The backend runs
   the **same Cognito code + PKCE flow** as today and stays the confidential client.
   The Cognito secret never ships in an app.
3. On callback, instead of setting a cookie, the backend redirects to the app via a
   **universal link / app link** (`https://favfifty.com/app/auth-complete?code=…`)
   carrying a **one-time, ~60-second code**, never the session itself.
4. The app calls `POST /auth/token` with that code plus its PKCE verifier and gets a
   **bearer token**.
5. **`get_current_user` accepts `Authorization: Bearer <token>`** as well as the
   cookie. The token can be the **same signed `{uid, tv}` payload** the cookie
   carries, so revocation (`is_active`, `session_token_version`) works identically
   for both. Very little new auth logic.
6. The app keeps the token in **Keychain/Keystore** (a Capacitor secure-storage
   plugin), never in plain `localStorage`.

Notes:

- Bearer requests aren't sent automatically by browsers, so they need no CSRF
  protection. The cookie path keeps `SameSite=Lax`.
- `POST /auth/logout` should also work for bearer tokens. A "log out everywhere"
  button maps to `revoke_all_sessions`, which already exists.
- Tests: the code exchange is single-use, expires, and the PKCE mismatch is
  rejected; bearer and cookie resolve the same user; revocation applies to both.

## 3. Apple's store rules that affect the product

- **Guideline 4.8 (Login Services):** an iOS app whose primary sign-in is Google must
  **also offer an equivalent privacy-focused login**: name and email only, an option
  to hide the email, and no ad tracking. **Sign in with Apple** is the practical way
  to meet it, and Cognito supports Apple natively. So **Apple sign-in moves from
  "maybe later" to "required before the iOS launch."**
  - Apple's "Hide My Email" gives relay addresses
    (`…@privaterelay.appleid.com`). That weakens the **email-based relink safety
    net** in [DECISIONS.md](DECISIONS.md) §Product data model for Apple users. Fine,
    but worth noting in the provider plan
    ([ACCOUNT_AND_AVATAR_PLAN.md](ACCOUNT_AND_AVATAR_PLAN.md) §Future providers).
  - Apple sign-in gives no avatar, so the avatar service falls back to initials.
- **Guideline 5.1.1(v), account deletion:** any app with account creation must let
  users **delete their account from inside the app**. Google Play also requires
  deletion (in the app and via a web link). Account deletion is listed as "before a
  wider launch" in ACCOUNT_AND_AVATAR_PLAN.md; **for mobile it's a hard
  requirement.** With Sign in with Apple, deletion must also **revoke the Apple
  tokens** via Apple's REST API.
- **Anonymous mode helps review:** reviewers can try the app without an account,
  which reviewers like. Signing in still has to work for them.
- **Privacy labels / Data safety forms** in both stores. They should match the
  privacy policy. Easier now that we store little.

## 4. A stable, versioned API

Web clients update on refresh. **Installed apps don't**: people run old versions for
months. So:

- **Version the path now, before launch.** Routes are currently unprefixed (`/lists`)
  and `/api` is only a dev-proxy prefix that Vite strips. Recommendation: the app
  itself serves **`/api/v1/...`** in every environment (no rewrite anywhere), as
  CONSIDERATIONS.md §Extensibility already suggested. Do it pre-launch while there
  are no external clients.
- **One permanent public base URL: `https://favfifty.com/api/v1`** (decided, Q19), baked into
  the apps. What runs *behind* it (Lightsail, Lambda, or both) must be changeable
  without an app release. That's the core of
  [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md).
- **Compatibility rules within v1:** additive changes only (new optional fields, new
  endpoints). Never rename or remove a field or change its meaning. Breaking changes
  go to `/v2`, with `/v1` kept until old apps age out.
- **Minimum-version gate:** a public `GET /api/v1/config/client` returning
  `{ minSupportedVersion, latestVersion }`, so the apps can show "please update"
  instead of failing strangely. It's the same public config endpoint that serves
  runtime limits and switches ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)
  §Runtime settings).
- **Contract as an artifact:** commit FastAPI's OpenAPI schema
  (`openapi.json`) and have **CI fail on unreviewed changes**. Generate the
  TypeScript client types from it (already intended in CONSIDERATIONS.md), and
  Swift/Kotlin if we ever go native. The same snapshot proves every deployment target
  serves the same contract.
- **Wire casing is snake_case, forever.** Settled when the avatar casing bug was fixed
  (commit `3f98dcd`; the frontend now reads `display_name` / `avatar_url`). New fields
  follow suit; mobile clients map to their platform conventions locally if they want.

## 5. Other backend and deploy items

- **CORS:** if we use Capacitor, add its origins (`capacitor://localhost`,
  `https://localhost`) to `cors_allowed_origins` in production, or use Capacitor's
  native HTTP plugin, which isn't subject to CORS.
- **Deep links:** host `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` on `favfifty.com` (the S3/CloudFront static site,
  served with the right content types). These enable the auth-complete link above
  and, later, opening shared list links in the app.
- **Public endpoints and rate limiting:** catalog lookup and the showcase are
  public, and mobile multiplies callers. Covered in
  [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md) §Abuse.
- **Offline lists:** the list repository interface from
  ANONYMOUS_AND_LOCAL_LISTS_PLAN.md gets a mobile implementation. Use **Capacitor
  Preferences/SQLite, not WebView `localStorage`**, which iOS can evict. The same
  versioned JSON document is used for claim/import.
- **Push notifications (later, Phase 4 "notifications"):** APNs + FCM, via Amazon
  SNS or directly. Needs a `device_tokens` table. Pay-per-use, effectively free at
  this scale.
- **Images:** iOS App Transport Security requires HTTPS. Catalog images come through
  `https://img.favfifty.com` (the proxy). Keep validating that user-entered
  `image_url`s are `https://`.

## 6. Costs to flag (per CLAUDE.md: anything recurring gets flagged)

| Item | Cost | When |
| --- | --- | --- |
| **Apple Developer Program** | **$99/year (recurring), accepted (Q18)** | Needed for TestFlight and the App Store, and to configure Sign in with Apple. Apple comes last, so this starts then. |
| Google Play developer account | $25 one-time, accepted (Q18) | Before the Play Store. |
| Everything else above | $0 (code and config) | |

## 7. Suggested order

1. **Pre-launch, cheap now (NEXT_STEPS.md Track 0):** the `/api/v1` prefix and
   same-origin routing; the OpenAPI snapshot in CI. (The wire-casing fix is already
   done.)
2. **With anonymous mode:** the list repository interface (mobile offline storage
   reuses it).
3. **When mobile starts:** confirm the framework (try Capacitor first), then
   bearer-token auth, in-app account deletion, deep-link files, CORS origins, and the
   min-version gate. Android first, **iOS + Sign in with Apple last** (Q18).
