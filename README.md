# Fav Fifty

> Make lists of your fifty favorite things — bands, desserts, video games, anything — and share them.

**Fav Fifty** ([favfifty.com](https://favfifty.com)) is a web app where users sign in with a social account and curate ranked lists of their 50 favorite things in any category. Eventually you'll be able to share lists, comment on others', suggest items, ask questions, and vote on the best lists.

---

## Status

🚧 **Phase 0 — Foundation.** No application code yet. We're setting up the repo, documentation, and key decisions before building.

See [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the roadmap and [docs/QUESTIONS.md](docs/QUESTIONS.md) for open decisions.

## Vision

| Phase | Goal |
|-------|------|
| **1 — MVP** | Google login; create/read/update/delete personal lists of up to 50 items, with tags, ranking, and notes. Publish/unpublish. |
| **2 — Social** | Public lists, sharing via link, commenting. |
| **3 — Community** | Suggestions/questions on lists, voting on lists, discovery/browse. |
| **Later** | Search, profiles, notifications, moderation, and more. |

## Tech Stack

Decisions recorded in [docs/DECISIONS.md](docs/DECISIONS.md) (deliberation in [docs/QUESTIONS.md](docs/QUESTIONS.md)).

- **Frontend:** Vue 3 + Vite + TypeScript, Pinia (state), Vue Router, Tailwind CSS. Vitest + ESLint. Hosted as a static SPA on S3 + CloudFront.
- **Backend:** Python + FastAPI (REST API), Pydantic for validation. pytest + Ruff.
- **Database:** PostgreSQL on Aurora Serverless v2 (scales to zero when idle).
- **Auth:** Social login only via AWS Cognito — **Google at launch** (Facebook/Apple possible later). No email/password.
- **Backend hosting:** FastAPI in Docker on AWS Lightsail Containers.
- **Infrastructure:** AWS, defined as code with Terraform. DNS via Route 53 (domain registered at Squarespace).
- **Secrets:** `.env` locally (git-ignored); AWS Secrets Manager / SSM in deployed environments.

> ⚠️ The repo is **public**. Never commit real secrets — see [`.env.example`](.env.example).

## Repository Layout (planned)

```
fav-fifty/
├── README.md
├── CLAUDE.md              # Guidance for AI assistants working in this repo
├── .gitignore
├── .claudeignore
├── .env.example           # Template for local secrets (copy to .env)
├── docs/
│   ├── NEXT_STEPS.md      # Roadmap & phased build plan
│   ├── DECISIONS.md       # Resolved decisions & product data model
│   ├── QUESTIONS.md       # Decision deliberation & trade-offs (record)
│   ├── SETUP.md           # External setup: Google OAuth, AWS, Route 53/DNS
│   └── CONSIDERATIONS.md  # Security, cost, scaling, legal notes
├── frontend/              # (later) Vue 3 app
├── backend/               # (later) FastAPI app
└── infra/                 # (later) Infrastructure as code
```

## Getting Started

> Nothing to run yet. Setup instructions will be added once `frontend/` and `backend/` exist.

For now:

```bash
cp .env.example .env   # then fill in values as needed
```

## Contributing

Personal project for now. See [CLAUDE.md](CLAUDE.md) for conventions.

## License

TBD — see [docs/QUESTIONS.md](docs/QUESTIONS.md).
