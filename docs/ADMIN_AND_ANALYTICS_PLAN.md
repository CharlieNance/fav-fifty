# Admin Portal, Runtime Settings, Dashboards & Analytics — Implementation Plan

Planning doc. With strangers able to use the site, the owner needs to **see what's
happening** (analytics and dashboards) and **act on it** (lock an account, read or
remove content, switch a feature off, change a limit) without a database shell or a
redeploy. Owner direction (2026-10-13): this is **pre-launch** work. Decided in
[DECISIONS.md](DECISIONS.md):

- **Q14:** catalog providers can be enabled or disabled at runtime.
- **Q23:** Cloudflare Web Analytics, an `/events` endpoint, errors via logs.
- **Q24:** the owner is the only admin; admins may read private lists.
- **Q25:** limits are changeable at runtime.

Built so far:

- Step 1 (Track 0, 2026-10-14): the runtime settings module +
  `GET /api/v1/config/client`, limits only; each switch lands with the feature it
  gates.
- Step 2 (2026-11-17): `users.role` (+ `ck_users_role`), `require_admin` (role +
  12 h recent-login check from the cookie's signed timestamp,
  `ADMIN_RECENT_LOGIN_SECONDS`), the `admin_audit_log` table and
  `app/services/audit_service.py`, `GET /api/v1/admin/audit-log`, and the CLI
  (`python -m app.cli grant-admin | revoke-admin | list-admins`, wrapped by
  `tools/grant_admin.sh`; grants are audit-logged with no admin id). Tests:
  `tests/test_admin_access.py`, `tests/test_admin_audit_and_cli.py`.
- Step 3 (2026-11-17): the web admin area at `/admin` (lazy chunk; header link and
  router guard for admins, from `is_admin` on `GET /me`).
  - **Users:** search by name/email (`GET /admin/users`), detail with list/item
    counts and that user's audit entries, lock (also ends their sessions, so an
    unlock doesn't revive an old cookie; you can't lock yourself), unlock, and
    sign out everywhere. Each takes an optional audit reason.
  - **Settings:** every runtime setting with its value, default and bounds
    (`GET /admin/settings`), change (`PUT /admin/settings/{key}`, strict
    validation) or reset to default (`POST …/reset`). Writes go to SSM
    (`PutParameter`/`DeleteParameter`), or to the `RUNTIME_*` lines of
    `backend/.env` locally (refused, 409, for a key pinned by a real env var). The
    audit row commits only if the store write succeeds. The process's cache is
    dropped, so a change applies here at once and elsewhere within ~30 s.
  - The admin router also carries the `rate_limits.admin_per_minute` limit (60) and
    `Cache-Control: no-store`.
  - Tests: `tests/test_admin_portal.py`, `src/features/admin/*.spec.ts`,
    `e2e/admin.spec.ts` (grants admin with the real CLI, locks a second dev user,
    checks their next request is a 401).
  - **Not yet:** the breaker reset button (lands with the breaker, COST_GUARDRAILS_PLAN.md).
