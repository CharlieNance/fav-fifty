# Things to Consider

Cross-cutting concerns to keep in mind as we build. Not a task list (see
[NEXT_STEPS.md](NEXT_STEPS.md)) — these are the "don't paint yourself into a corner"
notes that map to the priorities: **foundation, security, testability, cost,
extensibility, scalability.**

---

## Security (the repo is PUBLIC and handles user accounts)

- **No secrets in git, ever.** Real values live in the per-app `.env` files locally
  (`backend/.env`, `frontend/.env.local` — git-ignored) and in AWS Secrets Manager / SSM
  in deployed environments. Each app's `.env.example` documents its keys only. Consider a
  pre-commit secret scanner (e.g. `gitleaks`) and enable GitHub secret scanning + push
  protection.
- **OAuth done right.** Use the provider/Cognito SDKs; validate `state` (CSRF) and `nonce`,
  verify ID token signatures and audience, and store as little PII as possible (provider
  user id + display name + avatar URL — avoid storing emails if you don't need them).
- **Sessions/tokens.** Prefer secure, `HttpOnly`, `SameSite` cookies for the browser
  session over storing tokens in `localStorage` (XSS-resistant). Short-lived access,
  rotating refresh.
- **Treat all user content as hostile.** List titles, item text, and comments must be
  validated server-side and **escaped on render** to prevent XSS (Vue escapes by default —
  never use `v-html` on user content). Enforce length and count limits.
- **Authorization, not just authentication.** Every list/item/comment mutation must check
  the requester actually owns (or is allowed to touch) that resource. Don't trust IDs from
  the client.
- **Input validation everywhere** via Pydantic on the backend; never trust the frontend.
- **Rate limiting / abuse** — **moved pre-launch (2026-10-13)** because anonymous visitors
  can reach the backend: edge WAF rules, app rate limits, quotas, request hygiene —
  [ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md). Voting/comment-specific limits
  (one vote per user) still arrive with Phase 3/4.
- **HTTPS only.** TLS via CloudFront / ACM. Set sensible security headers (CSP, HSTS).
- **Dependencies.** Enable Dependabot; keep frontend and backend deps patched.
- **Anonymous use (2026-10 scope expansion).** First endpoints callable without a session
  (catalog lookup, showcase). Rate-limit per IP, cap request sizes, and never let a public
  endpoint burn a third-party quota unchecked — see
  [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md) §Abuse.
- **Device storage is untrusted input.** Anonymous lists live in `localStorage`, which the
  user (or an extension) can edit. Schema-validate on read; the import endpoint re-validates
  everything server-side exactly like a normal create.
- **Third-party API keys** (TMDB, IGDB, BGG, …) live only on the backend (`backend/.env`
  locally, SSM in AWS) — never in the SPA or a mobile binary.
- **The Lightsail box's IAM access key** (Lightsail has no instance roles) is the most
  sensitive credential in production. Scope it narrowly (only `/favfifty/*` SSM
  parameters, the backup bucket prefix, the WAF IP set), keep it only on the box, and
  rotate it.
- **Catalog image URLs** are restricted to an allowlist of provider image hosts; add those
  hosts to CSP `img-src`.
- **Origins behind CloudFront must not be reachable directly** — OAC for Lambda, a secret
  origin header for Lightsail ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)).

## Cost (this makes no money — keep it near-zero)

- **Set an AWS Budget + billing alarm first thing** (e.g. alert at \$5/\$10/\$20) so a
  misconfiguration can't quietly cost real money.
- **"Go down before a big bill" (owner, 2026-10-13).** Budgets alone can't do this —
  billing data lags hours to a day and AWS has no spend cap. The plan is three layers:
  services capped by construction (CloudFront flat-rate plan = no overages), usage-alarm
  tripwires driving an automatic breaker (degrade → maintenance), and budgets as the
  backstop — [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md).
- Prefer **scale-to-zero / pay-per-use / free-tier** services, *or* a small **fixed**
  price when that's more predictable. The decided topology is the latter on purpose: one
  ~\$12/mo Lightsail box running FastAPI + Postgres can't scale up its own bill
  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)). The biggest
  recurring-cost risks to avoid are NAT Gateways (~\$32/mo each), idle load balancers,
  and anything billed per request without a cap.
