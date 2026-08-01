# External Setup Guide

One-time setup of the external accounts and services Fav Fifty depends on. None of
this is application code — it's the Google / AWS / Squarespace groundwork that the app
will plug into. Work through the sections roughly in order. Record any IDs/secrets in
your local `backend/.env` (never commit them).

---

## 1. Google OAuth — Web Application client ID

This gives the app a Google sign-in credential. With Cognito brokering auth, Cognito is
the OAuth "redirect" target; Google just needs to trust it.

1. Go to the **Google Cloud Console** → create (or select) a project, e.g. `fav-fifty`.
2. **APIs & Services → OAuth consent screen:**
   - User type: **External**.
   - App name `Fav Fifty`, support email, developer contact.
   - Scopes: the basics — `openid`, `email`, `profile`.
   - While testing you can leave it in **Testing** mode; **publish** the consent screen
     before real users sign in.
   - **Add yourself as a test user** — **Audience** (or **Test users**) tab → **Add
     users** → enter your Gmail address. While the app is in Testing mode, *only*
     accounts listed here can complete the OAuth flow (everyone else gets blocked at
     Google's consent screen), so this is the one console step you need before you can
     personally test sign-in end to end.
   - A **privacy policy URL** is required to move to Production (not needed while in
     Testing). Draft is ready at [docs/legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md) —
     it just needs a real contact email and a hosted URL before publishing. See
     [CONSIDERATIONS.md](CONSIDERATIONS.md) §Legal and [DECISIONS.md](DECISIONS.md)
     §Auth detail.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Name: `fav-fifty-web`.
   - **Authorized redirect URIs:** the **only** entry this needs is Cognito's callback —
     `https://<your-cognito-domain>.auth.<region>.amazoncognito.com/oauth2/idpresponse`.
     You'll fill this in once the Cognito domain exists (§3 Step C below).
   - **Don't add a `localhost` redirect URI here.** In this architecture the browser
     never hits Google directly — Cognito is the OAuth client that talks to Google, and
     our backend only ever talks to Cognito. That's true even for local dev (see §3
     Step D), so Google only ever needs to know about Cognito's redirect URI.
4. Save the **Client ID** and **Client secret** → put them in `backend/.env`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and, later, into Cognito's Google IdP config.

> Order note: you can create the client and add your test user now, then come back to
> add the exact redirect URI after Cognito is set up (§3) — Cognito must exist first
> since the redirect URI is *its* domain.

---

## 2. AWS account + cost guardrails (do this before deploying anything)

1. Have an AWS account; secure the **root user** with MFA and create an **IAM admin user**
   (or use IAM Identity Center) for day-to-day work — don't use root.
2. Pick a home region — **`us-east-1`** is a good default (also required for some
   ACM/CloudFront certs).
3. **Set a budget + alarm first thing:** AWS Billing → **Budgets** → create a monthly cost
   budget (e.g. **$10**) with email alerts at 50% / 80% / 100%. This is the safety net
   against a misconfiguration quietly costing money.
4. (Optional but nice) enable **Cost Explorer** and tag resources with `project=fav-fifty`.

---

## 3. AWS Cognito (auth broker)

**✅ Done (2026-07-31) — "Continue with Google" works end to end.** This section is kept
as the reference for what was configured and why, in case the pool ever needs to be
recreated.

**You need this section done before "Continue with Google" will work anywhere, including
localhost.** Cognito, not the browser, is the party that talks to Google — until the
Cognito user pool, IdP, domain, and app client all exist, there's no redirect URI to give
Google and no token to hand your backend. Nothing here is application code; it's console
configuration that unblocks code that's already written and waiting.

The backend code for the real flow is **done** (branch `feat/auth-page`): `/auth/login`
redirects to Cognito's hosted UI, and `/auth/callback` verifies the returned id token
and mints our session. It stays dormant (routes 404) until the five `COGNITO_*` values
are set. This section fills them in. Values below must match the code **exactly** — the
code's expectations are called out inline.

Do everything in one region (`us-east-1` recommended) and keep the browser tab with
`backend/.env` open to paste values as you go.

