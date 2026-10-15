# Catalog Lookup ("Find As You Type") — Implementation Plan

Planning doc for **type-ahead suggestions** while adding an item to a list: start
typing "In Rai…" in a list of albums and pick *In Rainbows (Radiohead, 2007)* with its
cover art filled in. The suggestions come from free or cheap external catalogs
(movies, TV, music, places, …), called **from the Python backend, never from the
client**. Part of the 2026-10 scope expansion ([NEXT_STEPS.md](NEXT_STEPS.md)).
Nothing is built yet. Decided in [QUESTIONS.md](QUESTIONS.md) (2026-10-13):

- **Q13:** a fixed `lists.kind` enum.
- **Q14:** set up every provider that's free or nearly free, keyed or keyless, and
  make providers **easy to add, remove and disable** (config plus the admin
  portal).
- **Q15:** never monetized, so non-commercial terms are fine.
- **Q16:** limits are enforced by AWS: WAF, edge cache, Lambda reserved
  concurrency.
- **Q17:** images are proxied through `img.favfifty.com`.

"FAYT" in the owner's notes means "find as you type". This doc calls the feature
**catalog lookup** and each external API a **catalog provider**.

## Scope

### In scope

- `GET /catalog/search?kind=<kind>&q=<text>` on the backend, returning a normalized
  list of suggestions from the right provider for that kind.
- Kinds: **movie, tv, album, artist, song, place, book, video game, board game,
  podcast, anime**, and a generic **"anything"** fallback (Wikipedia). Q14 says set
  up everything that's free, so **every kind in the shortlist below is in scope**.
  They're still **built one provider at a time** (see §Build order); the first few
  prove the pattern.
- A **list kind** ("What's this list of?") chosen when creating or editing a list,
  which decides which provider the item form searches. It's optional, and free text
  always works.
- Picking a suggestion fills in the item's text and image URL and records **where it
  came from** (`source` + `external_id`), so later features (dedup across spellings,
  "12 people ranked this album", the margin showcase) have a stable key.
- Works for **anonymous** visitors too (see
  [ANONYMOUS_AND_LOCAL_LISTS_PLAN.md](ANONYMOUS_AND_LOCAL_LISTS_PLAN.md)), which is
  why rate limiting is part of this slice and not left for later.

### Out of scope (for now)

- Rich detail pages per catalog entry (cast lists, track listings).
- Re-hosting images in our own storage. Catalog images are **proxied and cached**
  by CloudFront instead (see §Images); copying into S3 is the later fix for sources
  that redirect.
- Paid tiers of any provider, and **any provider that needs a billing card on file**,
  even if it has a free allowance. That's why Google Places is excluded: a quota
  mistake there costs real money (COST_GUARDRAILS_PLAN.md).
- Auto-categorizing existing free-text items after the fact.

## Why backend, not client

The owner asked for this, and it's the right call:

- **API keys stay secret.** TMDB, Google, IGDB and BGG keys can't be shipped in a
  public SPA or a mobile binary.
- **One normalized shape** for web, iOS and Android. Swapping a provider (Spotify
  just shut its door, see below) is a backend deploy, not three client releases.
- **Caching and rate limiting in one place**, which protects both our free-tier
  quotas and the providers' fair-use rules (several require a single identifying
  `User-Agent` and ≤1 request/second, which only a server can guarantee).
- **Privacy.** Third parties see our server's IP, not the visitor's. Images go
  through our CloudFront proxy too, so providers never see visitors at all.

## Provider shortlist (researched 2026-10-13; re-check terms before signing up)

Rule of thumb: **free, keyless or free-key, non-commercial OK, images included.**
All are subject to the project's dependency and cost policy (DESIGN.md §Dependency
policy, CONSIDERATIONS.md §Cost).

