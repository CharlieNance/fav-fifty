# Account Page + Avatars — Implementation Plan

Planning doc for giving signed-in users a real avatar in the header and an **Account**
page to click through to, built so that adding **Apple** and **email** sign-in later
doesn't mean redoing it. Nothing here is built yet.

## Scope

### In scope

- Fix the header avatar, which currently always shows `?` (a bug, see below)
- An `AvatarService` seam on the backend that works out a user's avatar from how
  they signed in. Google is the only provider for now, and the service is shaped for
  Apple and email.
- Record *which* provider a user signed in with (needed by the avatar service and
  shown on the account page)
- A new `/account` page, with the header avatar + name linking to it

### Out of scope (tracked for later)

- Actually adding Apple or email sign-in (see §Future providers for what each needs)
- User-uploaded avatars (see §Option C)
- Linking two sign-in methods to one account (see §Account linking)
- Account deletion / data export (worth doing before a wider launch, but a separate
  slice)

## Finding: the `?` is a casing bug, not a missing feature

Most of the plumbing already exists:

- `CognitoIdentityProvider` reads the `picture` claim from the id token
  (`backend/app/auth/providers.py`).
- `user_service._apply_login` saves it to `users.avatar_url` on **every** login, so
  it stays in sync if the user changes their Google photo.
- `GET /me` returns it via `UserRead`, **as `display_name` / `avatar_url`**
  (snake_case, which is Pydantic's default).
- The frontend `User` interface (`frontend/src/stores/auth.ts`) expects
  **`displayName` / `avatarUrl`** (camelCase). Nothing converts between the two, so
  both are `undefined`. `AppHeader.vue` then falls back to the initial of an
  undefined name, which is `?`.

The rest of the frontend already uses the API's snake_case directly (for example,
`item.image_url` in `ListItemRow.vue`). So the fix is to make `User` match, not to
add a case-conversion layer.

**Step 0 (a tiny PR on its own):** change `User` to `display_name` / `avatar_url`,
update `AppHeader.vue` and the specs. Add a spec whose fixture has the **real API
shape**; the current spec fixtures are camelCase, which is why tests didn't catch
this. After that, Google users should see their photo and dev-login users should see
"D".

If the photo still doesn't show after Step 0, the next suspect is the Cognito
attribute mapping (Google `picture` → Cognito `picture`, docs/SETUP.md step 4). A
token without that mapping carries no `picture` claim.

Also add `referrerpolicy="no-referrer"` to the avatar `<img>`. Google's image host
(`lh3.googleusercontent.com`) sometimes returns 403 on hotlinked avatars when a
referrer is sent. A `@error` handler that falls back to the initials covers the rest
(expired URL, rate-limit 429, offline).

## Where should the image live?

Three options, cheapest first.

### Option A — store the provider's URL, let the browser load it (recommended)

This is what the code already does. The provider gives us a URL at login, we save
that **string** (about 100 bytes) on the user row, and the browser loads the image
straight from Google's CDN.

- **Cost:** effectively zero. We never store or serve image bytes, and there's no
  S3 and no bandwidth cost.
- **Freshness:** refreshed on every login, which is often enough for an avatar.
- **No per-request fetching:** this also answers the "fetch it every request?"
  worry. We never call Google for the image. We re-read the URL only when the user
  logs in, and it's in the id token we're already verifying anyway.
