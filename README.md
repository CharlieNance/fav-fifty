# Fav Fifty

> Make lists of your fifty favorite things — bands, desserts, video games, anything — and share them.

**Fav Fifty** ([favfifty.com](https://favfifty.com)) is a web app for curating ranked lists of your 50 favorite things in any category. Start without an account — lists are saved on your device — and sign in with a social account to keep them across devices. Find-as-you-type lookup fills in movies, shows, albums, places and more. Eventually you'll be able to share lists, comment on others', suggest items, ask questions, and vote on the best lists — and use it from iOS and Android apps.

---

## Status

🚧 **Pre-launch, running locally.** Built: Google sign-in via AWS Cognito; lists with up to 50 ranked items, tags and search; and **use without an account**, with lists saved on the device that can be exported, imported, and added to an account on sign-in.

Next, before launch: abuse protection, an admin portal, cost guardrails that take the site offline rather than run up a bill, and the first deploy. After that: catalog lookup and a margin art showcase. See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

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

Decisions recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

- **Frontend:** Vue 3 + Vite + TypeScript, Pinia (state), Vue Router, Tailwind CSS. Vitest + ESLint. Hosted as a static SPA on S3 + CloudFront.
- **Backend:** Python + FastAPI (REST API), Pydantic for validation. pytest + Ruff.
- **Database:** PostgreSQL 16, in Docker on the production Lightsail box (same image as local dev).
- **Auth:** Optional. Social login only via AWS Cognito — **Google at launch** (Facebook/Apple possible later; Apple required before iOS). No email/password.
- **Catalog data:** external APIs (TMDB, Deezer/iTunes, Photon/OSM, Wikipedia, …) called from the backend only.
- **Backend hosting:** one AWS Lightsail instance running Docker Compose (FastAPI + Postgres) behind CloudFront at `favfifty.com/api/v1`; stateless routes (catalog lookup, showcase) run the same image on AWS Lambda. Expected bill ~$13–15/month, almost all fixed, with cost guardrails that take the site offline before a big bill.
- **Infrastructure:** AWS, defined as code with Terraform. DNS via Route 53 (domain registered at Squarespace).
- **Secrets:** `.env` locally (git-ignored); AWS Secrets Manager / SSM in deployed environments.

> ⚠️ The repo is **public**. Never commit real secrets — each app has its own template: [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example).

## Repository Layout

``` tree
fav-fifty/
├── CLAUDE.md              # Conventions (for people and AI assistants)
├── frontend/              # Vue 3 + Vite + TS app
├── backend/               # FastAPI app
├── tools/                 # Dev helper scripts (see tools/README.md)
├── infra/                 # (later) Terraform
└── docs/
    ├── NEXT_STEPS.md      # Roadmap — start here
    ├── ARCHITECTURE.md    # How the built parts work, and why
    ├── DECISIONS.md       # Resolved decisions & data model
    ├── DESIGN.md          # Look-and-feel decisions & design system
    ├── CONSIDERATIONS.md  # Security, cost, scaling, legal notes
    ├── SETUP.md           # External setup: Google OAuth, AWS, Cognito, DNS
    ├── legal/             # Privacy policy & terms
    └── *_PLAN.md, MOBILE_READINESS.md, EMAIL_SIGNIN_OPTIONS.md  # Plans for unbuilt work
```

**New here?** Read this README, then [NEXT_STEPS.md](docs/NEXT_STEPS.md) and
[ARCHITECTURE.md](docs/ARCHITECTURE.md). The `*_PLAN.md` files only matter when you
pick up that feature.

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
