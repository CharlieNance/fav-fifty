# Next Steps & Roadmap

The living plan for building Fav Fifty. Each step is meant to be small and shippable.
Decisions live in [DECISIONS.md](DECISIONS.md); how the built parts work is in
[ARCHITECTURE.md](ARCHITECTURE.md).

Last updated: 2026-11-17

---

## Where to start next

1. **Pre-launch hardening, app layer:**
   - quotas, rate limits, request hygiene and CSRF
     ([ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md));
   - the admin portal and analytics are done app-side
     ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md) steps 1–6); the
     breaker reset waits for the breaker, and the abuse view (step 7) is next.
2. **Remaining Phase 2:** publish/unpublish, list-title dedup.
3. **First deploy** (Terraform: box, S3, CloudFront + WAF on the flat-rate plan,
   backups) → **breaker + game day**.
4. **Tracks 2–3** (catalog lookup, margin showcase) and dashboards/analytics, just
   before or just after launch (owner's call). Catalog moves to Lambda with its AWS
   protections when it ships.
5. **Launch** = steps 1–3 done, plus a real contact email in the [privacy policy](legal/PRIVACY_POLICY.md) and
   [terms](legal/TERMS_OF_SERVICE.md), both hosted at public URLs, and Apple device
   testing (WebKit e2e + a real-iPhone pass, under Pre-launch hardening below).

Small owner to-do (AWS console): push notifications beyond email for the budgets (AWS
Console app, Discord webhook). It can wait for the breaker's SNS topic at deploy. See
[COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md) §Account timeline.

## Done so far

- **Phase 0, foundation:** repo, docs, decisions, MIT license, Google OAuth client,
  AWS account with MFA and budgets ($10/$25/$50/$100 + Cost Anomaly Detection), Route 53
  zone, Cognito user pool.
- **Phase 1, walking skeleton:** FastAPI + Postgres + Alembic, Vue 3 + Vite, CI on every
  push, real Google sign-in through Cognito (live 2026-07-31), `GET /me`.
- **Phase 2 so far:** list CRUD with soft delete; items with the 50-item cap, dedup and
  drag-to-reorder; tags and title/tag search; Playwright end-to-end tests.
- **Track 0, API groundwork (2026-10-14):** everything under `/api/v1`, the committed
  `openapi.json` with a drift test, `deploy_target` + git SHA in health, runtime
  settings + `GET /api/v1/config/client`. Dev Cognito callback URL updated (2026-11-14).
- **Track 1, anonymous + on-device lists (2026-11-14):** lists without an account,
  export/import a file, the backup reminder, `POST /lists/import`, the claim dialog
  on sign-in, and the privacy policy and terms updated to match. See
  [ARCHITECTURE.md §Anonymous lists](ARCHITECTURE.md#anonymous-lists-on-device-storage).

## Phase 2 — Core feature: personal lists (MVP)

- [ ] Publish/unpublish (draft vs public)
- [ ] No duplicate list titles per user (items are already deduplicated)
- [x] **Light/dark toggle** (2026-11-15), plus an accessibility pass
      ([DESIGN.md](DESIGN.md) §Light theme, §Accessibility)
- [ ] First deploy to AWS, behind `favfifty.com`, per
      [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md): one Lightsail box
      (Docker Compose: FastAPI + Postgres 16 + TLS proxy), the SPA on S3, and one
      CloudFront distribution (flat-rate Free plan) serving the SPA _and_ `/api/v1/*`.
      Includes: the Cognito callback URL →
      `https://favfifty.com/api/v1/auth/callback`, nightly `pg_dump` + snapshots + one
      test restore.

### Pre-launch hardening (owner call 2026-10-13)

Anonymous access means strangers can reach the backend, and this project can never
absorb a surprise bill, so these **block launch**. All decided (Q16, Q21–Q25 in
[DECISIONS.md](DECISIONS.md)).

- [ ] **Cost guardrails** ([COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md)):
  - services capped by construction (CloudFront flat-rate plans, the fixed-price box,
    Lambda reserved concurrency, logs on the box);
  - usage tripwires → the breaker (degrade at $50 → maintenance at $100, manual
    revive);
  - $25 notify with repeat reminders and phone push.

  **Launch blocks on a passing game day.**
- [ ] **Abuse protection** ([ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md)):
  - WAF rules;
  - app rate limits for signed-in writes + 429 UX;
  - quotas (100 lists, 25 tags, …, runtime-configurable);
  - body-size limits, DB statement timeout, Origin-check CSRF, security headers;
  - ~~supply-chain checks~~ (done 2026-11-17: audits in CI, Dependabot, secret
    scanning + push protection).
- [ ] **Runtime settings + admin portal**
      ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)):
  - SSM-backed switches, limits and provider toggles;
  - ~~`users.role` + a CLI-only admin grant; the audit log~~ (done 2026-11-17);
  - ~~lock/unlock/revoke; the Settings page~~ (done 2026-11-17);
  - ~~read/remove lists~~ (done 2026-11-18);
  - ~~the audit-log page~~ (done 2026-11-18);
  - the breaker reset button (with the breaker).
