# Design & Look-and-Feel

The living home for **visual/UX decisions** — the frontend counterpart to
[DECISIONS.md](DECISIONS.md). The vibe we're going for: **modern, chill, inviting.**
**Decided** is the source of truth for the design system; **Open** holds what's still
to choose. Move an item across when it's settled, with the date.

The product is fundamentally **text in ranked lists**, so this is more a *typographic*
design problem than a graphical one. Whitespace, type, and one good accent color carry it.

---

## Decided

- **Theme direction:** **dark-first.** Design for dark first; light is the same tokens
  with different values (see Light theme below). (Owner call, 2026-07-09.)
- **Tokens, not hex.** All color/type/spacing live as semantic tokens in
  `frontend/src/assets/main.css` (`@theme`). Components reference token utilities
  (`bg-canvas`, `text-accent`, …). Re-theming = edit that one block.
- **One accent color.** Keep restraint — a single brand accent until there's a reason
  for more.
- **Palette (2026-07-14).** **Warm, cozy dark** — from the homepage mock
  (`docs/Fav Fifty Example.html`). Low-chroma warm-brown surfaces (`oklch` hue ~50)
  with a single **coral accent** (hue ~40). Semantic ramp, all in `main.css`:
  `canvas` (app bg) → `surface` (cards) → `elevated` (hover) → `border`; text is
  `ink` / `muted`; brand is `accent` / `accent-hover` / `accent-ink` (dark text on the
  accent). Reads as nerdy-but-chill, doesn't take itself too seriously.
- **Type pairing (2026-07-14).** **Baloo 2** (rounded display — wordmark, headings, big
  rank numerals) + **Figtree** (clean body). **Self-hosted via Fontsource, latin subset,
  only the weights we use** — no Google Fonts CDN call (privacy, no layout shift).
- **Mobile-first, always.** The mock is desktop-first; we port it as mobile-first
  responsive (design the narrow layout, scale up at `sm:`/`md:`). Audience arrives via
  Discord links, mostly on phones.
