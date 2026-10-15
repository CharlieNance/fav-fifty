# Admin Portal, Runtime Settings, Dashboards & Analytics — Implementation Plan

Planning doc. With strangers able to use the site, the owner needs to **see what's
happening** (analytics and dashboards) and **act on it** (lock an account, read or
remove content, switch a feature off, change a limit) without a database shell or a
redeploy. Owner direction (2026-10-13): this is **pre-launch** work. Decided in
[QUESTIONS.md](QUESTIONS.md):

- **Q14:** catalog providers can be enabled or disabled at runtime.
- **Q23:** Cloudflare Web Analytics, an `/events` endpoint, errors via logs.
- **Q24:** the owner is the only admin; admins may read private lists.
- **Q25:** limits are changeable at runtime.

Nothing is built yet. Related: [ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md),
[COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md).

## Scope

### In scope (pre-launch v1)

- **An admin area** in the existing web app (`/admin`), for the owner only:
  - users: search, view, lock/unlock, revoke sessions;
  - content: read and remove a list;
  - **runtime settings**: feature switches, limits, catalog provider toggles, and
    the cost breaker;
  - an **audit log** of every admin action.
- **Dashboards:** product metrics, operational health, and cost/breaker status.
- **Analytics:** Cloudflare Web Analytics for traffic, plus a small first-party
  event stream that also covers **anonymous** users, whose activity otherwise never
  reaches the server.

### Out of scope (later)

- A report queue for public content (Phase 3, see ABUSE_PROTECTION_PLAN.md §Phase 3
  hooks).
- More than one admin, or multiple roles.
- An admin UI in the mobile apps. Admin is web-only.
- Granting admin from any UI or API (deliberately impossible, see below).

## Access control

- **Schema:** `users.role`, an enum-ish `String(16)`, default `'user'`, values
  `'user' | 'admin'`. An Alembic migration, additive with a server default, so it's
  backward compatible.
- **Only the owner is an admin (Q24), and nothing in the app can make anyone else
  one.** Granting and revoking happen only through a backend management command run
  with direct access to the box
  (`uv run python -m app.cli grant-admin --email …`, wrapped as
  `tools/grant_admin.sh`). **No API endpoint reads or writes `role` as input**, and
  a test enforces that.
- **`require_admin` dependency:** builds on `get_current_user` (so a locked admin is
  locked out too) and returns `403` for non-admins. Applied on the admin router
  (`dependencies=[...]`), so individual routes can't forget it.
- **Defense in depth:**
  - Admin actions require a **recent login** (the session was issued within the last
    12 h). The signed cookie carries a timestamp (`itsdangerous` timed signer).
  - The **Origin-check CSRF middleware** from ABUSE_PROTECTION_PLAN.md applies.
  - Rate limit 60/min; never cached at the edge.
  - The owner's Google account uses 2-step verification, since it *is* the admin
    credential.
- The `/admin` route guard in the frontend is **UX only**; the backend is the real
  gate.
- **Dev:** the dev-login stub gets an "admin" variant (dev only, hard-fails outside
  development like the existing stub) for building and e2e-testing admin screens.

## Audit log

Every **mutating** admin action, and every **read of a user's private content**,
writes a row in the same DB transaction as the action:

```text
admin_audit_log(id, admin_user_id, action, target_type, target_id,
                reason (nullable text), metadata (jsonb, small), created_at)
```

- Append-only: no update or delete endpoint.
- Shown in the admin UI (filterable by target and action).
- Mutating actions take an optional **reason**.

## Admin features (v1)

### Users

- Search by display name or email (paginated, capped).
- User detail: created, last login, sign-in provider, active/locked, list and item
  counts, recent admin actions on them.
- **Lock / unlock:** `deactivate_user` exists; add `reactivate_user`. Takes effect on
  the user's next request, since `get_current_user` re-checks `is_active`.
- **Revoke all sessions:** `revoke_all_sessions` exists.
- *(With account deletion, which mobile requires anyway:)* delete a user and their
  data.

### Content (Q24: allowed)

- **Read any user's lists and items**, for debugging and account investigations.
  Each read is audit-logged.