- **Downsides:** we depend on the provider's URL staying valid between logins
  (Google's generally do), and the viewer's browser talks to Google directly. The
  initials fallback covers the first; the second is normal for a social-login site.

### Option B — fetch from the provider's API on demand

Call Google's API whenever we need the image. **Not recommended:** it's slower, it
needs an access token for each user long after login (so we'd have to store refresh
tokens, which is a real security liability), and it gives us nothing Option A
doesn't.

### Option C — copy the image into our own storage (S3)

Download the image at login and serve it from S3/CloudFront. **Not needed now.** At
10 users it would cost pennies, but it adds infra, a bucket policy, and cleanup on
account deletion, all to fix a problem we don't have. It becomes worth it **only if**
we add *user-uploaded* avatars, which is also the natural answer for email-signup
users (below). Revisit then.

**Recommendation: Option A,** behind the service below, so switching a provider to
Option C later is a change inside one function.

## The `AvatarService` seam

This follows the same idea as the existing auth seam (`Claims` + `IdentityProvider`):
nothing outside the service knows *where* an avatar comes from.

### 1. Record the sign-in provider

Cognito id tokens for federated users carry an `identities` claim, e.g.
`[{"providerName": "Google", ...}]`. Native Cognito users (future email sign-up)
don't have it.

- Add `provider: Literal["google", "apple", "email", "dev"]` to `Claims`.
  `CognitoIdentityProvider` derives it from `identities[0].providerName`, or
  `"email"` when the claim is absent. `DevIdentityProvider` returns `"dev"`.
- Add `users.auth_provider` (`String(20)`, nullable) with an **Alembic migration**.
  Existing rows are `NULL` until their next login fills it in, the same backfill
  pattern `users.email` already uses. No data migration is needed.
- `_apply_login` keeps it up to date like the other profile fields.

### 2. The service

```python
# backend/app/services/avatar_service.py
def resolve_avatar_url(provider: str | None, claims: Claims) -> str | None:
    """Decide what avatar URL to store for this login, by sign-in provider."""
    match provider:
        case "google":
            return claims.picture          # Option A: provider's own URL
        case "apple":
            return None                    # Apple never sends a photo
        case "email":
            return None                    # or Gravatar, see below
        case _:
            return claims.picture
```

`user_service._apply_login` / `get_or_create_user` call this instead of copying
`claims.picture` directly. `None` is always a valid answer, and the frontend shows
the initials.

This runs **at login**, not on every request. The result is saved to
`users.avatar_url`, so `GET /me` stays a plain row read.

### 3. Validate what we store

`avatar_url` ends up in an `<img src>`. We treat it like other untrusted input and
accept only `https://` URLs of at most 1024 characters, the column's limit.
Otherwise we store `None`. It comes from a verified token, but checking costs
nothing.

### Tests (pytest)

- One test per provider branch in `resolve_avatar_url`
- `CognitoIdentityProvider` derives `provider` from `identities` (Google, missing
  claim, unknown provider name)
- Login stores / refreshes / clears `auth_provider` and `avatar_url`
- A non-https or overlong `picture` is stored as `None`

## Future providers: what each means for avatars

### Apple

- **No profile photo, ever.** Sign in with Apple doesn't share one. Apple users get
  initials (or an uploaded avatar, if we add that later), and the service already
  returns `None` for them.
- Apple sends the user's **name only on the very first sign-in**, and some users
  choose "Hide My Email", which gives a `@privaterelay.appleid.com` address.
  `_apply_login` currently overwrites `display_name` on every login. For Apple it
  must **not** overwrite a stored name with an empty or missing one; it already
  skips empty names, so this should hold, but it needs a test.
- **Cost:** Sign in with Apple requires a paid **Apple Developer Program**
  membership, **US$99/year** as of my knowledge (please confirm on
  developer.apple.com). That's a recurring fixed cost, so per CLAUDE.md it needs your
  sign-off. Cognito itself doesn't charge extra for it.
- **Hardware:** you **shouldn't need a Mac or iPhone**. Setup (Services ID, key,
  domain verification) is done in the browser at developer.apple.com, and web
  sign-in works in any browser. You do need an Apple ID with two-factor auth, which
  can use a phone number. Enrollment has sometimes pushed people toward the Apple
  Developer app; confirm the web enrollment path is still open before committing.

### Email sign-up

- **This reverses a recorded decision.** DECISIONS.md, QUESTIONS.md, and CLAUDE.md
  ("Never introduce email/password auth") all say social-only. Update those first,
  as their own change, when you're ready.