| Kind | Primary pick | Fallback / alternative | Notes |
| --- | --- | --- | --- |
| **Movie, TV** | **TMDB** (free API key) | TVmaze (TV only, keyless, CC BY-SA); OMDb (1,000/day free) | TMDB is free for **non-commercial** use with **required attribution** (the "uses TMDB… not endorsed" notice + logo, smaller than ours), and caps caching at **6 months**. Posters come from its image CDN in small sizes (`w92`/`w154`), which suits both thumbnails and the margins. Commercial use would need a separate agreement. Not a concern: Q15 says never monetized. An optional **donation link** is generally compatible with non-commercial use as long as it isn't tied to TMDB content; re-read TMDB's terms before adding one. |
| **Album, artist, song** | **Deezer public API** (keyless search) | **iTunes Search API** (keyless, ~20 req/min/IP); **MusicBrainz** + Cover Art Archive (fully open, 1 req/s, needs `User-Agent`) | **Spotify is ruled out:** since Feb 2026, Development Mode apps are limited to 5 users, the app owner needs Premium, and extended quota requires a registered business with 250k MAU. Deezer and iTunes both return cover art and are good at fuzzy, typo-tolerant search. MusicBrainz is the most "correct" open data but slower and less forgiving for type-ahead, so it's better as an enrichment source than as the type-ahead. |
| **Place** | **Photon** (komoot, OSM-based, built for type-ahead) | Geoapify (free tier ~3k/day); Google Places (free monthly cap per SKU, ~10k autocomplete requests, then paid) | **Don't use public Nominatim for this.** Its usage policy explicitly forbids autocomplete. Photon's public instance is "fair use, will throttle", which is fine at our scale; self-hosting is the escape hatch. **Google Places is excluded**: it needs a billing card on file, so a quota mistake costs real money. OSM data needs "© OpenStreetMap contributors" attribution. Places have **no images** in OSM; show a map-pin icon instead. |
| **Book** | **Open Library** (keyless) | Google Books (free key) | Covers via `covers.openlibrary.org`. |
| **Video game** | **IGDB** (free via a Twitch dev account) | RAWG (free tier, attribution) | IGDB uses OAuth client-credentials, so tokens are refreshed server-side. |
| **Board game** | **BoardGameGeek XML API** | — | **Registration plus a bearer token required since July 2025.** XML, not JSON, so a parser is needed. |
| **Podcast** | iTunes Search API (`media=podcast`) | Podcast Index (free key) | |
| **Anime/manga** | AniList GraphQL (keyless) | Jikan (unofficial MyAnimeList) | |
| **Anything** | **Wikipedia/Wikidata** search (keyless) | — | A great generic fallback: thumbnails via the page-summary REST endpoint. Requires a descriptive `User-Agent`. Covers "desserts", "national parks", and so on. |

**First wave:** TMDB + Deezer (iTunes fallback) + Photon + Wikipedia. That covers
movies, TV, music, places and "anything" for $0 with one key (TMDB). **Second
wave:** IGDB, BoardGameGeek, AniList, iTunes podcasts, Open Library/Google Books.
That's more keys and registrations, all free.

- **Providers with a daily quota** (OMDb 1,000/day, Geoapify ~3k/day) are optional
  fallbacks, **disabled by default**. Enabling one means adding the shared DynamoDB
  daily counter (Q16), so the quota can't be blown across Lambda instances.
- **Image redirects (Q17):** Open Library covers and Cover Art Archive redirect to
  `archive.org` storage hosts, which would leak visitor IPs past the proxy. For those
  sources, show no image (or a kind icon) until the "copy into S3" step exists.
  Google Books covers are the alternative for books; check whether they redirect
  before relying on them.

## Backend design

Mirrors the existing identity-provider seam (`app/auth/claims.py` / `providers.py`):
a contract, interchangeable implementations, a factory, and a fake for dev and tests.

```text
backend/app/catalog/
  contract.py       # CatalogKind enum, CatalogResult model, CatalogProvider Protocol
  registry.py       # kind -> ordered providers; built from code defaults + runtime settings
  cache.py          # CatalogCache Protocol + in-memory TTL impl (see §Caching)
  providers/
    fake.py         # deterministic results; default in development, used in tests
    tmdb.py  deezer.py  itunes.py  photon.py  wikipedia.py  …
backend/app/api/routes/catalog.py   # GET /catalog/search
backend/app/schemas/catalog.py      # response schema (CatalogResultRead)
```

- **`CatalogResult`** (normalized): `kind`, `source`, `external_id`, `title`,
  `subtitle` (artist / year / city, i.e. the second line in the dropdown), `year`,
  `image_url` (nullable), and `attribution` (which provider credit to show).
- **`CatalogProvider` Protocol:**
  `async def search(query: str, kind: CatalogKind, limit: int) -> list[CatalogResult]`.
  Each provider owns its HTTP calls, its own timeouts, and the mapping from its raw
  response to `CatalogResult`.
- **HTTP:** one shared `httpx2.AsyncClient` (the project's HTTP client, see
  DECISIONS.md §HTTP client) with tight timeouts (~2–3 s), a descriptive
  `User-Agent` (`FavFifty/1.0 (+https://favfifty.com)`), and no retries on the
  type-ahead path. A slow suggestion is worse than none.
- **Fallback:** if the primary provider errors or times out, try the fallback once.
  If both fail, return `200` with an empty list and `degraded: true`. The UI just
  shows "no suggestions" and free text keeps working. **Lookup failing must never
  block adding an item.**
- **Modular providers (Q14).** Each provider is one module that registers itself with
  a name, the kinds it serves, a default priority, and its required settings (API
  key, etc.). Adding a provider means adding a module. Removing one means deleting it
  or disabling it.
  - **Disabling without a deploy:** `catalog_providers.<name>.enabled` and
    `.priority` are **runtime settings** (SSM-backed, editable in the admin
    portal; [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md) §Runtime
    settings).
  - A provider whose key is missing is skipped automatically.
  - The registry rebuilds from settings at most every ~30 s.
  - `catalog_enabled` turns the whole feature off (it's also a cost-breaker Level 1
    switch).