- **Static frontend on S3 + CloudFront** is essentially free at this traffic.
- Watch out for "serverless but with a fixed-cost dependency" (e.g. Lambda is cheap, but a
  pricey RDS Proxy or always-on RDS beside it isn't).
- Use **one AWS region** (likely `us-east-1`) and minimal environments to start.
- Revisit cost after the first month's bill; optimize with real numbers, not guesses.
- **Expected monthly bill after launch: ~$13–15, almost all fixed:**
  - the Lightsail box, ~$12;
  - snapshots, ~$1–2;
  - CloudFront ×2 on flat-rate Free plans, $0 with no overages (WAF and Route 53 DNS
    for the attached zone included);
  - Lambda, S3 and Cognito within their free tiers.
- **Fixed costs accepted or flagged (2026-10):**
  - **Accepted:** Apple Developer Program **$99/year** (only when the iOS app starts;
    iOS comes last) and Google Play **$25 one-time** ([MOBILE_READINESS.md](MOBILE_READINESS.md)).
  - **Flagged, not adopted:**
    - CloudFront **Pro at $15/mo**, only if the Free plan's 5 cache behaviors or
      allowance are outgrown;
    - **SMS alerts** (a toll-free number ~$2/mo + per-message fees), replaced by free
      push;
    - NAT (only for full Lambda, which is deferred);
    - RDS Proxy, Aurora.
  - **Excluded:** any API needing a billing card (e.g. Google Places).
- **External APIs are free-tier/fair-use**: cache results, respect rate limits, and have a
  fallback provider so a throttled API degrades suggestions rather than breaking anything.

## Testability

- Design for tests from day one: dependency injection in FastAPI, a test database, and
  pure functions for business logic kept separate from I/O.
- **Backend:** pytest, with unit tests for logic and a few integration tests hitting a real
  (ephemeral) Postgres. Factories/fixtures for data.
- **Frontend:** Vitest for unit/component tests; consider Playwright for a couple of
  end-to-end smoke tests later.
- **CI green = mergeable.** Run tests on every push (GitHub Actions) before anything else.
- Seed/fixture scripts so you can spin up realistic local data quickly.

## Extensibility

- **Clear boundaries:** keep API contracts (Pydantic schemas / OpenAPI) explicit so the
  frontend and backend evolve independently. Vue consumes the generated OpenAPI types.
- **Migrations from the start** (Alembic). Never edit the DB by hand; every schema change
  is a versioned migration.
- **Model for the roadmap, not just MVP.** Even if comments/votes come later, a relational
  schema lets you add those tables without rework. Avoid premature abstractions, but don't
  hard-code "exactly 50" assumptions where "a list of items" is the real concept.
- **Versioned API** (`/api/v1/...`) so you can evolve without breaking clients.
- **Feature-oriented folder structure** (group by feature, not by layer) scales better as
  features multiply.

## Scalability (low priority now, but cheap to not preclude)

- ≤10 concurrent users means **almost nothing needs to scale**. The goal is only to avoid
  decisions that would *prevent* scaling later.
- Stateless backend (session/state in DB or cookie, not in process memory) so you can run
  more than one instance if ever needed.
- A static SPA on CloudFront already scales globally for free.
- Don't over-engineer: no Kubernetes, no microservices, no multi-region. A single small
  box (app + Postgres) is correct for this scale. Running the *same* image on Lambda for
  the stateless routes is a deployment choice, not a microservice split: one codebase,
  one image. If the box is ever outgrown, the path is vertical first (a bigger
  Lightsail plan), then a managed Postgres.
- **Installed mobile apps can't be force-updated** — API changes within `/api/v1` are
  additive only ([MOBILE_READINESS.md](MOBILE_READINESS.md) §4).

## Legal / operational

- **Privacy policy & terms:** drafted in [docs/legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md)
  and [docs/legal/TERMS_OF_SERVICE.md](legal/TERMS_OF_SERVICE.md) (2026-07-31). Not attorney-
  reviewed, but accurate to what the app actually collects (see the auth decision below).
  Still need to: fill in the real contact email, and host them at real URLs (e.g.
  `favfifty.com/privacy`, `/terms`) before moving the Google OAuth consent screen to
  Production — see [SETUP.md §1](SETUP.md).
- **GDPR-ish basics:** be able to delete a user's account and their data on request.
  **Becomes a hard requirement for the mobile apps** — both stores require in-app account
  deletion ([MOBILE_READINESS.md](MOBILE_READINESS.md) §3).
- **Third-party data terms (2026-10 scope expansion):**
  - TMDB is free for **non-commercial** use only, requires a visible attribution
    notice + logo, and caps caching at 6 months.
  - OpenStreetMap data (Photon) requires "© OpenStreetMap contributors".
  - Fav Fifty is **never monetized** (QUESTIONS.md Q15), so non-commercial terms are
    fine. A voluntary donation link is generally compatible; re-read TMDB's terms
    before adding one.
- **Privacy policy:**
  - **Updated 2026-10-13:** operator access to stored content (Q24).
  - **Still owed when each piece ships:**
    - anonymous lists stay on the device until imported;
    - search text is relayed by our server to third-party catalogs (images come
      through our own proxy, so providers don't see visitors);
    - Cloudflare Web Analytics;
    - first-party `/events` (account id attached when signed in).
- **Backups:** there's no managed DB, so this is on us:
  - a nightly `pg_dump` to S3 plus Lightsail automatic snapshots;
  - **a test restore before launch**, then quarterly;
  - a runbook entry for restoring.

  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md) §Running the box)
- **OAuth app review:** since Fav Fifty only requests Google's non-sensitive scopes
  (`openid`, `email`, `profile`), moving to Production should **not** trigger Google's
  full verification review — just needs a live privacy policy URL and (per Google's
  process) verifying ownership of the authorized domain. Facebook and X, if ever added,
  are more likely to require a real app review — budget time for that separately.

## Observability (lightweight to start)

- Structured logging on the backend from day one.
- Logs stay **on the box** (rotated; no CloudWatch Logs ingestion cost). Metrics come
  from CloudFront/Lambda/Lightsail (free), plus a **Route 53 health check** on
  `/api/v1/health` as the uptime check.
- Don't add heavy APM tooling yet — note it for later if traffic ever grows.
- **Analytics + admin dashboards moved pre-launch (2026-10-13):**
  - Cloudflare Web Analytics (cookieless);
  - a minimal first-party event stream (account id when signed in, no IPs, 90-day
    retention);
  - product numbers and request/429 counters from Postgres;
  - a CloudWatch health dashboard and a daily cost snapshot;
  - errors via logs only, for now.

  [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)
