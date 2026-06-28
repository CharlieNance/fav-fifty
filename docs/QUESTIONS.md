# Open Questions & Decisions

> ✅ **Resolved (2026-06-28).** These are now decided — see **[DECISIONS.md](DECISIONS.md)**
> for the summary. This file is kept as the record of the deliberation and trade-offs.
> Remaining open/deferred items are tracked at the bottom of DECISIONS.md.

Decisions to make before (or early in) building. Each has my recommendation and the
trade-offs. As you decide, record the answer and move the resolved detail into the
README / CLAUDE.md / CONSIDERATIONS.md. **Owner: please mark a choice for each.**

---

## 1. Database: PostgreSQL vs DynamoDB ⭐ (biggest decision)

The data is relational: users own lists, lists have ordered items, lists have
comments, votes, suggestions. The social roadmap (sharing, comments, voting,
discovery) involves lots of relational queries and joins.

- **Option A — PostgreSQL (recommended).** Natural fit for the relational/social
  features and easy to evolve as requirements grow. Mature tooling (SQLAlchemy,
  Alembic migrations). Cost is the catch on AWS:
  - *Aurora Serverless v2* can now scale **to zero** when idle (auto-pause) — cheap
    at this traffic, but cold starts add latency on the first request.
  - *RDS `t4g.micro`* is simple and ~\$12–15/mo always-on (often free first 12 months).
- **Option B — DynamoDB.** Truly scales to zero, pay-per-request, effectively free at
  this scale, fully serverless. **But** relational access patterns (comments per list,
  votes, "all lists by user", discovery) require careful single-table design up front,
  and it's harder to evolve for features you haven't designed for yet — at odds with
  "extensibility."

**Recommendation:** **PostgreSQL** (Aurora Serverless v2 if you want scale-to-zero,
RDS t4g.micro if you want simplest/predictable). The relational model will save far
more developer time than DynamoDB saves in dollars at 10 users.

> **Decision:** Yeah let's go with PostgreSQL Aurora Serverless V2

---

## 2. Backend hosting / compute

- **Option A — AWS Lambda + API Gateway.** Scales to zero, cheapest when idle. FastAPI
  runs via an adapter (Mangum). With Postgres, needs care around DB connections
  (RDS Proxy, or use Aurora's Data API). Cold starts.
- **Option B — Container (App Runner / ECS Fargate / Lightsail Containers).** Simpler
  mental model; runs the FastAPI app as-is in Docker. App Runner scales down but has
  some cost; Lightsail is a flat ~\$5–10/mo.
- **Option C — Single small instance (Lightsail / EC2 `t4g.micro`).** Cheapest fixed
  cost, simplest, least "scalable" but fine for ≤10 users.

**Recommendation:** Start with **a container on App Runner or Lightsail** for
simplicity (FastAPI runs unchanged, easy local↔prod parity via Docker). Revisit Lambda
later if cost matters — at this scale the difference is dollars.

> **Decision:** Yeah I like option B I want to work more with Docker and Lightsail anyway so that sounds good

---

## 3. Auth broker: AWS Cognito vs roll-your-own OAuth

Requirement: social login only (Google, Facebook, Twitter/X), no email/password.

- **Cognito (recommended)** handles OAuth, token issuance, sessions, and has a generous
  free tier (50k MAUs). **Gotcha:** Cognito's *native* social IdPs are Google, Facebook,
  Amazon, and Apple. **Twitter/X is not native** — it must be added as a generic
  **OIDC/OAuth2** provider, and X's OAuth has historically been finicky and its API
  access has changed/cost money. Plan to **launch with Google + Facebook**, add Twitter/X
  afterward (or swap it for Apple, which Cognito supports natively).
- **Roll-your-own** with a library like Authlib gives full control over every provider
  but means you own token security, session management, and refresh logic — more
  surface area to get wrong on a public, security-sensitive app.

**Recommendation:** **Cognito**, launch with Google + Facebook, add Twitter/X (OIDC)
in a later step. Confirm whether **Twitter/X at launch is a hard requirement.**

> **Decision:** Cognito sounds good for this
> Is Twitter/X required at launch, or OK to add later? Yeah, let's scrap Twitter login, I don't really care about supporting that, in fact let's just support Google for now, but it might be nice to add Facebook and Apple later

---

## 4. Infrastructure as Code: Terraform vs AWS CDK

- **Terraform** — cloud-agnostic, huge community, declarative.
- **AWS CDK** — define infra in TypeScript/Python; nice if you want one language with the app.

**Recommendation:** **Terraform** for portability and simplicity, unless you'd prefer
writing infra in Python/TS to match the app (then CDK).

> **Decision:** Yeah let's go with Terraform

---

## 5. Frontend specifics

- TypeScript? **Recommended: yes** (catches errors, better tooling).
- Component library / styling — Tailwind CSS? A Vue UI kit (PrimeVue, Vuetify)? Plain CSS?
- **Recommendation:** Tailwind for speed + a lightweight headless component set, or
  PrimeVue if you want ready-made components.

> **Decisions:** TS? TypeScript for sure, let's setup a linter and front end test if we can  Styling: Yeah I want Tailwind for the UI I want to make the site fun and kind of stand out. I will need to spend some time thinking of color themes and layout, I don't want it to look generic

---

## 6. Repository structure: monorepo vs separate repos

`frontend/` and `backend/` in **one repo (recommended)** for a solo dev — atomic changes,
one place for issues/CI. Split later only if needed.

> **Decision:** yeah they can both be in the same repo

---

## 7. Domain, DNS, and email

- Is `favfifty.com` DNS managed in **Route 53**, or elsewhere (registrar/Cloudflare)?
- Do we need to **send email** (e.g. notifications later)? If so, AWS SES requires
  domain verification and moving out of the sandbox.

> **Where is DNS?** I have it registered through SquareSpace but I would like to manage it through Route 53 if that is possible   **Need email soon?** I probably will eventually, but not for now

---

## 8. License

Public repo — pick a license. **MIT** (permissive) is the common default for a personal
project. Or "all rights reserved" if you don't want reuse.

> **Decision:** I added the MIT license in the repo root

---

## 9. Environments

How many? Recommendation: **local + production** to start (cheapest); add **staging**
only if/when needed. Each extra environment adds cost.

> **Decision:** yeah let's do local and production, but I probably will want a staging server some day.

---

## 10. Misc product questions (can defer)

- Are lists always exactly 50 items, or "up to 50"? Can a list be saved partially filled?
- Are items just text, or do they have extra fields (rank, note, image/link)?
- One list per category per user, or many lists, any category, free-form names?
- Should categories be a fixed/curated set or fully user-defined free text?

> **Notes:** Yeah people should be able to save and come back to lists, and publish/unpublish. Yes I think we will want to support ranking, notes, and image links, I might even setup some storage to store images but not now. Users should be able to have multiple lists. I would like to maybe add categorieis at some point, but to start can we support tags? so a list can have multiple tags, users can enter free form, eventually those tags may become cateogires and we can use the tags people have added to generate a list of categories. 