- Audit-log page (2026-11-18): `/admin/audit`, filter by action, by target type, or
  (the "Full history" link on a user page) everything about one user, their lists
  included (`subject_user_id`, matching a list row's `details.owner_id`). Filters live
  in the URL; "Load older" pages with `before`. Entries now carry
  `admin_display_name`, `subject_user_id` and `subject_display_name` (additive, filled
  only by this route). A list shows as "a list of <owner>", never its title. Tests:
  `tests/test_admin_audit_and_cli.py`, `AdminAuditView.spec.ts`, and the e2e
  remove/restore flow ends on the owner's history.
- Step 4 (2026-11-18): content read/remove.
  - **Read:** `GET /admin/users/{id}/lists` (deleted lists included, audit
    `read_lists`) and `GET /admin/lists/{id}` (items and tags, audit `read_list`).
    The user page loads lists only when you click "Show lists", so opening a profile
    never reads content implicitly. Item image URLs show as text, never loaded.
  - **Remove:** `POST /admin/lists/{id}/remove`, reason required (blank → 422). It
    reuses the owner's soft delete; the audit row names the owner, not the title.
  - **Restore:** `POST /admin/lists/{id}/restore` undoes only an admin removal (the
    latest `remove_list`/`restore_list` for that list decides); a list its owner
    deleted can't be restored here (409). Restore ignores the owner's list quota,
    since it puts back a list they already had.
  - Tests: `tests/test_admin_content.py`, `AdminListView.spec.ts`, and an e2e that
    removes a second dev user's list and restores it.
- Step 5, app side (2026-11-18): `GET /admin/dashboard` (cached 5 min,
  `?refresh=true` skips it) and the Dashboard page, now the admin landing page.
  - **Product:** account, signed-in-7d, list and item totals plus 30-day daily bars,
    from existing tables. Anonymous and catalog numbers wait for `/events` (step 6).
  - **Health:** `RequestCountMiddleware` (outermost) upserts `request_counts` (minute
    × route class × 2xx/3xx/4xx/429/5xx; `/health` not counted); off on Lambda and
    in-memory under pytest. The page shows the last 24 h by hour and by route.
  - **Cost:** `python -m app.cli daily-jobs` prunes counts older than 35 days and,
    with `COST_SNAPSHOT_ENABLED`, takes ONE Cost Explorer call (~$0.30/month) into
    `cost_snapshots`; the forecast is a free straight-line projection, not the paid
    forecast API.
  - **Still deploy-side:** the CloudWatch dashboard (Terraform) and its
    `CLOUDWATCH_DASHBOARD_URL`, the cron entry, and the IAM permission
    (DEPLOYMENT_TOPOLOGY_PLAN.md §Sequencing). Breaker state joins the Cost panel
    with the breaker.
  - Charts are a hand-rolled SVG `BarChart.vue` (no chart library), each with a
    table view.
- Step 6, app side (2026-11-18): analytics.
  - **Events:** public `POST /events` (`app/api/routes/events.py`), behind the
    `features.events_enabled` switch (default **off**: the fail-safe rule; turn it on
    from Settings). Rate-limited per IP (`rate_limits.events_per_minute`, 20), 16 KiB
    body cap, ≤50 events a batch, always `204`. The allowlist in
    `app/services/analytics_service.py` maps each name to its allowed props *and
    values* (e.g. `import_started.target` ∈ device/account/claim), so no free text
    can be stored; unknown names and props are dropped, not rejected. The user id
    comes only from the session cookie. Client timestamps more than a day old or 5
    minutes ahead are replaced by the arrival time.
  - **Storage:** `analytics_events` (no IP; deleting a user deletes their events) and
    `analytics_daily` (day × name × platform × signed-in → events, distinct
    sessions). `daily-jobs` re-rolls the last 2 days (idempotent), then prunes raw
    events past 90 days.
  - **Client:** `src/analytics/events.ts` queues from page load but sends only once
    `/config/client` says `features.events_enabled`; off drops the queue. Flushes 5 s
    after the first event, at 50 events, and on page hide, with
    `fetch(…, { keepalive: true })` rather than `sendBeacon` (sendBeacon can't send
    `application/json` reliably). A sign-in success is counted after the Google
    redirect from a `sessionStorage` flag. Wired: session start, list created, item
    added, export, file import and claim (`target`), sign-in started/succeeded.
    `catalog_search`/`catalog_pick` are allowlisted for the catalog track.
  - **Dashboard:** an Analytics section with anonymous and signed-in sessions per day
    and per-event totals (past days from the rollup, today live).
  - **Cloudflare Web Analytics:** `src/analytics/cloudflare.ts` adds the beacon in
    production builds when `VITE_CF_BEACON_TOKEN` is set.
  - Privacy policy updated for both (2026-11-18).
  - Tests: `tests/test_events.py`, `src/analytics/*.spec.ts`, the dashboard spec.
  - **Still deploy-side:** create the Cloudflare site and set its token, allow
    `static.cloudflareinsights.com` (script) and `cloudflareinsights.com` (connect)
    in the CSP, and set `VITE_APP_VERSION` in the build.

Related: [ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md),
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
- **Dev:** no dev-login "admin" variant (it would be an API path that grants admin).
  Instead, `./tools/grant_admin.sh dev@example.com` against the local DB makes the
  dev-login user an admin; pytest sets `role` directly. Playwright admin tests
  (step 3) can do the same in their setup.

## Audit log

Every **mutating** admin action, and every **read of a user's private content**,
writes a row in the same DB transaction as the action:

```text
admin_audit_log(id, admin_user_id (nullable: CLI actions), action, target_type,
                target_id, reason (nullable text), details (jsonb, small), created_at)
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
| `features.events_enabled` | switch | Analytics events dropped (built; default off) |
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
  AWS is needed in dev, so this stays a "config file" in development as well. The
  Settings page writes those `.env` lines.
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

- `POST /api/v1/events`: public; batched (the client queues events and flushes on
  page hide with a `keepalive` fetch); rate-limited; size-capped; behind
  `features.events_enabled`.
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

Updated **2026-10-13** for operator access (Q24), **2026-11-14** for on-device
storage, and **2026-11-18** for Cloudflare Web Analytics and first-party events.
Still owed when it ships: catalog search relayed to third parties.

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
2. ~~`users.role` migration + `require_admin` + `grant-admin` CLI +
   `tools/grant_admin.sh` + the audit-log table.~~ Done 2026-11-17.
3. ~~Admin UI v1: Users (search, detail, lock/unlock, revoke) + the Settings
   page.~~ Done 2026-11-17 (breaker reset waits for the breaker).
4. ~~Content read/remove (audit-logged).~~ Done 2026-11-18.
5. ~~Product dashboard + request/429 counters + CloudWatch dashboard link + the cost
   snapshot job.~~ App side done 2026-11-18; the CloudWatch dashboard, cron and IAM
   land with the first deploy.
6. ~~Analytics: Cloudflare Web Analytics + `/events` + the daily rollup.~~ App side
   done 2026-11-18; the Cloudflare token and CSP land with the first deploy.
7. The abuse view (IP block list).