**Step A — Create the user pool.**
1. Cognito → **Create user pool**.
2. Sign-in options: you can leave the Cognito-native options unchecked — we only use a
   federated provider. (Cognito requires at least a pool; we won't use its own accounts.)
3. Name the pool e.g. `favfifty`. Create it.
4. Copy the **User pool ID** (looks like `us-east-1_ABC123`) → `COGNITO_USER_POOL_ID`.
   `COGNITO_REGION` is the region prefix (`us-east-1`).

**Step B — Add Google as an identity provider.**
1. User pool → **Sign-in experience → Federated identity provider sign-in → Add**.
2. Choose **Google**. Paste the **Client ID / Client secret** from §1 (`GOOGLE_CLIENT_ID`
   / `GOOGLE_CLIENT_SECRET`).
3. **Authorized scopes:** `openid email profile`.
4. **Attribute mapping** — the id token only carries what you map here, and the app reads
   `email`, `name`, `picture`:
   - Google `email` → Cognito `email`
   - Google `name` → Cognito `name`
   - Google `picture` → Cognito `picture`
5. Save. The provider name will be **`Google`** — the code sends `identity_provider=Google`
   to skip the account chooser, so keep this exact name.

**Step C — Hosted UI domain.**
1. User pool → **App integration → Domain → Create Cognito domain**.
2. Pick a prefix, e.g. `favfifty` → full host `favfifty.auth.us-east-1.amazoncognito.com`.
3. Put that **host only** (no `https://`) into `COGNITO_DOMAIN`.
4. Back in **Google Cloud Console** (§1.3), add this to the OAuth client's **Authorized
   redirect URIs**: `https://<domain>/oauth2/idpresponse`.

**Step D — Create the app client.**
1. User pool → **App integration → App clients → Create app client**.
2. Type: **Confidential client** (our backend holds the secret) → this generates a
   **client secret**.
3. **Allowed callback URLs** — must equal `COGNITO_REDIRECT_URI` exactly:
   - dev: `http://localhost:8000/auth/callback`
   - prod: `https://api.favfifty.com/auth/callback` (your API origin)
4. **Allowed sign-out URLs:** your frontend, e.g. `http://localhost:5173` /
   `https://favfifty.com` (not used yet, but set it for later hosted-UI logout).
5. **Identity providers:** enable **Google** (not Cognito user pool).
6. **OAuth grant types:** **Authorization code grant** only. **Scopes:** `openid`,
   `email`, `profile`. (The code uses auth-code **+ PKCE (S256)**, which Cognito allows
   alongside a confidential client — nothing extra to toggle.)
7. Copy **Client ID** → `COGNITO_CLIENT_ID` and **Client secret** → `COGNITO_CLIENT_SECRET`.

**Step E — Fill in `backend/.env` and set `FRONTEND_URL` / `COGNITO_REDIRECT_URI`.** With
all five `COGNITO_*` values plus `GOOGLE_CLIENT_ID/SECRET` set, restart the backend and
visit the app: "Continue with Google" now runs the real flow. (Locally, cookies work
across `:8000`/`:5173` because they share the `localhost` host; in production put the API
and site on the same registrable domain — e.g. `api.favfifty.com` + `favfifty.com` — and
set the session cookie's `Domain` to `.favfifty.com`, a deploy-time follow-up.)

---

## 4. DNS: move favfifty.com to Route 53 (keep registration at Squarespace)

Goal: register stays at Squarespace, DNS is managed in Route 53. **Your Google Workspace
email must keep working**, so we copy its records over *before* switching nameservers.
Since there's no active traffic, this is low-risk — but the mailbox still needs its MX
records present to receive mail.

**Step A — Inventory current DNS (captured 2026-06-28 via live DNS query).**

Records to **PRESERVE** by recreating them in Route 53:

```
; MX — Google Workspace email (apex record, name = favfifty.com)
favfifty.com.  MX  1   aspmx.l.google.com.
favfifty.com.  MX  5   alt1.aspmx.l.google.com.
favfifty.com.  MX  5   alt2.aspmx.l.google.com.
favfifty.com.  MX  10  alt3.aspmx.l.google.com.
favfifty.com.  MX  10  alt4.aspmx.l.google.com.

; TXT — Google Workspace domain verification (apex)
favfifty.com.  TXT  "google-site-verification=dccbeXoHRA4uA2VhVU4P36zSDnWJ3qObwmtIGgrRBsQ"
```

Records to **DROP** (Squarespace site infra you don't use — will be replaced by the
app's CloudFront alias later): apex `A` records (Squarespace IPs) and the
`www` CNAME → `ext-sq.squarespace.com`.

Not present today (optional to add later for email hygiene): **SPF**
(`v=spf1 include:_spf.google.com ~all`), **DKIM**, **DMARC** (`_dmarc`).

**Step B — Create the Route 53 hosted zone.** Route 53 → Hosted zones → create
`favfifty.com`. AWS gives you **4 nameservers (NS)** and an SOA record. (~$0.50/month.)

**Step C — Recreate the records in Route 53.** Add the MX/TXT/etc. records you
inventoried in Step A into the new hosted zone **first**. (Leave the site's A/ALIAS
record for when CloudFront exists.)

**Step D — Point Squarespace at Route 53.** In Squarespace domain settings, switch to
**custom nameservers** and enter the 4 Route 53 NS values. Verify Squarespace allows
custom nameservers for this domain (it generally does post-Google-Domains migration).

**Step E — Verify.** After propagation (minutes to a few hours):
   - `dig NS favfifty.com` shows the Route 53 nameservers.
   - `dig MX favfifty.com` shows Google's mail records.
   - Send a test email to the mailbox to confirm delivery.

**Later (during first deploy):** add an **ALIAS/A** record for `favfifty.com` (and `www`)
pointing at the CloudFront distribution, and request an **ACM certificate** (in
`us-east-1`) validated via a Route 53 DNS record for HTTPS.

---

## Checklist

- [x] Google OAuth consent screen configured
- [x] Your Google account added as a **test user** (consent screen still in Testing mode)
- [x] Google OAuth **Web application** client ID + secret created → store in `backend/.env`
- [x] AWS account secured: root MFA, IAM user with admin via group, MFA on the IAM user
- [x] AWS **budget + billing alarm** created; billing access enabled for the IAM user
- [ ] AWS access keys for CLI/Terraform created → in `~/.aws/credentials` (when starting infra)
- [x] Cognito user pool + Google IdP + hosted domain + app client (Phase 1) (2026-07-31)
- [x] Google redirect URI added to the OAuth client (Cognito `/oauth2/idpresponse`)
- [ ] Route 53 hosted zone created; **email MX/SPF/DKIM/DMARC copied over**
- [ ] Squarespace nameservers pointed at Route 53; DNS + email verified