- Cognito's native user pool handles it (verification codes, password reset), so we
  never store passwords ourselves. Cognito's built-in email sender is free but
  capped at a small daily volume, which is fine at our size. Heavier use means
  Amazon SES (pay-per-email, fractions of a cent).
- **Avatar:** no provider photo. Two cheap options:
  - **Initials only** (zero work, already the fallback)
  - **Gravatar:** `https://gravatar.com/avatar/<sha256(email)>?d=404`. It stores
    nothing on our side, but it exposes a hash of the user's email in the page, and
    hashes of emails can sometimes be reversed. Make it opt-in, or skip it.
  - If people want real photos, that's the point to build Option C (uploads).

### Account linking (flagging, not solving)

The same person signing in with Google and later with Apple (or email) gets **two
Cognito users, two `sub`s, and two separate Fav Fifty accounts** with separate lists.
Cognito can link identities (`AdminLinkProviderForUser`), but we need to decide the
UX. The `users.email` column is a start, but Apple's hidden emails won't match. This
should be decided **before** Apple or email launches, not after.

## Account page

### Header change (`AppHeader.vue`)

Wrap the avatar + name in a `RouterLink to="/account"` with
`aria-label="Your account"`, and give it a visible hover/focus style. Keep "Log out"
where it is.

### Route

`/account` → `features/account/AccountView.vue`, lazy-loaded,
`meta: { requiresAuth: true }`, following the existing routes in
`router/index.ts`.

### What it shows (v1: read-only)

| Field | Source | Notes |
| --- | --- | --- |
| Avatar (large) + display name | `/me` | same fallback as the header |
| Email | `/me` (new field) | only ever returned to the user themself |
| Signed in with | `/me` (new `auth_provider`) | "Google", later "Apple" / "Email" |
| Member since | `created_at` | already in `UserRead` |
| Number of lists | new count, or reuse the list endpoint | optional |
| **Log out everywhere** | `POST /me/sessions/revoke` (new) | wraps the existing `user_service.revoke_all_sessions` |
| Log out | existing `useLogout` | |

### Backend changes

- A `MeRead` schema that extends `UserRead` with `email` and `auth_provider`, used
  **only** by `GET /me`. `UserRead` stays email-free, so if user profiles become
  public later (sharing, comments), nobody's email leaks by accident.
- `POST /me/sessions/revoke`: bump `session_token_version`, clear this response's
  cookie, return 204. Needs tests (current session is invalidated, other sessions
  are too).

### Later (not v1)

- **Editable display name.** This needs a decision first, because `_apply_login`
  currently overwrites `display_name` from the provider on every login, which would
  undo the user's edit. Add a `display_name_overridden` flag, or stop syncing the
  name after first login.
- Account deletion (the `lists` relationship already cascades), which matters for
  the privacy policy in `docs/legal/`.

### Tests (Vitest)

- Header: shows the `<img>` when `avatar_url` is set, initials when it's null, and
  initials after the image fires `error`; links to `/account`
- AccountView: renders each field and calls the revoke endpoint
- Router: `/account` redirects to login when signed out

## Suggested PR order

1. **Fix the casing bug + `referrerpolicy` + `@error` fallback** (frontend only,
   tiny, immediately visible)
2. **`auth_provider` column + `Claims.provider` + `AvatarService`** (backend,
   migration, pytest)
3. **`MeRead` + revoke-sessions endpoint** (backend)
4. **Account page + header link** (frontend)
5. Later, separately: Apple, then email, each updating `resolve_avatar_url`

## Open questions for the owner

1. OK with **Option A** (store the URL, not the image) until user uploads exist?
2. Is the **$99/yr Apple Developer fee** acceptable, or does Apple wait?
3. When email sign-up comes: **initials only, or opt-in Gravatar?**
4. **Account linking:** same email across providers means one account, or keep them
   separate?
5. Should v1 of the account page include **editable display name**, or stay
   read-only?
