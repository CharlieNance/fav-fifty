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

## Open — to decide (no rush; these don't block feature work)

- **Wordmark / logo + favicon.** Even a simple type-based mark. (Current: the `fav·fifty`
  text wordmark from the mock; favicon still the scaffold default.)
- **Light theme:** when (if) to add it.
- **Motion:** how much. A little easing on hover/reorder sells "chill"; too much annoys.

## Core interactions to design deliberately

These are the screens/flows that *make or break* the product — design them on purpose,
not by default:

- **The ranked list view (1–50).** How do the ranks read — big numerals? Cards vs. rows?
  How does an item with a note + image differ from a bare one?
- **Building/editing a list.** Add, edit, remove, and **drag-to-reorder** items. This is
  the app's heartbeat and should feel good. (Reorder library TBD — see NEXT_STEPS.)
- **Empty states.** New user with zero lists; new list with zero items. First thing
  everyone sees; easiest to neglect.
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
- **Icons** — lucide-vue-next or Heroicons.
- **Drag-and-drop** — native HTML5 DnD, `vuedraggable`, or `@vueuse/integrations`
  `useSortable`, for ranking items.
- **VueUse** — handy composables (`useDark`, `useLocalStorage`, …).
- **Web fonts** — self-hosted (e.g. via Fontsource) once the pairing is chosen.
