# Fav Fifty

> Make lists of your fifty favorite things — bands, desserts, video games, anything — and share them.

**Fav Fifty** ([favfifty.com](https://favfifty.com)) is a web app for curating ranked lists of your 50 favorite things in any category. Start without an account — lists are saved on your device — and sign in with a social account to keep them across devices. Find-as-you-type lookup fills in movies, shows, albums, places and more. Eventually you'll be able to share lists, comment on others', suggest items, ask questions, and vote on the best lists — and use it from iOS and Android apps.

---

## Status

🚧 **Phase 1 — Walking skeleton.** Foundation and key decisions are done. Backend (FastAPI + Postgres + Alembic) and frontend (Vue 3 + Vite) are scaffolded, CI runs on every push, and **real Google sign-in via AWS Cognito is live end-to-end** (2026-07-31). A couple of small follow-ups remain before Phase 2.

**Scope expansion (2026-10-13, pre-launch):** anonymous use with on-device lists, catalog lookup, a margin art showcase, mobile readiness, and a Lightsail/Lambda/hybrid backend — planned, not yet built (Phase 2.5 in NEXT_STEPS). Before launch: abuse protection, an admin portal with dashboards and analytics, and cost guardrails that take the site offline rather than run up a bill.

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the roadmap and [docs/QUESTIONS.md](docs/QUESTIONS.md) for open decisions.

## Vision

| Phase | Goal |
| ------- | ------ |
| **1 — MVP** | Google login; create/read/update/delete personal lists of up to 50 items, with tags, ranking, and notes. Publish/unpublish. |
| **1.5 — Open door** | No account needed (lists on-device, upload on sign-in); find-as-you-type catalog lookup; margin art showcase. |
| **2 — Social** | Public lists, sharing via link, commenting. |
| **3 — Community** | Suggestions/questions on lists, voting on lists, discovery/browse. |
| **Mobile** | iOS + Android apps on the same API. |
| **Later** | Search, profiles, notifications, moderation, and more. |

## Tech Stack

Decisions recorded in [docs/DECISIONS.md](docs/DECISIONS.md) (deliberation in [docs/QUESTIONS.md](docs/QUESTIONS.md)).

- **Frontend:** Vue 3 + Vite + TypeScript, Pinia (state), Vue Router, Tailwind CSS. Vitest + ESLint. Hosted as a static SPA on S3 + CloudFront.
- **Backend:** Python + FastAPI (REST API), Pydantic for validation. pytest + Ruff.
- **Database:** PostgreSQL 16, in Docker on the production Lightsail box (same image as local dev).
- **Auth:** Optional. Social login only via AWS Cognito — **Google at launch** (Facebook/Apple possible later; Apple required before iOS). No email/password.
- **Catalog data:** external APIs (TMDB, Deezer/iTunes, Photon/OSM, Wikipedia, …) called from the backend only.
- **Backend hosting:** one AWS Lightsail instance running Docker Compose (FastAPI + Postgres) behind CloudFront at `favfifty.com/api/v1`; stateless routes (catalog lookup, showcase) run the same image on AWS Lambda. Expected bill ~$13–15/month, almost all fixed, with cost guardrails that take the site offline before a big bill.
- **Infrastructure:** AWS, defined as code with Terraform. DNS via Route 53 (domain registered at Squarespace).
- **Secrets:** `.env` locally (git-ignored); AWS Secrets Manager / SSM in deployed environments.

> ⚠️ The repo is **public**. Never commit real secrets — each app has its own template: [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example).

## Repository Layout (planned)

``` tree
fav-fifty/
├── README.md
├── CLAUDE.md              # Guidance for AI assistants working in this repo
├── .gitignore
├── .claudeignore
├── docs/
│   ├── NEXT_STEPS.md      # Roadmap & phased build plan
│   ├── DECISIONS.md       # Resolved decisions & product data model
│   ├── QUESTIONS.md       # Decision deliberation & trade-offs (record)
│   ├── SETUP.md           # External setup: Google OAuth, AWS, Route 53/DNS
│   ├── DESIGN.md          # Frontend look-and-feel decisions & design system
│   ├── CONSIDERATIONS.md  # Security, cost, scaling, legal notes
│   └── *_PLAN.md, MOBILE_READINESS.md  # Per-feature implementation plans
├── frontend/              # Vue 3 + Vite + TS app (scaffold)
├── backend/               # FastAPI app (skeleton)
└── infra/                 # (later) Infrastructure as code
```

## Getting Started

Each app has its own env template — copy the one(s) you need and fill in values:

```bash
 cp backend/.env.example backend/.env         # API config: DB, SECRET_KEY, auth
 cp frontend/.env.example frontend/.env.local # SPA config: only VITE_ vars (public)
```

- **Frontend:** see [`frontend/README.md`](frontend/README.md) — `cd frontend && npm install && npm run dev` (<http://localhost:5173>).
- **Backend:** see [`backend/README.md`](backend/README.md) — `cd backend && uv sync --extra dev && uv run uvicorn app.main:app --reload` (<http://localhost:8000>).
- **Database:** `docker compose up -d db` (local Postgres) from the repo root.

## Contributing

Personal project for now. See [CLAUDE.md](CLAUDE.md) for conventions.

## License

MIT — see [LICENSE](LICENSE).
