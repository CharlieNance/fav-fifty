# Open Questions & Decisions

> ✅ **Round 1 resolved (2026-06-28).** Questions 1–10 are decided — see
> **[DECISIONS.md](DECISIONS.md)** for the summary. They're kept here as the record of the
> deliberation and trade-offs.
>
> ✅ **Round 2 resolved (2026-10-13).** Questions 11–25 (scope expansion + pre-launch
> hardening) are answered — see **[§Round 2](#round-2--scope-expansion-2026-10-13)** at the
> bottom for the deliberation, and [DECISIONS.md](DECISIONS.md) §Scope expansion for the
> summary. Q18 (mobile app technology) is intentionally deferred until mobile work starts.

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
>
> *Superseded 2026-10-13 by Q20: Postgres in Docker on a Lightsail instance; Aurora deferred.*

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
>
> *Superseded 2026-10-13 by Q20: a Lightsail **instance** running Docker Compose (Option C's
> shape, still Docker + Lightsail), plus Lambda for stateless routes.*

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

---

## Round 2 — Scope expansion (2026-10-13)

The owner's pivot (still pre-launch): **(1)** allow anonymous users, **(2)** keep their
lists on-device as JSON and upload on sign-up, **(3)** find-as-you-type lookup for
movies/shows/music/places/… via the Python backend, **(4)** scrolling album/movie art in
the page margins — plus readiness for **iOS/Android apps** and running the backend on
**Lightsail, Lambda, or a hybrid** without the clients noticing. Plans:
[ANONYMOUS_AND_LOCAL_LISTS_PLAN.md](ANONYMOUS_AND_LOCAL_LISTS_PLAN.md),
[CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md),
[MARGIN_SHOWCASE_PLAN.md](MARGIN_SHOWCASE_PLAN.md),
[MOBILE_READINESS.md](MOBILE_READINESS.md),
[DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md).

Same format as Round 1: recommendation + trade-offs; **owner fills in the Decision line.**

---

## 11. Anonymous lists: device-only, or server-side guest accounts?

- **Option A — Device-only (recommended).** Anonymous lists live in browser storage as
  versioned JSON; nothing hits our DB until the user signs in and imports. Cheapest, most
  private, no abuse/cleanup surface. Risk: Safari wipes site storage after 7 days without
  a visit — mitigated by "saved on this device" copy, Export, and nudges to sign in.
- **Option B — Server guest accounts.** A real `users` row per visitor keyed by a device
  token. Survives Safari's wipe and could allow sharing anonymous lists, but stores data
  from people who never accepted the Terms, needs a second auth mechanism, and needs
  cleanup jobs.

**Recommendation:** **A**, behind a list-repository interface so B could be added later.

> **Decision:** Option A — Device-only (recommended).

---

## 12. Importing local lists on sign-in: conflicts and failures

- Title already exists in the account → **rename `"Title (2)"` and tell the user**
  (recommended) vs skip vs merge items into the existing list.
- One list in the upload is invalid (e.g. 51 items after hand-editing storage) → **reject
  the whole import with a clear message** (recommended; one transaction, simple to reason
  about) vs import the valid ones and report the rest.
- After a successful import → **clear the local copy** (recommended) vs keep it read-only
  for a while.

> **Decision:** For title: rename `"Title (2)"` and tell the user. For invalid list yeah reject the import and provide a message saying why. We can clear local copy on successful import. I would like to think about keeping all data on device and doing more bulk uploads at some point, but for now let's just clear the local copy

---

## 13. "What's this list of?" — a fixed list *kind*, separate from tags?

Catalog lookup needs to know which catalog to search. Options:

- **Fixed small enum on `lists.kind`** (movie, tv, album, artist, song, place, book,
  game, … , `anything`), separate from tags (**recommended**). Kind drives *behavior*;
  tags stay free-form *labels*.
- **Infer from tags** (a list tagged "movies" searches TMDB) — no new field, but fragile.
- **Make this the curated category system** DECISIONS.md deferred — bigger, and categories
  were meant to be mined from tags later.

> **Decision:** Fixed small enum on `lists.kind`

---

## 14. Catalog providers at launch

Recommended launch set, all **$0** and only one key needed: **TMDB** (movies/TV, free
non-commercial, attribution required), **Deezer** with **iTunes** fallback (music,
keyless), **Photon** (places, OSM, built for type-ahead), **Wikipedia** ("anything"
fallback). Notable *no*s: **Spotify** (Feb 2026 dev-mode rules: 5 users, Premium-owned,
250k-MAU business for more), **public Nominatim** (its policy forbids autocomplete).

- **Google Places** has the best restaurant/bar data and a free monthly cap, but requires
  a billing card — a quota mistake costs real money. Use it, or stick with OSM/Photon?
  (**Recommendation:** Photon now; revisit if place results disappoint.)
- Which **later** kinds matter most to the community — books, video games, board games,
  podcasts, anime?

> **Decision:** yeah all that sounds good, I don't really mind needing a key, as long as the cost is low or 0 let's setup all the APIs we can. In keeping with our modularity first design principle I would like to make it easy to add and remove API sources, maybe even a way to disable them, in a config, or through a admin portal.

---

## 15. Will Fav Fifty ever make money (ads, donations, paid tier)?

Matters now because **TMDB's free API is non-commercial-only** (and several others are
similar). Donations/tip-jar are usually fine; ads or a paid tier would need a TMDB
commercial agreement or a different movie source.

