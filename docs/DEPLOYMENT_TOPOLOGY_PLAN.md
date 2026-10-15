# Deployment Topology — One Lightsail Box + Lambda for Stateless Routes

Planning doc for how Fav Fifty runs in AWS. **Decided 2026-10-13**
([QUESTIONS.md](QUESTIONS.md) Q16, Q17, Q19, Q20). It replaces the earlier
"Lightsail Containers + Aurora Serverless v2" plan. Nothing is deployed yet;
`infra/` doesn't exist. Related: [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md),
[MOBILE_READINESS.md](MOBILE_READINESS.md) §4,
[ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md).

## The decided shape

```text
 web / iOS / Android
        │   always: https://favfifty.com/...   (one origin for SPA + API)
        ▼
 CloudFront distribution #1 — favfifty.com   (flat-rate Free plan: $0, no overages; WAF on)
        ├── /*                   ─►  S3 bucket: the Vue SPA (static files)
        ├── /api/v1/*            ─►  Lightsail instance: FastAPI + Postgres (Docker Compose)
        ├── /api/v1/catalog/*    ─►  Lambda (same image, stateless, no DB)
        └── /api/v1/showcase*    ─►  Lambda (same image, stateless, no DB)

 CloudFront distribution #2 — img.favfifty.com   (second flat-rate Free plan: $0)
        └── /tmdb/* /dz/* /apple/* /wiki/* …  ─►  provider image CDNs (proxied, cached)
```

- **One Lightsail instance (2 GB RAM, ~$12/month fixed)** runs Docker Compose:
  FastAPI, **Postgres 16** (the same image as local `docker-compose.yml`), and a small
  reverse proxy (e.g. **Caddy**, Apache-2.0, automatic HTTPS for an
  `origin.favfifty.com` hostname) so CloudFront talks to the box over TLS. A static
  IP is free while attached.
- **Postgres lives on the box**, listening only on the Docker network (never a public
  port). That means no Aurora, no VPC peering, and no 15-second database wake-ups.
  **Aurora is deferred, not rejected:** the app uses plain SQLAlchemy, Alembic and
  Postgres, so moving later is a `pg_dump` / restore plus config.
- **Frontend:** the static SPA in S3 behind CloudFront, as already planned.
- **Lambda:** only the **stateless** route groups (catalog lookup, showcase) run on
  Lambda, outside any VPC (so they have free internet access to providers and need no
  NAT). They use the **same Docker image** via the AWS Lambda Web Adapter. Those
  routes never touch the database, and the Lambda copy has no DB credentials at all.
  This is the "hybrid", and it's where the catalog's AWS-enforced limits come from
  (Q16: WAF + edge caching + reserved concurrency).
- **Images:** a **second distribution** (`img.favfifty.com`) on its own flat-rate
  Free plan proxies provider image CDNs, so providers never see visitor IPs (Q17).
  An account can hold 3 Free plans; this uses 2.

## One public URL, switching at the edge

- **`https://favfifty.com/api/v1`** for every client, forever (Q19). The API and the
  SPA share an origin, which means:
  - **No CORS and no cross-site cookies on the web.** The old "API on
    `api.favfifty.com` + shared cookie domain" deploy-time to-do is gone.
  - Mobile apps call the same URL with bearer tokens.
- **What changes because of Q19 (small, since nothing is deployed):**
  - The app serves `/api/v1/...` itself, and the Vite dev proxy stops stripping `/api`
    (NEXT_STEPS.md Track 0).
  - `VITE_API_BASE_URL` stays the default relative `/api/v1`, with no absolute API
    origin in production.
  - The Cognito app client's prod **callback URL** becomes
    `https://favfifty.com/api/v1/auth/callback` (console setting plus
    `COGNITO_REDIRECT_URI`). See [SETUP.md](SETUP.md) §3 Step D.
- **Route groups → origin are a Terraform map:**

  ```hcl
  api_routing = {
    default  = "lightsail"   # pinned: needs the DB
    catalog  = "lambda"      # stateless: may flip between lambda and lightsail
    showcase = "lambda"
  }
  ```

  Stateless groups can be flipped between Lambda and the box with
  `terraform apply`, with no client release. **DB-backed routes are pinned to the
  box.** Moving them to Lambda would first need a managed database (see §Future:
  full Lambda).
- **Cache-behavior budget (Free plan = 5):** SPA default, `/api/v1/*`, catalog and
  showcase use **4**, leaving 1 spare. Only AWS-managed cache/origin policies are
  available on Free, and they're all we need:

  | Behavior | Policies |
  | --- | --- |
  | API | `CachingDisabled` + `AllViewerExceptHostHeader` |
  | Catalog | `UseOriginCacheControlHeaders-QueryStrings`, so identical searches are served from the edge (Q16) |
  | SPA | `CachingOptimized` |

## Same code, same image

- **One Docker image** is built in CI. The box runs it under Docker Compose; Lambda
  runs the same image through the **Lambda Web Adapter**. There's no second
  entrypoint, so what we test is what runs.
- **Lambda origin type:** prefer **Lambda Web Functions** behind CloudFront OAC. No
  request-body hash is needed, and the viewer's `Authorization` header passes
  through. Fall back to a Function URL with a secret header if Web Functions aren't
  in Terraform yet. Confirm at build time.
- **Configuration comes from the environment plus SSM Parameter Store** (standard
  parameters are free): secrets, provider keys, and the **runtime settings**
  (switches and limits, see [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)).
- **Portability rules** (also in CLAUDE.md), so any stateless route can move between
  the box and Lambda:
  - No in-process background work after the response; use a queue when that need
    appears.
  - In-process caches are optimizations only; correctness can't depend on them.
  - Redirect URLs come from settings, never the `Host` header (true today).
  - App startup must not *require* a DB connection. The Lambda copy has none, and
    SQLAlchemy connects lazily already; keep it that way.
  - Request bodies stay well under Lambda's 6 MB limit.

