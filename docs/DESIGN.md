# Design & Look-and-Feel

The living home for **visual/UX decisions** — the frontend counterpart to
[DECISIONS.md](DECISIONS.md). The vibe we're going for: **modern, chill, inviting.**
Right now everything below is a placeholder or an open question; fill it in as choices
get made, then treat this file as the source of truth for the design system.

The product is fundamentally **text in ranked lists**, so this is more a *typographic*
design problem than a graphical one. Whitespace, type, and one good accent color carry it.

---

## Decided

- **Theme direction:** **dark-first.** Design for dark now; a light theme is a later
  additive flip. (Owner call, 2026-07-09.)
- **Tokens, not hex.** All color/type/spacing live as semantic tokens in
  `frontend/src/assets/main.css` (`@theme`). Components reference token utilities
  (`bg-canvas`, `text-accent`, …). Re-theming = edit that one block.
- **One accent color.** Keep restraint — a single brand accent until there's a reason
  for more.
- **Palette (2026-07-14).** **Warm, cozy dark** — from the homepage mock
  (`docs/Fav Fifty Homepage.html`). Low-chroma warm-brown surfaces (`oklch` hue ~50)
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
- **Logged-out "Start a list" (2026-07-14).** Button stays visible; clicking it when
  logged out routes to login and **preserves intent** (continue to create-a-list after).
  Gate the action, not the button — more inviting, better funnel.
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
    colors were added for it.
- **Light/dark toggle: required before launch (2026-08-08).** Upgraded from "when
  (if)" — owner wants a toggle live at go-live. Dark stays the design-first theme;
  the token architecture (one `@theme` block) is what makes the flip additive. Until
  then: keep the palette restrained, don't scatter new colors that would each need a
  light-mode counterpart.
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
    above** the viewport with a small overshoot (`--animate-drop-in`, `ease-pop`),
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
  - **When light mode lands**, re-check these against the light canvas before
    reaching for a second set of values — the expectation is that only the
    surrounding surfaces flip.
- **Logging out navigates home (2026-09-22).** Clearing the session in place left the
  user on `/lists` still reading them, corrected only by the next navigation. Log out
  now goes to `/` and toasts — home rather than login, since logging out isn’t a
  prelude to logging back in. (Pairs with sign-in landing on `/lists`, see
  [DECISIONS.md](DECISIONS.md).)
- **Drag-and-drop library (2026-08-08): `vue-draggable-plus`** (MIT, typed,
  maintained; SortableJS underneath). Chosen over hand-rolled DnD (don't want to
  maintain drag code) and over `vuedraggable`, which is unmaintained and crashes with
  Vue 3.5 — full story in
  [ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md) §Frontend implementation notes.

## Open — to decide (no rush; these don't block feature work)

- **Wordmark / logo + favicon.** Even a simple type-based mark. (Current: the `fav·fifty`
  text wordmark from the mock; favicon still the scaffold default.)
- **Light theme:** *whether* is decided (yes, pre-launch — see Decided above); still
  open is *when* to build it and what the light palette's exact values are.

## Core interactions to design deliberately

These are the screens/flows that *make or break* the product — design them on purpose,
not by default:

- **The ranked list view (1–50).** ✅ First pass shipped (2026-08-08): rows (not
  cards) with a big accent rank numeral in the display face, optional 48px image
  thumbnail, note as a muted second line. Revisit as real lists exercise it.
- **Building/editing a list.** ✅ First pass shipped (2026-08-08): add/edit in one
  modal, delete behind a confirm, reorder by drag (handle icon) or up/down buttons.
  Reorder library decided — see Decided above.
- **Empty states.** New user with zero lists; new list with zero items. First thing
  everyone sees; easiest to neglect. (The zero-items one now invites: "Every
  all-timer list starts with a #1 — what's yours?")
- **Loading & error states.** Skeletons/spinners and graceful failure, not just the happy
  path.

## Cross-cutting principles

- **Mobile-first / responsive.** The audience arrives via Discord links, often on phones.
  Design the narrow layout first.
- **Accessibility.** Sufficient color contrast (verify against the dark palette), visible
  focus rings, keyboard navigation. Cheaper to bake in than retrofit; overlaps with
  quality and the "escape all user content" security rule.
- **Consistency via tokens & shared components.** Buttons, inputs, cards, dialogs come
  from one small set, not ad-hoc per page.

## Frontend tools we may add for design (deferred until needed — keep it light)

Not installed yet; reach for these at the moment of first real need, not before:

- **Headless/accessible primitives** — Reka UI (Vue port of Radix) or Headless UI — for
  modals, menus, dialogs done accessibly.
- ~~**Icons**~~ — added: Heroicons (`@heroicons/vue`).
- ~~**Drag-and-drop**~~ — added: `vue-draggable-plus` (see Decided above).
- **VueUse** — handy composables (`useDark`, `useLocalStorage`, …) — likely wanted for
  the light/dark toggle.
- ~~**Web fonts**~~ — added: Fontsource-hosted Baloo 2 + Figtree.