> **Owner note (2026-10-13, in chat):** "this is never going to make money" — confirm
> below and this resolves as *non-commercial forever*.
>
> **Decision:** No, I think I can commit now to saying, this will never have ads or make money, and will stay open source forever. If this isn't alloewd it is fine, but I had thought about adding a PayPal donation link, in case somone wants to donate, but I'm never going to charge, or put up ads. I in no way see this as a money making venture it is a hobby/showcase/AWS learning adventure

---

## 16. Rate limiting for public endpoints

Catalog lookup and the showcase are the first endpoints usable without signing in.

- **In-process limits per instance (recommended now)** — free, fine at this scale; weak
  on Lambda where instances are many and short-lived.
- **Shared store** (Postgres table or DynamoDB with TTL) — correct across instances;
  build when Lambda serves these routes or abuse appears.
- **AWS WAF rate rules** — ~$5+/mo fixed on pay-as-you-go, **but included at $0 with the
  CloudFront flat-rate Free plan** (see Q22). If we adopt that plan, edge rate limiting
  becomes the primary layer and app-level limits are the second.
  ([ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md))

> **Decision:** Catalog/showcase limits are enforced by AWS, not app code: WAF per-IP rate rule at the edge, CloudFront caching of identical searches, and Lambda reserved concurrency (~3) as the global cap on upstream calls. Python keeps only a per-provider circuit breaker. No shared rate-limit store unless we adopt a provider with a daily quota (then a DynamoDB counter). App-level per-user limits stay for signed-in write routes per ABUSE_PROTECTION_PLAN.md. 

---

## 17. Margin showcase — look and behavior

Proposed defaults (see MARGIN_SHOWCASE_PLAN.md): shown only on wide screens (≥1280px);
**posters on the left, album covers on the right**; low opacity with edge fades; slow
opposing-direction scroll; off for `prefers-reduced-motion`; plus a user toggle to turn it
off. Images are hotlinked from TMDB/Deezer/Apple CDNs (free, but those CDNs see visitor
IPs) vs proxied through our CloudFront (more private, small cost).

- Confirm or adjust the look (worth a quick static mock first).
- Hotlink (recommended) or proxy?
- Later: switch the source to items from **published community lists**?

> **Decision:** shown only on wide screens (≥1280px);
> **posters on the left, album covers on the right**; low opacity with edge fades; slow
> opposing-direction scroll; off for `prefers-reduced-motion`; plus a user toggle to turn it
> off. Proxy the catalog and showcase images through img.favfifty.com on a second Free flat-rate plan. That's $0 and the worst case is slower delivery. Pick launch providers whose images don't redirect, and treat copying images into S3 as the later fix for redirecting sources and pasted URLs

---

## 18. Mobile app technology

- **Capacitor** wrapping the Vue app (**recommended** — maximum reuse for a solo dev).
- React Native / Flutter (new UI codebase), or native Swift + Kotlin (two).

Also: accept the **Apple Developer Program at $99/year** (needed for the App Store *and*
for Sign in with Apple, which App Store guideline 4.8 effectively requires once Google
login is offered in an iOS app)? Google Play is $25 one-time.

> **Decision:** Okay Apple will come last but $99 a year is fine, and $25 one time for Android is cool. I've never used Capacitor, I can look into that. I don't love the idea of re-writing the front end. but Not the end of the world if we had to. App comes later so I'm gonna leave that one for now.

---

## 19. Public API URL and versioning

- **`https://favfifty.com/api/v1`** — same origin as the SPA (**recommended**): no CORS, no
  cross-site cookie headaches, one CloudFront distribution routes everything.
- `https://api.favfifty.com/v1` — separate origin; needs CORS + a shared cookie domain.

Either way: add the `/api/v1` prefix in the app **before launch**, and adopt "additive-only
within v1" as a rule.

> **Decision:** I think I like https://favfifty.com/api/v1 but right now the front end is on that and backend is on api. so I thiink this will require some code re-writing

---

## 20. Backend topology path

Recommended sequence (see DEPLOYMENT_TOPOLOGY_PLAN.md): **(1)** first deploy on Lightsail
behind CloudFront routing, **(2)** move catalog + showcase to non-VPC Lambda (hybrid, $0,
no NAT), **(3)** trial full Lambda with fck-nat (~$3–4/mo) and keep whichever is better.
Also needs deciding before the first deploy regardless: **Aurora in the default VPC** so
Lightsail can reach it via VPC peering.