- **No login wall (2026-10-13, built 2026-11-14).** Anonymous visitors build lists
  on their device, so "Start a list" opens the create modal for everyone. (This replaced
  the 2026-07-14 call to send logged-out visitors to login first.) Sign-in is pitched as
  *keeping* lists (across devices, safe from a cleared browser) and, later, *sharing*:
  - the lists page says "Saved on this device only", with a "Sign in to keep them safe"
    link;
  - a dismissible "Keep your lists safe" banner appears once there's enough to lose
    (2+ lists or 20+ items), offering sign-in or an export;
  - after sign-in, a "Bring your lists with you?" dialog offers to add the device's
    lists to the account.

  Details: [ARCHITECTURE.md §Anonymous lists](ARCHITECTURE.md#anonymous-lists-on-device-storage).
- **Motion (2026-08-08).** Small, quick, and a little springy — interactive elements
  should *feel* pressed and lifted, not just recolor. (Owner call: hover/click was too
  flat; the site should give feedback and feel alive.) Concretely:
  - **Tokens, like color**: easings (`--ease-out-soft`, `--ease-pop`) and entrance
    animations (`--animate-rise-in`) live in the `@theme` block in `main.css`.
  - **Buttons** (`BaseButton`): lift ~2px + shadow on hover, squash (`scale-95`) on
    press. **Icon buttons**: squash on press. **Rows** (list index, item rows): hover
    surface highlight; row actions sit dimmed and brighten on row hover/focus.
  - **Dialogs**: rise-in entrance (0.2s).
  - **Drag**: SortableJS `forceFallback` so the picked-up row is our own styled clone
    (`.drag-ghost` / `.drag-chosen` / `.drag-dragging` in `main.css`) — lifted,
    slightly tilted, identical in every browser — with a 200ms reorder animation.
  - **Reduced motion is respected**: every transform/animation sits behind Tailwind's
    `motion-safe:` variant; `prefers-reduced-motion` users get color-only feedback.
  - Restraint rule: motion never longer than ~200ms, never blocks input, and no new
    colors were added for it. **One exception (owner call, 2026-09-22): the toast
    drop-in runs 500ms.** It travels from off-screen rather than nudging in place,
    and the longer arc is what makes it read as *falling into place* instead of
    appearing. Feedback on something you just clicked stays at ~200ms.
- **Light theme (built 2026-11-15).** Dark stays the design-first theme; light is
  the same token names with a second set of values:
  - **Palette:** warm cream surfaces (hue ~70), near-black warm ink, and the coral
    accent deepened (`oklch(53% 0.18 36)`) with near-white `accent-ink`, so the
    accent still reads as text. Values live in `:root[data-theme='light']` in
    `main.css`. Status and gold chips are unchanged: their contrast is internal,
    as planned.
  - **Choosing:** it follows the system's `prefers-color-scheme` until the visitor
    uses the sun/moon toggle in the header; that choice is saved per device
    (`localStorage`, `favfifty:theme`). Not stored on the account.
  - **No flash:** `public/theme-init.js` sets `data-theme` on `<html>` before first
    paint. It's an external file, not inline, because the planned CSP is
    `script-src 'self'`. `stores/theme.ts` takes over once the app mounts.
  - **New colors need two values.** Anything added to `@theme` that differs by
    theme needs a matching line in the light block. Glows, panel and shadow colors
    are plain custom properties (`--glow-*`, `--panel-*`, `--lift-shadow`) set the
    same way.
- **Accessibility target: WCAG 2.1 AA (what Section 508 references) (2026-11-15).**
  The rules the app follows:
  - **Contrast is tested.** `src/assets/theme.node.spec.ts` reads the tokens from
    `main.css` and checks both themes: text 4.5:1 on every surface, and form-field
    edges (`control` token) and the focus ring 3:1. A palette change that fails
    breaks the build.
  - **Pages and dialogs are scanned.** `frontend/e2e/accessibility.spec.ts` runs
    axe-core (WCAG 2.1 A/AA rules) on every page and dialog in the light theme, the
    dark theme and at phone size, in CI too. A new page or dialog gets a scan there.
    axe finds only part of what matters; keyboard flow and screen-reader wording
    still need a manual check.
  - **Every dialog uses `BaseDialog`.** It moves focus in, traps Tab, closes on
    Escape or a backdrop click, and returns focus to the opener. Don't hand-roll a
    `role="dialog"` overlay.
  - **Focus is always visible.** A global `:focus-visible` ring in `main.css` covers
    anything without its own.
  - **Navigation:** a "Skip to main content" link is the first Tab stop. Every route
    sets a tab title (`meta.title`, or `setPageTitle` once data loads). After a
    route change, focus moves to the new page's `<h1>`. The header marks the current
    page with `aria-current`.
  - **Status changes are announced** through polite live regions: search result
    counts, item moves ("Reuben moved to number 3 of 12."), and toasts. After a
    keyboard move, focus stays on the moved row.
  - **Icon-only buttons need a label** (`IconButton` requires one), and decorative
    images and icons are `aria-hidden` or `alt=""`.
- **Dependency policy (2026-08-08).** Any frontend/backend library we add must be
  free and under a permissive license (MIT/BSD/Apache-2.0) — this is an open-source,
  no-revenue project; nothing paid, nothing copyleft-restrictive for our use.
- **Toasts (2026-09-22): hand-rolled, not a library.** Transient status messages
  ("You’ve been logged out.") live in a Pinia store (`stores/toasts.ts`) rendered by
  one `ToastHost` in the app shell, so a message outlives the navigation that caused
  it. A toast library would have owed us more than the ~50 lines this costs (see
  Dependency policy above). The rules:
  - **Always top-center**, at every breakpoint — offset to clear the header rather
    than cover it. (Owner call: bottom-right is easy to miss.) They **drop in from
    above** the viewport with a small overshoot (`--animate-drop-in`, `ease-pop`,
    500ms — the one documented exception to the ~200ms restraint rule above),
    behind `motion-safe:`, so an arrival registers as movement, not just new pixels.
  - **Colored by status**, one of the three fills below — a toast that matched the
    page had nothing to make it stand out.
  - Each variant carries an **icon** as well as a color (check / triangle / x), since
    color alone can’t be the signal.
  - `role="status"` + `aria-live="polite"` on a region that stays mounted (an
    announcement region that appears alongside its content doesn’t get read);
    auto-dismiss after 5s, plus a manual close. Anything that must interrupt gets its
    own `assertive` region later — don’t upgrade this one.
- **Status colors (2026-09-22): green / amber / red, theme-independent.** Three
  semantic sets in `main.css` — `--color-success|warning|error` plus a matching
  `-ink` (text on the fill) and `-border` (edge) for each. Rules that make them work:
  - They are **filled chips**, so the text contrast is *internal* — ink against its
    own fill, never against the page. That’s what lets a single set of values serve
    dark today and light later, instead of needing a second palette. Measured
    ink-on-fill: success 8.2:1, warning 9.7:1, error 5.1:1 (all past WCAG AA).
  - The `-border` shade is darker than its fill, so a chip still has a visible edge
    on a light canvas, where a pale fill alone would float.
  - **Hues stay clear of the coral accent (~40)**: green 150, amber 85, red 22. Red
    is the one that flips polarity — a red light enough for dark ink lands right on
    top of the brand accent, so it’s a deep fill with near-white ink.
  - Usage is semantic, not decorative: success = it worked, warning = proceed with
    care, error = it failed. Nothing else borrows these colors.
  - **Checked against light mode (2026-11-15):** they held up, so one set of values
    serves both themes, and `theme.node.spec.ts` keeps checking them.
- **Gold is for a full fifty.** `--color-gold` (+ `-light`, `-border`, `-ink`) is
  used only for the star on the list index's `ItemCountBadge` when a list hits the
  cap. It's a deeper, warmer yellow than `warning`, so it never reads as just the
  next tier. The badge's other tiers (`itemCountTier.ts`: 0–10, 11–25, 26–49) use
  the normal surface tokens. Like the status colors, it's a filled chip, the same
  in both themes.
- **Logging out navigates home (2026-09-22).** Clearing the session in place left the
  user on `/lists` still reading them, corrected only by the next navigation. Log out
  now goes to `/` and toasts — home rather than login, since logging out isn’t a
  prelude to logging back in. (Pairs with sign-in landing on `/lists`, see
  [DECISIONS.md](DECISIONS.md).)
- **Margin showcase (decided 2026-10-13, Q17; not built yet).** Scrolling art in the side
  gutters, **only on screens ≥1280px** (not even fetched below that):
  - **posters on the left, album covers on the right**;
  - low opacity with edge fades;
  - a slow, opposing-direction loop;
  - off under `prefers-reduced-motion`, plus a user off-toggle.

  It's decorative (`aria-hidden`, no pointer events). It's the second documented
  **exception** to the ~200ms motion rule: *ambient* motion, not feedback. Opacity
  and tint are tokens in `main.css`, so the light theme can tune them. Images come
  through the `img.favfifty.com` proxy.
  [MARGIN_SHOWCASE_PLAN.md](MARGIN_SHOWCASE_PLAN.md).
- **Drag-and-drop library (2026-08-08): `vue-draggable-plus`** (MIT, typed,
  maintained; SortableJS underneath). Chosen over hand-rolled DnD (don't want to
  maintain drag code) and over `vuedraggable`, which is unmaintained and crashes with
  Vue 3.5. How it's configured, and why:
  [ARCHITECTURE.md](ARCHITECTURE.md) §Frontend patterns.

## Open — to decide (no rush; these don't block feature work)

- **Tooltips.** Wanted before the Discord playtest. Today the only hints are native
  `title` attributes (`IconButton`, the drag handle, `ItemCountBadge`, the toast
  close). Those never show on touch or keyboard focus, so most of our phone-first
  audience never sees them. Whatever we pick has to follow these rules:
  - **A tooltip is an extra, never the only label.** The button keeps its
    `aria-label`, and nothing you need to finish a task lives only in a tooltip,
    because touch users can't hover. If a hint matters on phones, it goes in visible
    text or a tap-to-open "?" popover.
  - **WCAG 1.4.13 (content on hover or focus):** it shows on hover *and* keyboard
    focus, Escape closes it, the pointer can move onto it without it vanishing, and
    it stays until dismissed or the pointer/focus leaves. The trigger points to it
    with `aria-describedby`, and the tooltip has `role="tooltip"`.
  - Use the existing tokens (`elevated` surface, `ink` text, `border`) in both
    themes, behind a short delay (~400ms in, none out), and keep the ~200ms motion
    rule.
  - Options, roughly cheapest first: (a) a hand-rolled `BaseTooltip` (like
    `BaseDialog` and the toasts); (b) the same plus `@floating-ui/vue` (MIT, small)
    for edge-aware positioning, which matters on narrow phones; (c) Reka UI's
    Tooltip (MIT), if we also want its other primitives. Leaning (a), adding
    Floating UI only if positioning near screen edges gets fiddly. Add an axe scan
    with a tooltip open, too.
- **Wordmark / logo.** Even a simple type-based mark. (Current: the `fav·fifty` text
  wordmark from the mock. The favicon is done: a "fav / fifty" tile in the palette's
  colors, in `public/` with PNG sizes and an Apple touch icon.)
- **Margin showcase: exact values.** The shape is decided (see Decided: Margin
  showcase). Opacity, tint, fade-mask depth and scroll speed get settled with a static
  mock before animating —
  [MARGIN_SHOWCASE_PLAN.md](MARGIN_SHOWCASE_PLAN.md).
- **Catalog type-ahead.** Combobox dropdown rows (thumbnail + title + subtitle), list-kind
  picker chips, and where provider attribution sits —
  [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md) §Frontend design.

## Core interactions to design deliberately

These are the screens/flows that *make or break* the product — design them on purpose,
not by default:

- **The ranked list view (1–50).** ✅ First pass shipped (2026-08-08): rows (not
  cards) with a big accent rank numeral in the display face, optional 48px image
  thumbnail, note as a muted second line. Revisit as real lists exercise it.
- **Building/editing a list.** ✅ First pass shipped (2026-08-08): add/edit in one
  modal, delete behind a confirm, reorder by drag (handle icon) or up/down buttons.
  Reorder library decided — see Decided above.
- **Empty states.** ✅ First pass: zero lists ("You haven't started a list yet…"),
  no search matches, and zero items ("Every all-timer list starts with a #1 — what's
  yours?"). First thing everyone sees; worth a second look after the playtest.
- **Loading & error states.** First pass: muted text in a `role="status"` region
  ("Loading your lists…"), plus a plain error line for failures, with separate copy
  for on-device storage errors. No skeletons or spinners yet. Add them if testers
  on slow phones notice the wait.

## Playtesting and moving things around

Planned: a first round with a few people from the Discord, then layout changes based
on what they hit. To keep that cheap and safe:

- **Write findings down here** (or link an issue): what the tester tried, where they
  got stuck, which device and theme. Move a layout change to Decided once it ships,
  with the date and the reason ("testers missed X").
- **Things to watch:** do people find "Start a list" and reorder (drag *and* the
  up/down buttons) on a phone? Do they notice the "Saved on this device only" note
  and the backup banner? Do icon-only buttons make sense without a hover hint?
  That last one is the case for tooltips.
- **When moving elements, keep visual order and DOM order the same.** Reorder the
  markup, not the CSS (`order`, `flex-row-reverse`, absolute positioning). Tab
  order and screen readers follow the DOM (WCAG 1.3.2 / 2.4.3).
- **Design the phone layout first**, then check `sm:`/`md:`. Playwright's `mobile`
  project (Pixel 7) catches the obvious breaks.
- **The tests survive moves if names don't change.** e2e specs find elements by
  role and accessible name (`getByRole`), almost never by position or test id. A
  pure move should leave them green. Renaming a button's label or a heading will
  break specs, and that's intended. Run `npm run test:e2e`: the axe scan reruns on
  every page in both themes.

## Cross-cutting principles

- **Mobile-first / responsive.** The audience arrives via Discord links, often on phones.
  Design the narrow layout first.
- **Accessibility.** WCAG 2.1 AA in both themes. See Decided: Accessibility target
  for the concrete rules. Cheaper to bake in than retrofit.
- **Consistency via tokens & shared components.** Buttons, inputs, cards, dialogs come
  from one small set, not ad-hoc per page.

## Frontend tools we may add for design (deferred until needed — keep it light)

Not installed yet; reach for these at the moment of first real need, not before:

- **Headless/accessible primitives** — Reka UI (Vue port of Radix) or Headless UI.
  Dialogs didn't need it (`BaseDialog` is hand-rolled). Reconsider for tooltips or
  menus (see Open: Tooltips).
- **Positioning** — `@floating-ui/vue`, if a tooltip or popover needs edge-aware
  placement.
- ~~**Icons**~~ — added: Heroicons (`@heroicons/vue`).
- ~~**Drag-and-drop**~~ — added: `vue-draggable-plus` (see Decided above).
- **VueUse** — handy composables (`useLocalStorage`, …). Not needed for the theme
  toggle after all: `stores/theme.ts` is ~40 lines.
- ~~**Web fonts**~~ — added: Fontsource-hosted Baloo 2 + Figtree.
