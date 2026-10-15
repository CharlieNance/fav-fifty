# Abuse Protection & Hardening — Implementation Plan

Planning doc. Opening the site to **anonymous visitors**
([ANONYMOUS_AND_LOCAL_LISTS_PLAN.md](ANONYMOUS_AND_LOCAL_LISTS_PLAN.md)) means
strangers can reach the backend without signing in. Even if most traffic comes from
the Discord community, the owner doesn't know everyone, and a public link travels.
"Rate limiting and anti-abuse hardening" therefore moves from the backlog to
**pre-launch** (owner, 2026-10-13). Nothing is built yet. Decided in
[QUESTIONS.md](QUESTIONS.md): **Q16** (catalog and showcase limits are enforced by AWS,
not app code) and **Q25** (quota defaults, changeable at runtime). Related: [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md)
(the last line of defence for cost), [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)
(the lock/block UI), and [CONSIDERATIONS.md](CONSIDERATIONS.md) §Security.

## What we're defending against (at our scale)

Ranked by likelihood × damage for a small, private-by-default list app:

1. **Resource and cost exhaustion:** floods, scrapers, someone scripting our
   catalog-lookup endpoint as a free proxy for TMDB/Deezer (burning *our* quota and
   getting *our* key banned), and huge request bodies.
2. **Storage abuse:** a signed-in account (or script) creating thousands of lists or
   tags.
3. **Account abuse:** bot sign-ups (Cognito costs per monthly active user beyond the
   free tier), or a bad actor in the community.
4. **Web vulnerabilities:** stored XSS through list content, CSRF, broken ownership
   checks (IDOR), open redirects. Most are already handled, so this is a
   re-verification.
5. **Content abuse:** slurs or spam in *public* lists and comments. That's mostly a
   **Phase 3** concern, since lists are private today; plan the hooks, don't build
   moderation queues yet.

## Layer 1 — Edge (CloudFront + WAF)

Runs before our code and costs nothing per request once we're on the CloudFront
flat-rate plan (WAF included; the Free tier allows 5 rules). Blocked requests don't
count against the plan's allowance. Proposed rule set (5 slots):

| # | Rule | Purpose |
| --- | --- | --- |
| 1 | **IP rate limit, global** (e.g. 1,000 requests / 5 min / IP) | Stops crude floods |
| 2 | **IP rate limit, sensitive paths** (`/api/v1/auth/*`, `/api/v1/catalog/*`, `/api/v1/events`; e.g. 200 / 5 min / IP) | Protects login and the endpoints that cost third-party quota |
| 3 | **AWS managed: Core rule set** | Common exploit patterns (path traversal, bad bots, …) |
| 4 | **AWS managed: Amazon IP reputation list** | Known-bad sources |
| 5 | **Block-list IP set** (managed from the admin portal or `tools/`) | Manual "block this IP now" |

The cost breaker's Level 1 tightens rule 2 (COST_GUARDRAILS_PLAN.md).

## Layer 2 — Application

### Rate limits per route class

| Class | Key | Example limit | Notes |
| --- | --- | --- | --- |
| Auth (`/auth/login`, `/auth/callback`, `/auth/token`) | client IP | 20/min | |
| Catalog + showcase (`/catalog/search`, `/showcase`) | — | **No app limiter (Q16).** Enforced by AWS: the WAF rule 2 per-IP limit, CloudFront caching of identical searches, and Lambda **reserved concurrency (~3)** as the global cap on upstream calls | Python keeps only a per-provider circuit breaker ([CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)). If a provider with a *daily* quota is added, a DynamoDB counter (free tier) tracks it. |
| Public config (`/config/*`) | client IP | 60/min | Cacheable at the edge for a short TTL |
| Analytics events (`/events`) | client IP | 30/min, batched client-side | Cheap to drop silently |
| Signed-in writes (lists, items, tags) | user id | 120/min **and** 2,000/day | The daily cap bounds storage growth |
| Import (`/lists/import`) | user id | 5/hour | |
| Admin | user id | 60/min | |

- **Implementation:** a small token-bucket limiter as a FastAPI dependency, with a
  pluggable store. These routes all run on the **one Lightsail box**
  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)), so an **in-process**
  store works. If Uvicorn runs several workers, each counts separately; either run
  one worker (plenty at this scale) or back the store with a small Postgres table.
  The routes on Lambda (catalog, showcase) don't use this limiter (Q16).
  `slowapi` (MIT) is an option, but a hand-rolled ~80 lines may fit our "pluggable
  store" need better. Decide at build time per the dependency policy.
- **Response:** `429` with `Retry-After` and a human `detail`. The frontend shows a
  toast ("Slow down a sec…") through the existing `ApiError` path.
- **Client IP behind CloudFront:** read **`CloudFront-Viewer-Address`**, and trust it
  **only when the request carries our secret origin header** (proof it came through
  CloudFront). Never trust the first `X-Forwarded-For` entry, which is spoofable.
  Locally, use the socket peer address.
- **Emit metrics:** 429 counts per route class, as structured logs or CloudWatch
  metrics, so the admin dashboard and the cost tripwires can see them.

### Product quotas (new limits to add alongside the existing 50-item cap)