> **Decision:** One Lightsail instance (2 GB): Docker Compose with FastAPI + Postgres, frontend on S3/CloudFront
> Note, not using Aurora so need to deal with -
>
> - Backups: a nightly pg_dump to S3 (pennies, covered by the S3 credit) plus Lightsail automatic snapshots (about $0.05/GB-month). One test restore before launch.
> - Updates: OS security updates set to automatic; Postgres minor upgrades by bumping the image tag. Major upgrades are rare.
> - Single point of failure: if the box dies, you restore from a snapshot (minutes to an hour). That's fine for a hobby app with ≤10 concurrent users, and anonymous lists on people's devices aren't affected at all.
> - Security: Postgres listens only inside Docker, never on a public port; SSH is limited to your IP; the API only accepts requests from CloudFront (secret origin header).

---

## Pre-launch hardening (added 2026-10-13, same round)

Owner call: rate limiting/abuse hardening, analytics, an admin portal (account locking
UI + dashboards), and **"go down rather than get a crazy bill"** all move before launch.
Plans: [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md),
[ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md),
[ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md).

---

## 21. Cost ceilings — the numbers

What should trip what? Proposed (monthly, all tunable later):

- **$10** forecast/actual → email only.
- **$25**, or any usage tripwire → **Level 1 (degrade)**: catalog, showcase, analytics,
  import and new sign-ups switch off; WAF tightens. Existing lists keep working.
- **$50**, or tripwires still firing after Level 1 → **Level 2 (maintenance)**: API
  returns a friendly "taking a breather" page; Lambda concurrency → 0, Lightsail
  disabled, Aurora stopped. Anonymous on-device lists are unaffected.
- **Recovery:** Level 2 is **manual reset only** (recommended — you look before it comes
  back). Level 1 auto-clears after a quiet hour, or also manual?

> **Decision:** Yeah that sounds fine, I think we could even go up to $25 for email, $50 for downgrade, $100 for Maintenance and yeah if we get up to that it should require a manual revive, but any notification I can get at that point would be good, repeat emails, maybe evena text if there is a free way to do that.

---

## 22. AWS account plan + CloudFront flat-rate plan

- **Which AWS account plan is the account on?** Since July 2025, new accounts pick a
  credit-based **Free account plan** (cannot be billed at all, but ends after 6 months or
  when credits run out — then upgrade to Paid or the account closes) or the **Paid** plan.
  Check *Billing → Free Tier / Account plan*. This decides timing: the flat-rate
  CloudFront plan below isn't available to accounts on the Free account plan.
- **Adopt the CloudFront flat-rate *Free* plan ($0)?** (**Recommended.**) No overage
  charges ever — beyond 1M requests / 100 GB a month AWS may slow delivery instead of
  billing. Includes WAF (5 rules incl. IP rate limiting), DDoS protection, Route 53 DNS
  for the attached zone, log ingestion. Limits: 5 cache behaviors (our route groups fit
  exactly), managed cache/origin policies only. The next tier, **Pro, is $15/mo fixed**
  (flagged) — only if we outgrow Free.

> **Decision:** I'm on the free account plan now, but I think I have been on it for 4 months, so it is likely I will have to upgrade to a paid plan before we launch. But if there is a way to "Adopt the CloudFront flat-rate" and stay on that, yeah let's do that

---

## 23. Analytics tooling

- **Traffic:** Cloudflare Web Analytics (free, cookieless) vs GoatCounter (free for
  non-commercial, open-source) vs none (CloudFront logs only). **Recommendation:** either
  of the first two — pick on taste; both avoid cookies and consent banners.
- **Product events:** a minimal first-party `/events` endpoint (allowlisted event names,
  no user id/IP/free text, daily-rotating session id, 90-day retention) —
  **recommended**, it's the only way to see anonymous usage. OK?
- **Error tracking:** logs only (recommended to start) vs Sentry free tier (third party).

> **Decision:**Cloudflare Web Analytics. Yeah an /events endpoint is cool. I'm not worried about tracking user id or IP Addresses. And for Error tracking we can just do logs for now.

---

## 24. Admin powers and privacy

- **Who is an admin?** Recommendation: just you, granted via a CLI script only (no API
  can grant admin).
- **May an admin view a user's private lists?** Useful for abuse reports and debugging;
  every view would be audit-logged and the privacy policy would disclose it. Or: admins
  can lock/unlock and delete, but never *read* private content. (**Recommendation:**
  allow, with audit log + disclosure — you'll need it once anything goes wrong.)

> **Decision:** Yeah, I just me as admin, nothing should be able to elevate another account to admin. I do think I should be able to read private lists, I have DB access anyway, and it might be needed to deal with debugging, or account investigations. We should update the privacy policy so users know that their data is not private, but that I'm not going to sell it or use it for anythnig or post it.

---

## 25. Product quotas (new limits alongside the 50-item cap)

Proposed: **100 lists per user**, **10 tags per list**, description ≤ 1,000 chars,
**2,000 write actions per user per day**, import ≤ 100 lists per request. Bounds storage
and scripted abuse; generous for real people. Adjust any?

> **Decision:** I think those are all fine defaults but I would like them in config files so I can change them on the fly. If someone really did want to make more than 100 lists I'm fine with that, but I doubt anyone would so that seems fine for now. Let's do a limit of 25 tags just in case.