- **Dev and test default: the fake provider.** As with the dev identity stub, local
  dev and CI need **no API keys**. Real providers switch on when their key or setting
  is present (`settings.tmdb_api_key`, etc.). Add the new keys to
  `backend/.env.example` (blank) when the code lands.
- **Tests:** contract tests per provider against **recorded JSON fixtures**, using a
  mock transport (no live network in CI); registry fallback behaviour; cache hit and
  miss; rate-limit 429; query validation (empty, too long, control characters). An
  optional, manually run `tools/` script hits the live APIs as a smoke test, never
  in CI.

### Endpoint contract

```text
GET /catalog/search?kind=album&q=in%20rain&limit=8
200 { "results": [CatalogResultRead, …], "degraded": false }
```

- **Public** (no session required) because anonymous users use it. Protected at the
  AWS layers (see §Abuse).
- `q`: trimmed, 2–100 characters, with control characters rejected. `kind`: an enum.
  `limit`: ≤10.
- **Cached at the edge (Q16):** responses carry `Cache-Control: public,
  max-age=86400`, and the catalog behavior uses the managed
  `UseOriginCacheControlHeaders-QueryStrings` policy. So identical searches (same
  `kind`, `q`, `limit`) are served by CloudFront for a day and never reach Lambda or
  the provider. The client should **normalize `q`** (trim, collapse spaces,
  lowercase) before sending, to raise the hit rate.

### Caching

- **Key:** `(provider, kind, normalized query)` → result list.
- **TTL:** hours to a day for searches. Never longer than a provider allows (TMDB:
  6 months max).
- **The first cache is CloudFront itself** (above). That's a cache shared by every
  user, for free.
- **Plus a small in-process TTL cache** (an LRU dict) inside each Lambda instance,
  for repeats that miss the edge. It's per instance and short-lived on Lambda, which
  is fine as an optimization ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)).
- **Behind a `CatalogCache` interface,** so a shared store (DynamoDB with TTL: free
  tier, reachable from a non-VPC Lambda) can be added later without touching
  providers. It isn't expected to be needed.

### Abuse and rate limiting (decided, Q16: enforced by AWS, not app code)

The goal is that no bad actor can get our keys banned or run up costs. Three AWS
layers act **before any Python runs**:

1. **WAF per-IP rate rule** on `/api/v1/catalog/*` (e.g. 300 requests per 5 min per
   IP) at CloudFront. Blocked requests never reach Lambda and don't count against
   the flat-rate plan's allowance
   ([ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md) §Layer 1).
2. **Edge caching** of identical searches (above). Hammering the same query costs
   nothing.
3. **Lambda reserved concurrency (~3)** on the catalog function: a **global** cap of
   roughly 10 upstream calls per second, *no matter how many IPs* are involved. This
   is what keeps us inside TMDB and Deezer limits and bounds the Lambda bill. When
   it's saturated, suggestions pause and free text still works. That's the intended
   "degrade, don't bill or get banned" behaviour.

In Python, only:

- **A per-provider circuit breaker:** on a 429 or repeated errors from a provider,
  back off for a few minutes and use the fallback provider (~30 lines; no shared
  store).
- **No app-level per-IP limiter** for these routes, and **no shared rate-limit
  store**, unless a daily-quota provider is enabled (then a DynamoDB counter, free
  tier).

## Data model changes (needs an Alembic migration, additive, backward compatible)

`list_items` gains three **nullable** columns. Existing free-text items are
unaffected:

- `catalog_source` — `String(32)`, e.g. `tmdb`, `deezer`.
- `catalog_id` — `String(128)`, the provider's id.
- `catalog_kind` — `String(32)`, e.g. `movie`, `album`.

Plus an index on `(catalog_source, catalog_id)` for future "who else ranked this"
queries.