Decided defaults (Q25): **max 100 lists per user**, **max 25 tags per list**,
description ≤ 1,000 characters, **2,000 write actions per user per day**, import ≤ 100
lists per request.

- **Changeable without a deploy** (owner: "in config files so I can change them on the
  fly"). Each limit has a **code default** and an optional override in the **runtime
  settings** (SSM-backed, editable from the admin portal; see
  [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md) §Runtime settings). A
  change applies within ~30 s.
- **The tag cap already exists:** `settings.max_tags_per_list` in
  `backend/app/core/config.py` (env `MAX_TAGS_PER_LIST`), enforced in
  `tag_service`. Its default drops from **100 to 25**, and it moves under runtime
  settings with the rest.
- Enforced in the service layer like the item cap, with friendly 409/422 messages.
  The same values go to clients via `GET /api/v1/config/client`, so the anonymous
  mode's local validation stays in step (ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Key
  design).
- Combined with the 50-item cap, they bound worst-case storage per account to a few
  MB.
- The **50-item cap stays fixed in code.** It's the product's identity, not a tunable.

### Request hygiene

- **Body-size limit middleware:** default 64 KB, import 1 MB. Neither Uvicorn nor
  FastAPI caps bodies by default. Reject early with `413`.
- **Database `statement_timeout`** (e.g. 5 s) on app connections, so a pathological
  query (e.g. `ILIKE` search) can't pin the box's CPU.
- **Pagination caps** on every list endpoint (max page size). Review existing ones.
- **Strict content types** (JSON only for JSON endpoints). Pydantic already rejects
  unknown shapes; confirm `extra="forbid"` where it matters.
- **Timeouts everywhere outbound** (catalog providers: 2–3 s) and a Uvicorn
  concurrency limit.

### CSRF and headers

- **Origin check middleware:** for unsafe methods (POST/PUT/PATCH/DELETE) that
  arrive **with the session cookie**, require `Origin` (or `Referer`) to match the
  site. Bearer-token requests from the mobile apps are exempt, since browsers don't
  send those automatically. This adds to `SameSite=Lax`, which doesn't cover
  same-site subdomains.
- **Security headers** via a CloudFront response-headers policy: HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, and a
  **CSP** (`img-src` allowlists the catalog image hosts; `script-src 'self'`, plus
  the analytics script host if Q23 picks one).

### Accounts

- **Lock/unlock and revoke sessions** already exist as service functions
  (`deactivate_user`, `revoke_all_sessions`; there's no `reactivate_user` yet). The
  admin portal adds the UI ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)).
- **Sign-up spike alarm** and a **"new sign-ups off" switch** (same switches as the
  breaker). Existing users keep signing in.
- Owner's own Google account: 2-step verification on, since it's the admin
  identity.

## Layer 3 — Re-verify what's already in place (checklist, not new features)

- [ ] Vue escapes all user content, with no `v-html` anywhere on user data (grep it in
      CI with an ESLint rule `vue/no-v-html`).
- [ ] Every list, item and tag route is ownership-scoped (the `get_owned_list`
      dependency). Add a test that walks the router and asserts every non-public
      route has an auth dependency, so a forgotten one fails CI.
- [ ] The OAuth `redirect` param stays open-redirect-safe (it's validated today;
      keep its test).
- [ ] Session cookie: `HttpOnly`, `Secure` (prod), `SameSite=Lax`, signed, versioned
      (done).
- [ ] Dependencies: **Dependabot**, **GitHub secret scanning + push protection**,
      `npm audit` / `pip-audit` in CI, lockfiles committed (already in
      CONSIDERATIONS.md; make them real before launch).
- [ ] **Backups:** a nightly `pg_dump` to S3 plus Lightsail snapshots
      (DEPLOYMENT_TOPOLOGY_PLAN.md §Running the box); **do one test restore** before
      launch.

## Phase 3 hooks (plan now, build with public lists and comments)

- A `reports` table (who reported what, why) plus a "Report" button on public
  content; an admin review queue.
- Optional word filter on *public* titles and comments (warn, don't block).
- Optional per-user "trust" (new accounts can't publish for N hours).
- If bot sign-ups ever appear: **Cloudflare Turnstile** (free, works without
  Cloudflare hosting) on the login button, or WAF CAPTCHA rules (included in the
  CloudFront plan).

## Tests

- pytest: limiter (allow, deny, refill, keyed by user vs IP, trusted-header logic),
  `413` on oversized bodies, quotas (101st list rejected), Origin-check middleware
  (cookie + foreign Origin → 403; bearer → allowed), and the "every non-public route
  is protected" router walk.
- Vitest: a 429 shows the slow-down toast; quota errors surface the backend
  `detail`.
- Manual before launch: a load script (`tools/`, offered when built) against a local
  stack to confirm limits engage, and the WAF rules exercised once in prod.

## Build order

1. Request hygiene: body-size limit, statement timeout, pagination caps.
2. Product quotas (lists per user, tags per list), backend and frontend.
3. App-level rate limiter (in-process store) plus 429 UX.
4. Origin-check CSRF middleware; the router-walk auth test; `vue/no-v-html`.
5. Edge: WAF rules plus the security-headers policy, with the first deploy.
6. Supply-chain items (Dependabot, secret scanning, audits); a backup restore test.
