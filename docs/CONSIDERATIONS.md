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
- **Rate limiting / abuse** will matter once comments and voting exist (one vote per user,
  throttle writes). Note now, implement in Phase 3/4.
- **HTTPS only.** TLS via CloudFront / ACM. Set sensible security headers (CSP, HSTS).
- **Dependencies.** Enable Dependabot; keep frontend and backend deps patched.

## Cost (this makes no money — keep it near-zero)

- **Set an AWS Budget + billing alarm first thing** (e.g. alert at \$5/\$10/\$20) so a
  misconfiguration can't quietly cost real money.
- Prefer **scale-to-zero / pay-per-use / free-tier** services. The biggest recurring-cost
  risks are: an always-on database, NAT Gateways (~\$32/mo each — avoid; design to not
  need one), and idle load balancers.
- **Static frontend on S3 + CloudFront** is essentially free at this traffic.
- Watch out for "serverless but with a fixed-cost dependency" (e.g. Lambda is cheap, but a
  pricey RDS Proxy or always-on RDS beside it isn't).
- Use **one AWS region** (likely `us-east-1`) and minimal environments to start.
- Revisit cost after the first month's bill; optimize with real numbers, not guesses.

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
  service + managed DB is correct for this scale.

## Legal / operational

- **Privacy policy & terms** become relevant once you store user data and use social login
  (Google/Facebook/X require a privacy policy URL to approve OAuth apps). Plan a simple one.
- **GDPR-ish basics:** be able to delete a user's account and their data on request.
- **Backups:** enable automated DB backups/snapshots even at small scale.
- **OAuth app review:** Facebook and X in particular may require app review / business
  verification before non-test users can log in — budget time for this, it can be slow.

## Observability (lightweight to start)

- Structured logging on the backend from day one.
- CloudWatch for logs/metrics; a basic uptime check on `favfifty.com`.
- Don't add heavy APM tooling yet — note it for later if traffic ever grows.