`lists` gains a nullable **`kind`** (the "What's this list of?" hint). **Decided
(Q13): a fixed, small enum**, kept separate from tags. It drives *behaviour* (which
provider to search), while tags stay free-form *labels*. The enum lives in code; new
kinds are additive (old clients just won't offer them). It isn't the deferred
category system.

- **Dedup rule update:** items are deduped case-insensitively by text today. With
  catalog refs, two items with the same `(source, id)` are also duplicates even if
  the text differs. Free-text items keep text-based dedup. Update the service and
  tests together.
- `ItemCreate` / `ItemUpdate` / `ItemRead` gain an optional `catalog_ref` object.
  Old clients that omit it keep working, which matters once mobile clients exist
  and can't be force-updated.
- **Don't store provider metadata blobs** (synopsis, track lists). Store the
  reference plus what the user sees (text, image URL), and re-fetch details on
  demand. That keeps us inside caching-duration terms and the table small.

## Images

**Decided (Q17): proxy through `img.favfifty.com`**, a second CloudFront
distribution on its own flat-rate Free plan ($0, no overages;
[DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)).

- **Providers never see visitor IPs.** CloudFront fetches each image once, caches it
  (~30 days, under TMDB's 6-month cap), and serves it from the edge.
- **The backend rewrites** provider image URLs to the proxy form when building a
  `CatalogResult`, e.g. `https://image.tmdb.org/t/p/w154/x.jpg` →
  `https://img.favfifty.com/tmdb/w154/x.jpg`. That proxied URL is what gets stored
  in `image_url`.
- **Only allowlisted provider origins exist on the proxy,** so it can't be used as an
  open proxy. Catalog-sourced `image_url`s must start with `https://img.favfifty.com/`.
  Plain user-entered URLs keep today's rules (they still hotlink; fixing that is the
  later "copy into S3" step).
- **Cache-behavior budget:** the Free plan allows 5 behaviors per distribution, and
  there are more than 5 image sources (TMDB, Deezer, Apple, Wikimedia, IGDB, BGG,
  AniList, …). Options, in order of preference:
  1. One `/*` behavior with a **CloudFront Function that picks the origin** from the
     first path segment (verify the origin-selection helper is available on the
     flat-rate plan and in Terraform).
  2. A third Free-plan distribution (the account allows 3).
  3. Proxy only the top 5 sources at first.
- **Redirecting sources** (Open Library covers, Cover Art Archive) can't be proxied
  this way. See §Provider shortlist.
- Add `img.favfifty.com` to the **CSP `img-src`** (CONSIDERATIONS.md §Security).
- Cost estimate (2026-10-13): ~80 image requests and ~1.2 MB per page view. The Free
  plan's 1M requests/month covers ~10k page views; beyond that it slows delivery
  rather than billing.

## Frontend design (summary)

- **List kind picker** in the create and edit list modals: icon chips for Movies,
  TV, Albums, Artists, Songs, Places, … and "Anything" as the default.
- **Item form type-ahead** (`ItemFormModal.vue`): a combobox (WAI-ARIA combobox
  pattern, with keyboard up/down/enter/escape) under the text input. Debounce
  ~250 ms, minimum 2 characters, cancel in-flight requests with `AbortController`,
  and ignore out-of-order responses. Each row shows the thumbnail, title and
  subtitle. Picking a row fills in text and image and sets `catalog_ref`. Typing
  after a pick clears the ref, so the item becomes free text again.
- **Attribution:** a small "Results from TMDB / Deezer / OpenStreetMap" line inside
  the dropdown, plus an **About/credits** section in the footer with the required
  TMDB notice and logo.
- A `useCatalogSearch` composable plus a `CatalogCombobox` component. Use a headless
  primitive (Reka UI, already listed in DESIGN.md §Frontend tools) if a hand-rolled
  accessible combobox gets fiddly.
- **Tests:** Vitest for debounce, abort and stale-response handling, keyboard
  navigation, and pick vs. free-text. A Playwright e2e with the backend's fake
  provider.

## Docs, legal and setup to update when this ships

- [SETUP.md](SETUP.md): a "Catalog provider accounts" section (TMDB key, later IGDB
  via Twitch, BGG registration), with keys in `backend/.env` locally and SSM in AWS.
- [Privacy policy](legal/PRIVACY_POLICY.md): search text is sent from our server to
  the listed third-party catalogs. We don't send who you are, and images are served
  through our own CDN proxy.
- [Terms](legal/TERMS_OF_SERVICE.md) / footer credits: TMDB attribution, OSM
  attribution, and any others the chosen providers need.
- [DECISIONS.md](DECISIONS.md): keep the provider list current as providers are
  added or removed.

## Build order (small, shippable PRs)

1. **Catalog seam:** contract, registry, fake provider, `GET /catalog/search`, and
   tests. Backend only, no keys.
2. **Migration plus schema:** nullable `catalog_*` on `list_items`, `kind` on
   `lists`, with the `ItemCreate/Read` additions and dedup-by-ref.
3. **Frontend combobox** against the fake provider, plus the list kind picker.
4. **Real providers, first wave, one at a time:** Wikipedia (keyless, generic) →
   Deezer/iTunes → TMDB (key plus attribution) → Photon (plus OSM credit). Add the
   per-provider circuit breaker with the first real provider.
5. **AWS protections with the Lambda move:** catalog route → Lambda with reserved
   concurrency, the WAF rule, edge caching, and the image proxy distribution.
6. **Second wave:** IGDB, BoardGameGeek, AniList, podcasts, books. Each is a small
   follow-up PR, toggled via runtime settings.