- **The privacy policy says so plainly:** lists aren't private from the operator, the
  operator can read them, and they're never sold, used for anything else, or
  published. Updated 2026-10-13 in [legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md).
- Remove a list for moderation using the existing soft-delete (`lists.deleted_at`),
  so it's reversible. Reason required.

### Runtime settings (switches + limits + providers)

One mechanism for everything the owner wants to change **without a deploy**. It's
shared with the cost breaker (which flips switches) and the quotas (Q25).

| Setting | Type | Effect |
| --- | --- | --- |
| `maintenance_mode` | switch | Read-only API (writes → 503 with a friendly message); SPA banner |
| `signups_enabled` | switch | New accounts refused at the auth callback; existing users unaffected |
| `catalog_enabled` | switch | `/catalog/search` returns empty + `disabled`; UI hides suggestions |
| `catalog_providers.<name>.enabled` / `.priority` | per-provider | Turn a single provider on or off, or reorder fallbacks (Q14) |
| `showcase_enabled` | switch | Margin showcase not rendered |
| `import_enabled` | switch | Claim dialog says "try again later" |
| `events_enabled` | switch | Analytics events dropped |
| `limits.*` (lists per user, tags per list, description length, daily writes, import size) | numbers | Quotas from ABUSE_PROTECTION_PLAN.md (Q25). Code defaults apply when unset. |
| `breaker_level` (0/1/2) | **read + reset only** | Set by the breaker; reset manually by the owner |

- **Stored in SSM Parameter Store** under `/favfifty/settings/*` (standard
  parameters, free), **not** in Postgres. Two reasons:
  - The breaker Lambda can flip settings without reaching the box.
  - The box and the Lambda routes read the same values.

  The box reads them with its narrowly scoped IAM key (DEPLOYMENT_TOPOLOGY_PLAN.md
  §Running the box).
- **Validated on write:** a typed schema (Pydantic) per setting with sane bounds
  (e.g. tags per list 1–200), so a typo can't set a limit to 0 or a switch to "maybe".
- **Read through one `runtime_settings` module:** typed, with a **~30 s in-process
  cache** and **code defaults** for anything missing. If SSM is unreachable, it
  **fails safe**: optional features off, core lists on, limits at their defaults.
  The cache is an optimization only, consistent with the portability rules.
- **Locally,** the same settings can be overridden by env vars / `backend/.env`. No
  AWS is needed in dev, so this stays a "config file" in development as well.
- **Public `GET /api/v1/config/client`** exposes the user-facing subset (maintenance
  banner, catalog/showcase on or off, the limits the clients validate against), so web
  and mobile degrade gracefully and validate consistently.
- **The admin Settings page** shows each value, its default, and who changed it last
  (audit log), lets the owner edit it with validation, and has the **breaker reset**
  button.

### Abuse view (v1.1, right after launch if not before)

- Recent 429s by route class and top client IPs, read from the per-minute counters
  the app aggregates into Postgres (logs stay on the box; see
  DEPLOYMENT_TOPOLOGY_PLAN.md).
- Add or remove an IP in the WAF block-list IP set. The box's IAM user gets a narrow
  permission for that one IP set.

## Dashboards

| Panel | Shows | Source |
| --- | --- | --- |
| **Product** | Total users; new users (7/30 d); weekly active signed-in users; lists and items created per day; imports (anonymous → account); catalog searches and pick-rate; anonymous sessions per day | **Postgres**: derived queries over existing tables plus the events rollup. One admin endpoint returns pre-aggregated numbers. |
| **Health** | Requests, 4xx/5xx, 429s, WAF blocks, Lambda throttles, box CPU and burst capacity, disk, uptime | Per-minute request/error/429 counters aggregated by the app into Postgres; CloudFront, Lambda and Lightsail metrics plus the Route 53 health check in a **CloudWatch dashboard** (free tier covers 3), linked from the admin portal |
| **Cost** | Month-to-date cost, forecast, by service; breaker level and last trip | A daily Cost Explorer snapshot from a scheduled job (once a day, since the API charges $0.01/request); breaker state from SSM |