## Running the box (what we own now that there's no managed DB)

- **Backups:**
  - A nightly `pg_dump` to S3 (cron on the box), with a lifecycle rule keeping ~30
    days. Pennies, covered by the plan's 5 GB S3 credit.
  - **Lightsail automatic snapshots** of the instance (daily, ~$0.05/GB-month).
  - **One test restore before launch,** then quarterly.
- **Updates:** unattended OS security updates. Postgres minor versions by bumping the
  image tag. Major upgrades are rare and planned (dump/restore).
- **Single point of failure:** if the box dies, restore from a snapshot (minutes to
  an hour). Fine for a hobby app at ≤10 concurrent users. Anonymous on-device lists
  are unaffected, and the static SPA keeps loading from S3.
- **Security:**
  - Postgres is never on a public port.
  - The Lightsail firewall allows SSH only from the owner's IP (or uses browser SSH
    only).
  - The API rejects requests without CloudFront's **secret origin header**
    (Lightsail has no OAC).
  - Automatic security updates.
- **AWS credentials on the box:** Lightsail instances can't use IAM instance roles, so
  the box needs an **IAM user access key** to read SSM parameters and write backups
  to S3. Give that user a **narrow** policy (only `/favfifty/*` parameters and the
  backup bucket prefix), store the key only on the box (never in git), and rotate it.
  It's the main credential to protect.
- **Logs stay on the box:** Docker's json-file driver with rotation (`max-size`,
  `max-file`), so there's **no CloudWatch Logs ingestion cost** and no disk-full
  surprise. Request counters the dashboards need (429s, errors) are aggregated by the
  app into Postgres; see ADMIN_AND_ANALYTICS_PLAN.md.
- **Health:**
  - A **Route 53 health check** on `/api/v1/health` (the first 50 are free) with an
    alarm.
  - Lightsail's built-in instance metrics (CPU, network, burst capacity) are free.
- **Connection pool:** one box means ordinary SQLAlchemy pooling. Keep the pool small;
  Postgres `max_connections` defaults are plenty.

## Cost picture (per month)

| Item | Cost |
| --- | --- |
| Lightsail instance, 2 GB (includes ~3 TB transfer, a static IP, a 60 GB SSD) | **~$12, fixed** |
| Lightsail automatic snapshots | ~$1–2 |
| CloudFront ×2 on flat-rate Free plans (incl. WAF, DDoS protection, Route 53 DNS for the attached zone) | **$0, no overages** |
| Lambda for catalog/showcase (capped by reserved concurrency) | ~$0 (free tier) |
| S3 (SPA + backups) | ~$0 (S3 credit) |
| Cognito | $0 (free tier) |
| **Expected total** | **~$13–15/month, almost entirely fixed** |

The flat-rate CloudFront plans require the AWS account to be on the **Paid** account
plan. The owner is ~4 months into the credit-based Free account plan, so upgrading
is part of the first deploy. See COST_GUARDRAILS_PLAN.md §Account timeline.

## Testing parity

- One pytest suite. Every runtime serves the same code.
- CI builds the image once and smoke-tests it under `docker run`. The Web Adapter
  image also serves plain HTTP locally.
- An OpenAPI snapshot check in CI keeps the contract stable for web and mobile
  (MOBILE_READINESS.md §4).
- `GET /api/v1/health` reports `deploy_target` (`lightsail` / `lambda`) and the git
  SHA, so you can see which runtime served a request.
- Playwright e2e takes a `BASE_URL`, so the same journey runs against production.

## Terraform layout (sketch)

```text
infra/
  modules/
    lightsail_box/   # instance, static IP, firewall, snapshots, IAM user for the box
    static_site/     # S3 + OAC for the SPA, .well-known files
    lambda_api/      # image function(s) for stateless routes, Web Function endpoint, IAM
    edge/            # distribution #1 + api_routing → behaviors, WAF rules, flat-rate plan
    images_edge/     # distribution #2 (img.favfifty.com) → provider origins
    guardrails/      # budgets, alarms, SNS, breaker Lambda (COST_GUARDRAILS_PLAN.md)
  envs/prod/         # api_routing + plan settings live here
```

Docker Compose for the box (`deploy/compose.prod.yml` or similar) sits next to the
existing local `docker-compose.yml`, so local and production stay recognisably the
same.

## Future: full Lambda (deferred, not planned)

Moving the DB-backed routes to Lambda would mean:

1. Moving Postgres to a managed service Lambda can reach (Aurora Serverless v2, RDS);
2. solving Lambda-in-VPC internet access (fck-nat ~$3–4/month; a NAT Gateway at $32+
   is avoided);
3. `NullPool` connections and handling cold starts.

The earlier version of this doc (git history) has the full analysis. Revisit only if
the box becomes a real limitation. At ≤10 concurrent users it won't be.

## Sequencing

1. **Track 0 (before any deploy):** the `/api/v1` prefix, the OpenAPI snapshot, and
   `deploy_target` in health (NEXT_STEPS.md).
2. **First deploy:**
   - Upgrade the AWS account to Paid, with budgets set *before* the upgrade.
   - Terraform: the box, S3, distribution #1 on the Free plan with WAF; update the
     Cognito callback URL.
   - Get backups running and do the test restore.
3. **Cost guardrails + game day** (COST_GUARDRAILS_PLAN.md) before announcing.
4. **Hybrid:** when catalog lookup lands, route catalog and showcase to Lambda with
   reserved concurrency; add distribution #2 for images.
