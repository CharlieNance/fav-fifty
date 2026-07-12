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
   - While testing you can leave it in **Testing** mode and add your Google account as a
     test user; **publish** the consent screen before real users sign in.
   - A **privacy policy URL** is required to publish (note for later — see
     [CONSIDERATIONS.md](CONSIDERATIONS.md) §Legal).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Name: `fav-fifty-web`.
   - **Authorized redirect URIs:** these point at **Cognito**, not directly at our app.
     You'll fill these in once the Cognito domain exists (step 3 below). They look like:
     - `https://<your-cognito-domain>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
   - For purely local experiments you may also add a localhost callback later if needed.
4. Save the **Client ID** and **Client secret** → put them in `backend/.env`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and, later, into Cognito's Google IdP config.

> Order note: you can create the client now and come back to add the exact redirect URI
> after Cognito is set up — or do Cognito first. Either works; the redirect URI is the link.

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

## 3. AWS Cognito (auth broker) — outline

> Full config happens when we build auth in Phase 1; this is the shape of it.

1. Create a **Cognito User Pool**.
2. Add **Google** as a social identity provider, using the Client ID/secret from step 1.
3. Set up a **Cognito hosted domain** (e.g. `favfifty.auth.us-east-1.amazoncognito.com`)
   — this domain's `/oauth2/idpresponse` URL is the redirect URI Google needs (step 1.3).
4. Create an **app client**; configure callback/sign-out URLs to our frontend
   (`http://localhost:5173` for dev, `https://favfifty.com` for prod).
5. Capture `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`,
   `COGNITO_DOMAIN`, `COGNITO_REGION` into `backend/.env`.

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
- [x] Google OAuth **Web application** client ID + secret created → store in `backend/.env`
- [x] AWS account secured: root MFA, IAM user with admin via group, MFA on the IAM user
- [x] AWS **budget + billing alarm** created; billing access enabled for the IAM user
- [ ] AWS access keys for CLI/Terraform created → in `~/.aws/credentials` (when starting infra)
- [ ] Cognito user pool + Google IdP + hosted domain + app client (Phase 1)
- [ ] Google redirect URI added to the OAuth client (Cognito `/oauth2/idpresponse`)
- [ ] Route 53 hosted zone created; **email MX/SPF/DKIM/DMARC copied over**
- [ ] Squarespace nameservers pointed at Route 53; DNS + email verified
