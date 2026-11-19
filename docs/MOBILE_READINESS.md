# Mobile Readiness (iOS + Android) — What the Backend and Deploy Need

Planning doc. The owner plans **Android and iOS apps** eventually, talking to the same
Python backend. Nothing here is urgent, but several items are **cheap now and
expensive later** (API paths, auth shape), so they're called out before launch.
Status from [DECISIONS.md](DECISIONS.md):

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

- **Version the path now, before launch.** Done (Track 0, 2026-10-14): the app
  itself serves **`/api/v1/...`** in every environment (no rewrite anywhere), as
  CONSIDERATIONS.md §Extensibility suggested.
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
  runtime limits and switches ([ARCHITECTURE.md](ARCHITECTURE.md#admin-and-analytics)
  §Runtime settings).
- **Contract as an artifact:** FastAPI's OpenAPI schema is committed
  (`backend/openapi.json`) and **CI fails on unreviewed changes**
  (`tests/test_api_contract.py`; regenerate with `./tools/openapi_snapshot.sh`). Generate the
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
- **Offline lists:** the list repository interface
  ([ARCHITECTURE.md](ARCHITECTURE.md) §Layers) gets a mobile implementation. Use **Capacitor
  Preferences/SQLite, not WebView `localStorage`**, which iOS can evict. The same
  versioned JSON document is used for claim/import.
- **Push notifications (later, Phase 4 "notifications"):** APNs + FCM, via Amazon
  SNS or directly. Needs a `device_tokens` table. Pay-per-use, effectively free at
  this scale.
- **Images:** iOS App Transport Security requires HTTPS. Catalog images come through
  `https://img.favfifty.com` (the proxy). Keep validating that user-entered
  `image_url`s are `https://`.

## 6. Testing on Apple devices (before launch)

**Status:** Playwright runs desktop light, desktop dark and a Pixel-sized phone, all
on Chromium ([ARCHITECTURE.md](ARCHITECTURE.md) §Testing notes). **Nothing runs on
WebKit yet**, and every browser on iPhone and iPad is WebKit under the hood (Chrome
and Firefox on iOS included). Much of the Discord audience will be on iPhones, so this
matters for the **website launch**, not just the native app later.

**Before launch, add (cheapest first):**

1. **Playwright WebKit projects**, e.g. `iPhone 15` and `iPad Pro 11` from
   `devices`, next to the existing ones in `frontend/playwright.config.ts`. CI then
   installs `webkit` as well as `chromium` (`npx playwright install --with-deps
   chromium webkit`), which adds some minutes. It runs on Windows, Linux and CI, and it
   is **WebKit, not Safari**: it catches most engine differences (CSS, layout,
   storage, events) but not Safari-only behavior or real touch hardware.
2. **A real iPhone pass by hand** before launch: borrow one if needed, or ask a few
   Discord members to try a checklist (below). This is the only free way to see real
   Safari.
3. **Optional: a real-device cloud** (BrowserStack, LambdaTest, Sauce Labs). These run
   real iPhones and iPads in the browser, from Windows. BrowserStack has had a free
   plan for open-source projects; this repo is public, so check whether it qualifies.
   Otherwise they're **paid monthly plans (recurring, flag before adopting)**.

**What there is for iPhone emulation:**

- **Xcode's iOS Simulator** is the real thing (Safari and WebKit on simulated iPhones
  and iPads), but it **only runs on macOS**. There's no official iOS simulator for
  Windows.
- **GitHub Actions macOS runners are free for public repos**, and they have Xcode and
  the Simulator. That's the no-cost way to run real iOS Safari in CI, and later to
  build the Capacitor iOS app. It's slower to set up than the Playwright projects, so
  do it after them, if at all, before launch.
- **Chrome DevTools device mode** (on Windows) only changes the screen size and the
  user agent of Chromium. It's fine for layout and useless for Safari bugs.

**If you get an iPad:** it is a real WebKit device for manual testing. Two catches:

- **Safari Web Inspector** (console and DOM on the device) needs a **Mac** connected
  over USB. From Windows, the options are third-party tools (inspect.dev, paid;
  `ios-webkit-debug-proxy`, free but fiddly). Without either, debug by reproducing in
  Playwright WebKit.
- **iPad Safari asks for desktop sites by default**: it sends a Mac user agent. Never
  detect iPad (or mobile) from the user agent; use widths and `pointer: coarse` media
  queries. The `iPad Pro 11` Playwright profile sends an iPad user agent, so it won't
  catch this.

**Safari behaviors to check in this app specifically:**

- **On-device lists can be wiped.** Safari's tracking prevention can delete storage a
  script wrote (our `localStorage` anonymous lists) after about **7 days of using
  Safari without visiting the site**. A site added to the Home Screen is exempt. This
  is what the backup reminder and sign-in claim are for. Consider wording the
  reminder for Safari users, and test that the export, import and claim flows work in
  Safari.
- **Private browsing:** storage works but is thrown away when the tab closes. The app
  must not crash when storage is blocked or quota is tiny (the repository already
  catches storage errors; confirm it on a device).
- **Drag to reorder** (SortableJS) with real touch, including scrolling a long list
  while dragging.
- **Inputs zoom the page** when their font size is under 16px. Check the add-item and
  search fields.
- **Viewport height:** `100vh` includes the area under Safari's toolbars; use `dvh`
  for full-height layouts and dialogs. Check the dialogs (BaseDialog) with the
  on-screen keyboard open.
- **Both themes:** Safari follows the system Light/Dark setting the same way.
- **Sign-in:** Google via Cognito in Safari (and later Sign in with Apple, §3).
  Safari blocks third-party cookies; ours are first-party (same origin, Q19), so it
  should work, but verify on a real device.

**For the native iOS app (later):** building and submitting a Capacitor iOS app needs
**Xcode, which needs macOS**. Options: a GitHub Actions macOS runner (free for public
repos), a used Mac mini (one-time cost), or a rented cloud Mac (**recurring, flag**).
TestFlight (beta testing on real devices) comes with the Apple Developer Program (§7).

## 7. Costs to flag (per CLAUDE.md: anything recurring gets flagged)

| Item | Cost | When |
| --- | --- | --- |
| **Apple Developer Program** | **$99/year (recurring), accepted (Q18)** | Needed for TestFlight and the App Store, and to configure Sign in with Apple. Apple comes last, so this starts then. |
| Google Play developer account | $25 one-time, accepted (Q18) | Before the Play Store. |
| Real-device testing cloud (§6) | $0 on an open-source plan if we qualify; otherwise a paid monthly plan (**recurring, not yet decided**) | Optional, before launch. |
| macOS for building the iOS app (§6) | $0 on GitHub Actions; a used Mac mini is one-time; a rented cloud Mac is **recurring, not yet decided** | When iOS work starts. |
| Everything else above | $0 (code and config) | |

## 8. Suggested order

1. **Pre-launch, cheap now (NEXT_STEPS.md Track 0):** the `/api/v1` prefix and
   same-origin routing; the OpenAPI snapshot in CI. (The wire-casing fix is already
   done.) **Before the website launches:** Playwright WebKit iPhone + iPad projects
   and a manual pass on a real iPhone (§6).
2. **With anonymous mode:** the list repository interface (mobile offline storage
   reuses it).
3. **When mobile starts:** confirm the framework (try Capacitor first), then
   bearer-token auth, in-app account deletion, deep-link files, CORS origins, and the
   min-version gate. Android first, **iOS + Sign in with Apple last** (Q18).