- Charts: lazy-loaded only in the admin chunk, using a small MIT-licensed library
  (e.g. Chart.js or uPlot) or hand-rolled SVG sparklines for v1. The public bundle is
  unaffected.
- Dashboard queries are aggregate-only and cached (~5 min).

## Analytics (Q23)

### A. Traffic: Cloudflare Web Analytics (decided)

- Free, cookieless JS beacon. It works without hosting the site on Cloudflare and
  needs no consent banner. It covers page views, referrers (e.g. how much comes from
  Discord), countries and devices.
- Add its script and beacon hosts to the CSP. Name it in the privacy policy.
- CloudFront standard logs (ingestion included in the flat-rate plan) remain for
  occasional forensics.

### B. Product events: first-party `/events` (decided)

Anonymous users' activity happens on-device, so the server can't see it otherwise.

- `POST /api/v1/events`: public; batched (the client queues events and flushes with
  `navigator.sendBeacon` on page hide); rate-limited; size-capped; behind
  `events_enabled`.
- **An allowlist of event names**, ~10 to start: `session_start`, `list_created`,
  `item_added`, `catalog_search`, `catalog_pick`, `export_file`, `import_started`,
  `import_succeeded`, `sign_in_started`, `sign_in_succeeded`. Unknown names are
  dropped.
- **Payload:** event name, timestamp, `platform` (web/ios/android), `app_version`, a
  random session id kept in `sessionStorage`, a couple of allowlisted properties
  (e.g. list `kind`), and **the user id when signed in**. The owner is fine with
  identifying signed-in usage (Q23), and it makes retention numbers possible.
  - **Not stored:** IP addresses. Rate limiting doesn't need them stored, and
    keeping them adds privacy-law exposure for no benefit.
  - **Not stored:** free text, such as search queries.
- **Storage:** an `analytics_events` table with **90-day retention**, rolled up
  nightly into `analytics_daily`, which the dashboards read. The box is always on, so
  writes cost nothing extra.
- **Mobile:** same endpoint and allowlist, with `platform` set. Store privacy labels
  must declare "product interaction, linked to identity when signed in".

### C. Errors: logs only (decided)

- Structured logs on the box, plus the 5xx counter and alarm. Sentry (free tier) stays
  an option if frontend errors become hard to diagnose.

## Privacy policy

Updated **2026-10-13** for operator access (Q24), since that's true today. Still
owed **when each piece ships**:

- Cloudflare Web Analytics.
- First-party events: what's collected, and that signed-in events include the
  account id.
- Anonymous on-device storage, and catalog search relayed to third parties.

These are tracked in [CONSIDERATIONS.md](CONSIDERATIONS.md) §Legal.

## Tests

- pytest:
  - **Every admin route rejects non-admins** (a router walk, so a new admin route
    can't skip `require_admin`).
  - No API path accepts `role` as input.
  - The recent-login requirement; lock/unlock takes effect immediately; an audit row
    is written for each mutating action and each content read.
  - Runtime settings: schema validation, cache TTL, code defaults, env overrides in
    dev, fail-safe defaults when SSM is unreachable.
  - Events: allowlist, size cap, rate limit; switch off → `204` and dropped.
- Vitest: admin views and the guard, the settings editor's validation, and the events
  queue (flush on hide; nothing sent when disabled).
- Playwright: dev admin logs in → locks a dev user → that user's next request is
  rejected.

## Build order

1. **Runtime settings module** (SSM + env fallback, typed and validated) +
   `GET /api/v1/config/client`. The quotas, the catalog provider toggles and the cost
   breaker all depend on this, so it comes first.
2. `users.role` migration + `require_admin` + `grant-admin` CLI +
   `tools/grant_admin.sh` + the audit-log table.
3. Admin UI v1: Users (search, detail, lock/unlock, revoke) + the Settings page.
4. Content read/remove (audit-logged).
5. Product dashboard + request/429 counters + CloudWatch dashboard link + the cost
   snapshot job.
6. Analytics: Cloudflare Web Analytics + `/events` + the daily rollup.
7. The abuse view (IP block list).
