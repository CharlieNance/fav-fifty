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

## Open — to decide (no rush; these don't block feature work)

- **Palette.** Exact dark surface ramp + the accent hue. Current values are stand-ins.
  ("Chill/inviting" usually = slightly warm or soft-cool darks, generous whitespace,
  rounded corners, restrained color.)
- **Type pairing.** Pick at most two web fonts: one characterful **display** face (the
  wordmark, headings, big rank numerals) + one clean **body** face. This single choice
  carries most of the vibe. (System stack is the placeholder — no web font yet.)
- **Wordmark / logo + favicon.** Even a simple type-based mark.
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
