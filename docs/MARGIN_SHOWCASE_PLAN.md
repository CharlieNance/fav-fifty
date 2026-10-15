# Margin Showcase (scrolling art in the side gutters) — Implementation Plan

Planning doc for a decorative effect: on wide screens, **columns of album covers,
movie posters and show art slowly scroll** up and down the left and right margins, so
the page doesn't feel empty around the centred content column. Part of the 2026-10
scope expansion ([NEXT_STEPS.md](NEXT_STEPS.md)). Nothing is built yet. The look and
the image proxy were **decided in [QUESTIONS.md](QUESTIONS.md) Q17 (2026-10-13)** and
recorded in [DESIGN.md](DESIGN.md).

## Scope

### In scope

- A purely **decorative** background layer in the side gutters on wide viewports.
- A small backend endpoint that hands the client a **curated, cached** set of image
  URLs (from the catalog providers in [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)).
- Respecting reduced motion, the theme, and performance budgets.

### Out of scope (for now)

- Clicking a tile to do something (e.g. "start a list of these"). It's a natural
  later step, but it turns decoration into UI with focus and a11y obligations.
- Personalization (art from *your* lists).
- Phones and tablets. There are no margins there, so the effect simply isn't shown.

## Where the art comes from

**Backend, not client:** the same reasons as catalog lookup (keys, one shape for
web and mobile, caching). One endpoint:

```text
GET /showcase            (public, no session)
200 { "generatedAt": "...", "tiles": [ { "kind": "album", "imageUrl": "...", "title": "...", "source": "deezer" }, … ] }
Cache-Control: public, max-age=86400
```

- **Sources, all free:**
  - **Movies and TV:** TMDB *trending* (`/trending/movie/week`, `/trending/tv/week`)
    with `include_adult=false`, using small poster sizes (`w154`). Requires the TMDB
    attribution that catalog lookup already adds.
  - **Albums:** Deezer chart endpoints (keyless) or Apple's public marketing RSS
    feeds (top albums JSON, keyless). Verify the current feed URL before building.
  - **Later:** items users actually ranked in **published** lists. That makes it a
    "community wall" and much more on-brand, once Phase 3 sharing exists. Only ever
    from published lists, never drafts or anonymous local lists.
- **"Random(ish)":** the server builds a pool of ~100–150 tiles once a day, and the
  client **shuffles** it per page load. That's fresh every visit with one upstream
  fetch a day.
- **Cost:** with a 24 h `Cache-Control` and CloudFront in front, the backend is
  called about once a day per edge location. Effectively free.
- **Where it runs:** the showcase is a stateless route, so in production it's routed
  to **Lambda** alongside catalog lookup
  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)). Locally it's just
  another FastAPI route. Build the endpoint first; it works locally with the fake
  source and needs no new infrastructure.
- **Possible later simplification:** a scheduled job (EventBridge → Lambda, daily)
  writes `showcase.json` to the static site bucket, and the client fetches it like
  any static asset, so there's no runtime endpoint at all. Only worth doing if the
  endpoint shows up in costs or latency.
- **Dev and tests:** a fake showcase built from local placeholder images, so dev and
  CI need no keys. That matches the catalog fake provider.

## Visual design (decided, Q17; verify with a static mock before animating)

- **Only where there's room:** render the layer when the viewport leaves real
  gutters (e.g. `xl:` and up, ≥1280px). Hidden, and **not fetched at all**, below
  that, so phones on cellular don't download 100 images they'll never see.
- **Layout:** 1–2 narrow columns per side, fixed-position behind the content.
  Adjacent columns scroll in **opposite directions** at slightly different speeds,
  which gives a parallax feel without scroll-jacking. One idea: **posters on the
  left, albums on the right**, so each side has one aspect ratio (2:3 vs 1:1) and the
  columns stay tidy. Mixed columns would need square crops (`object-cover`), which
  chops off poster titles.
- **Keep it a background:** low opacity (~20–35%), maybe a slight desaturation
  toward the warm palette, and a **fade mask** at the top and bottom and toward the
  content edge so tiles dissolve rather than butt against the content column.
  Rounded corners to match cards. It must never compete with the list content, which
  is the product.
- **Motion:** slow, continuous, linear (a full loop every ~60–120 s). This is
  ambient motion, a deliberate, documented **exception** to DESIGN.md's ~200 ms
  "feedback motion" rule, the same way the toast drop-in was. Record it there when
  decided.
- **Theme:** opacity and tint come from tokens in `main.css` (e.g.
  `--showcase-opacity`) so the light theme can tune them in one place.

## Implementation notes

- **Pure CSS animation:** each column renders its tile list **twice** in a row and
  animates `transform: translateY(-50%)` on loop, which gives a seamless infinite
  scroll. Transform-only animation runs on the compositor (no layout or paint per
  frame).
- **Accessibility:**
  - The whole layer is `aria-hidden="true"` and `pointer-events: none`, and the
    images have `alt=""`. It's decoration, so screen readers and keyboard focus skip
    it.
  - **`prefers-reduced-motion: reduce` → no animation** (static tiles, or hide the
    layer). The project already gates motion behind `motion-safe:`.
  - WCAG 2.2.2 (Pause, Stop, Hide) applies to auto-moving content that lasts more
    than 5 s. Reduced-motion covers people who've set the OS preference. Also add a
    **small toggle** (e.g. in the footer or a settings menu, remembered in
    `localStorage`) to turn the showcase off.
- **Performance:**
  - Pause the animation when the tab is hidden (`visibilitychange` →
    `animation-play-state: paused`).
  - `loading="lazy"`, `decoding="async"`, explicit width/height (no layout shift),
    the smallest image sizes available, and a cap on the tile count (~20–30 per
    column, duplicated for the loop).
  - Load the layer **after** the main content (idle callback), so it never delays
    first paint of the lists.
- **Content safety:** trending feeds can include violent or suggestive poster art.
  Use `include_adult=false`; consider a small server-side denylist and a "hide this"
  admin lever later. Album art is usually fine.
- **Privacy (decided, Q17):** every tile URL points at the **image proxy**
  (`img.favfifty.com`, a second CloudFront distribution on its own flat-rate Free
  plan: $0, no overages; see [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)
  §Images). Providers never see visitor IPs. Only sources whose images don't
  redirect are used (TMDB, Deezer, Apple).
- **Where in code:** a `MarginShowcase.vue` in the app shell (`App.vue`), a
  `useShowcase` composable for fetch, shuffle and visibility pause, and backend
  `app/showcase/` (reusing catalog providers) plus `routes/showcase.py`.
- **Tests:** backend (pool building, fallback when a source fails, cache headers);
  Vitest (not rendered below the breakpoint, no fetch below the breakpoint,
  reduced-motion disables animation, the toggle persists, shuffle is a permutation).

## Build order

1. **Backend `GET /showcase`** with the fake source and tests.
2. **`MarginShowcase.vue`** with static placeholder tiles: nail the look (opacity,
   masks, columns) before wiring in real data.
3. **Animation**, reduced motion, visibility pause, and the off toggle.
4. **Real sources** (TMDB trending + album charts), after catalog lookup's TMDB key
   and attribution exist.
5. Route `/api/v1/showcase` to Lambda and serve tiles through the image proxy, with
   the catalog's Lambda move.
6. *(Later)* the community-wall source from published lists; optionally the
   scheduled static JSON.