- [ ] **Dashboards + analytics** (same plan):
  - ~~product numbers from Postgres; request/429 counters; the daily cost-snapshot
    job~~ (app side done 2026-11-18);
  - the CloudWatch health dashboard, cron and IAM for the snapshot (first deploy);
  - ~~the `/events` stream, its rollup, and the Cloudflare Web Analytics beacon~~
    (app side done 2026-11-18);
  - the Cloudflare site token and its CSP hosts (first deploy).
- [ ] **Apple device testing** ([MOBILE_READINESS.md](MOBILE_READINESS.md) §6). Every
      iPhone/iPad browser is WebKit, and e2e runs only Chromium today:
  - Playwright WebKit projects (`iPhone 15`, `iPad Pro 11`), in CI too;
  - a manual pass on a real iPhone (the §6 checklist: on-device lists surviving
    Safari's storage cleanup, export/import/claim, touch drag, dialogs with the
    keyboard open, Google sign-in).

**🎯 "Phase one complete" target.** Everything below is incremental.

## Phase 2.5 — Scope expansion (decided 2026-10-13)

Tracks 0 and 1 are done (above). Tracks 2 and 3 are independent of each other.

**Track 2 — catalog lookup** ([CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)):

- [ ] Catalog seam: contract, modular provider registry (runtime enable/disable), fake
      provider, `GET /catalog/search`
- [ ] Migration: nullable `catalog_*` refs on `list_items`, `kind` enum on `lists`
      (plus a `v1→v2` migration of the on-device document)
- [ ] Item-form type-ahead combobox + list-kind picker
- [ ] First-wave providers: Wikipedia → Deezer/iTunes → TMDB (+ attribution) → Photon,
      with the per-provider circuit breaker
- [ ] AWS protections: catalog on Lambda (reserved concurrency ~3), WAF rule, edge
      caching, `img.favfifty.com` image proxy
- [ ] Second-wave providers: IGDB, BoardGameGeek, AniList, podcasts, books
- [ ] Privacy policy: search text is relayed to third-party catalogs

**Track 3 — margin showcase** ([MARGIN_SHOWCASE_PLAN.md](MARGIN_SHOWCASE_PLAN.md)):

- [ ] `GET /showcase` with fake source; static-tile mock to settle the look
- [ ] Animation, reduced-motion, visibility pause, user off-toggle
- [ ] Real sources (TMDB trending, album charts) via the image proxy, after Track 2's
      TMDB key lands; route to Lambda with the catalog

## Phase 3 — Sharing & comments

- [ ] Public/private visibility flag on lists; shareable public URL (slug)
- [ ] Read-only public list view (no login required to view a shared list)
- [ ] Comments on lists (auth required to comment)
- [ ] Basic moderation hooks (delete own comment; owner can remove comments on their list)

## Phase 4 — Community

- [ ] Suggestions / questions on a list (distinct from comments)
- [ ] Voting on lists (one vote per user; prevent abuse)
- [ ] Browse / discovery page (recent, top-voted)
- [ ] User profiles (public lists, avatar from social provider)

## Phase 5 — Mobile apps (iOS + Android)

See [MOBILE_READINESS.md](MOBILE_READINESS.md). Prerequisites are mostly Track 0 above.

- [ ] Choose app technology (Q18: deferred; try Capacitor first)
- [ ] Bearer-token auth alongside the cookie (system-browser OAuth → one-time code → token)
- [ ] Android first; **iOS last**, with **Sign in with Apple** (App Store guideline
      4.8). Apple Developer Program, $99/yr (accepted)
- [ ] **In-app account deletion** (App Store 5.1.1(v), Google Play) incl. Apple token revocation
- [ ] Deep-link files (`apple-app-site-association`, `assetlinks.json`); Capacitor CORS origins
- [ ] Minimum-supported-version endpoint; on-device storage via the list repository

## Later / backlog

- Account page + avatars ([ACCOUNT_AND_AVATAR_PLAN.md](ACCOUNT_AND_AVATAR_PLAN.md);
  the avatar bug fix shipped, the rest isn't built)
- Email sign-in: options drafted, **not decided**
  ([EMAIL_SIGNIN_OPTIONS.md](EMAIL_SIGNIN_OPTIONS.md))
- Search _within_ a list's items, or across users (title/tag search of your own lists
  is done)
- Notifications (someone commented on / voted for your list)
- Reporting & moderation tools for _public_ content (report button, review queue),
  arriving with Phase 3
- Image storage in S3: copy catalog images from redirecting sources and user-pasted image
  URLs into our own bucket (privacy), before public lists ship
- Full Lambda (DB-backed routes off the box), deferred; needs a managed DB
  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md) §Future)
- Keep data on-device even when signed in, with bulk sync (owner idea, Q12)
