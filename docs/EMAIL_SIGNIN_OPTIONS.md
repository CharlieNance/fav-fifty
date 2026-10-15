# Email Sign-up — Options (not decided)

_Drafted 2026-10-13 for the owner to think over. **Nothing here is decided.** Today's rule
(CLAUDE.md, DECISIONS.md) is still **"social login only, no email/password."**_

## The question

Now that anonymous users are allowed, should people also be able to **create an account
with just an email address**? That would need:

- a plain email + password sign-up;
- a password rule of 8+ characters with at least one letter and one number;
- a "forgot password" reset by email;
- passwords stored so they can't be reversed;
- probably optional 2FA.

The owner wants it **as simple as possible** and doesn't want to own much of it.

## Short version

- **We don't have to build any of it.** The AWS Cognito user pool we already use for
  Google sign-in **does all of this out of the box**: sign-up, email verification,
  sign-in, forgot/reset password, a password policy, and authenticator-app 2FA. It also
  provides **ready-made pages** for all of it ("Managed Login").
  - Cognito stores passwords so they can't be reversed. **Our app and database never
    see them.**
  - Our backend changes very little: the same login redirect and callback we already
    have.
- **Writing our own is not recommended** (see Option C). It's a lot of security-critical
  code for something Cognito does for free.
- **Something even simpler to consider:** _no passwords at all._ Cognito can sign people
  in with a **one-time code emailed to them**, or a **passkey** (Face ID, a fingerprint, a
  phone). Then there's no password rule, no password reset, and less of a 2FA question
  (Option B).
- **Doing nothing is also a fine answer** (Option 0). Anonymous mode already removes the
  "must have Google" wall, and Apple sign-in arrives with the iOS app.

## Option 0 — Don't add email accounts (status quo)

- Anyone can use the app anonymously; lists stay on their device.
- Accounts (to keep lists across devices, and later to publish) need Google, or Apple
  later.
- **Pros:**
  - Zero new work.
  - No passwords anywhere near us.
  - No email sending to set up.
  - Bots have a harder time creating accounts (they'd need real Google accounts).
- **Cons:** someone without (or unwilling to use) a Google account can't sync or
  publish until Apple sign-in exists, and Apple only helps Apple users.

## Option A — Email + password via Cognito Managed Login (recommended _if_ you want passwords)

**How it works for a user:**

1. They click **Sign in** and land on a Cognito-hosted page, styled with our logo and
   colors.
2. That page shows **"Continue with Google"** _and_ an email/password form, with
   **Create account** and **Forgot password?** links.
3. **Sign-up:** they enter an email and password → Cognito emails a verification code →
   they enter it → they're signed in and sent back to Fav Fifty.
4. **Forgot password:** they enter their email → get a reset code by email → choose a new
   password.

The sign-up, verification, reset and lockout pages are all Cognito's. We write none of
them.

**What changes on our side (small):**

- **Login page:** add a "Sign in with email" button that sends people to the hosted page
  _without_ forcing Google. Today the code passes `identity_provider=Google` to skip
  straight to Google; we'd keep that for the Google button and drop it for the email
  button.
- **Backend:** the same `/auth/login` → `/auth/callback` flow, the same token checks and
  the same session cookie. The claims mapping learns a new sign-in provider (`email`),
  which [ACCOUNT_AND_AVATAR_PLAN.md](ACCOUNT_AND_AVATAR_PLAN.md) already anticipated
  (initials instead of a photo).
- **Display name:** email users have no Google name. Default to the part of the email
  before the `@`, and let them change it on the Account page.
- **Cognito console / Terraform:**
  - turn on email + password sign-up;
  - set the password policy;
  - set up email sending (see §Email sending);
  - brand the Managed Login pages.

**The password rule you asked for (8+ characters, one letter, one number):**

- Cognito's policy settings are: minimum length, require numbers, require lowercase,
  require uppercase, require symbols. There's **no "any letter, either case" option**.
- **Closest match:** minimum length **8** + **require numbers** + **require
  lowercase**. In practice it means "8+ characters, with a number and a lowercase
  letter".
- **Modern advice** (NIST SP 800-63B) actually favors _length_ over composition rules.
  Something like "at least 10 characters, no other rules" is both easier for users and
  stronger. Your call; either works.

**How passwords are stored:** the password is typed into Cognito's page, so **our
servers never receive it**. Cognito stores only a one-way, irreversible form of it,
never the password itself. Users who forget their password can only reset it. That's
exactly the "no way to reverse it" requirement.

## Option B — Passwordless via Cognito (simplest for users; worth a real look)

Cognito's **Essentials** tier (the default for user pools created since November 2024)
supports **passwordless sign-in** on Managed Login:

- **Email one-time code:** enter your email → get a 6-digit code → you're in. No
  password to create, remember or reset. Sign-up and sign-in are the same flow.
- **Passkeys:** sign in with Face ID, Touch ID, Windows Hello or a phone. They can't be
  phished, and they're increasingly familiar to people.

**Why it's attractive:**

- No password policy.
- No "forgot password".
- **No password database to worry about.**
- 2FA matters much less: an email code is already "something you have" (your inbox),
  and passkeys are stronger than password + 2FA.

**Trade-offs:**

- Every email-code sign-in sends an email, so email sending must be reliable (it
  effectively requires SES; see below).
- Some people still expect a password box.
- Per AWS docs, passwordless **can't be combined with _required_ MFA** in the same pool.
- It **only works with Managed Login** (not the older hosted UI), which is fine because
  that's what we'd use anyway.

You can also offer **both** passwords and passkeys/email codes on the same Managed Login
page, and let people choose.

## Option C — Build our own (not recommended)

What "write our own" really means:

- **Our own code:**
  - an `argon2id` password-hashing library;
  - a `password_hash` column and migration;
  - sign-up, sign-in and reset endpoints, plus their UI;
  - single-use, expiring reset tokens;
  - email sending (SES anyway);
  - email verification;
  - lockout after failed attempts;
  - credential-stuffing defenses and rate limits;
  - 2FA enrollment and verification;
  - recovery codes.
- **Plus:**
  - a second auth system alongside Cognito (two code paths for every login concern);
  - and **we'd be holding password hashes**, which raises the stakes if the box were
    ever compromised.
- Cognito does every item above for free. Only worth it if Cognito's pages were truly
  unacceptable, and even then Cognito's APIs can power a custom UI without us storing
  passwords.

## 2FA (two-factor authentication)

| Method | Free? | Notes |
| --- | --- | --- |
| **Authenticator app (TOTP)**: Google Authenticator, Authy, 1Password, etc. | **Yes**, per Cognito pricing guides | The standard free option. Can be pool-wide **Optional** or **Required**. |
| Email code as a second factor | No extra Cognito fee, but needs **SES** set up | Essentials tier |
| SMS code | **No:** per-message fees, and US sending needs a registered number | Not recommended (cost + SIM-swap risk) |
| Passkeys | Yes (Essentials) | Strong enough on their own that a second factor isn't needed |

**Practical recommendation, if Option A:** offer **optional TOTP 2FA**, but not at
launch. Here's the catch:

- **"Required" 2FA:** Cognito's Managed Login walks every email user through
  authenticator setup on their first sign-in. That needs no code from us, but it's
  real friction for a hobby site.
- **"Optional" 2FA:** users need somewhere to turn it on. That means an Account-page
  feature that talks to Cognito's MFA APIs with the user's Cognito access token. Today
  our backend uses that token once at login and then issues its own session, so this is
  a small but real project.
- Google sign-in users are unaffected either way; Google handles their 2FA.

With **Option B (passwordless)**, the 2FA question mostly goes away.

## Email sending (needed for Options A and B)

- **Cognito's built-in sender:** zero setup, but it's **heavily rate-limited per day**
  (forum reports say ~50/day; AWS only says it's "below typical production needs") and
  sends from a generic AWS address. Fine for testing, not for real users.
- **Amazon SES** (recommended): emails come from e.g. `no-reply@favfifty.com`.
  - **Cost:** about **$0.10 per 1,000 emails**, so effectively pennies. **No fixed
    monthly fee** (unless you buy a dedicated IP, which we won't).
  - **Setup:**
    - verify the `favfifty.com` domain in SES (DKIM records added to Route 53);
    - **request production access** (new SES accounts start in a "sandbox" that can
      only email verified addresses; approval usually takes about a day);
    - point the user pool at SES.
  - **Careful with the domain's existing email:** Google Workspace already handles
    `favfifty.com` mail. Adding SES DKIM records doesn't affect that. If we also
    set a custom "MAIL FROM", the SPF record must _include_ SES alongside Google, not
    replace it.

## Cost and abuse (ties into the cost guardrails)

- **Cognito:** the same 10,000 monthly-active-user free tier, then about $0.015 per user
  per month on Essentials. Email users count the same as Google users.
- **The new risk:** email sign-up is **much easier for bots** than creating Google
  accounts. Mass fake sign-ups would:
  - use up the free tier (10,000 fake accounts beyond it would be roughly $150);
  - send verification emails to random addresses, which hurts SES reputation, and
    AWS can pause SES for that.
- **Mitigations:**
  - Require **email verification before an account is usable** (Cognito default).
  - Add a **sign-up spike alarm** (already planned).
  - Make the cost breaker's Level 1 **turn off self-sign-up** in Cognito, so existing
    users can still sign in. One API call; fits
    [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md).
  - **CAPTCHA:** a WAF CAPTCHA on the Cognito user pool is possible, but WAF attached
    to Cognito is **not** covered by our free CloudFront plan (about $5+/month).
    Flagged; only add it if bots actually show up.

## Things to check in our existing user pool (before deciding)

Some user-pool settings **can't be changed after the pool is created**. Verify these in
the console:

1. **Sign-in identifier:** is the pool set up to sign in by **email**? If it was
   created username-based, adding email sign-in may need a **new user pool**.
2. **Required attributes:** what does sign-up demand (email? name?)? These are fixed
   at creation. Managed Login's sign-up form asks for whatever's required.
3. **Feature tier:** Lite or Essentials? Managed Login and passwordless need
   **Essentials**. That's a setting you can change, not a new pool.

If a new pool turns out to be needed, it's survivable. This is exactly the case the
`users.email` relink safety net was built for (DECISIONS.md §Product data model). Each
user's next login re-links by email.

## Other knock-on effects

- **Same email via Google _and_ a password:** Cognito treats those as **two separate
  accounts** by default. Linking them is possible (a pre-sign-up trigger) but adds
  complexity. Simplest: keep them separate at first. This is already open question 4 in
  ACCOUNT_AND_AVATAR_PLAN.md.
- **Account deletion:** already planned (the mobile stores require it). It covers email
  users the same way.
- **Mobile apps:** Managed Login works through the system browser, exactly like the
  planned Google flow. Nothing extra. (Apple's guideline 4.8 is about _third-party_
  logins; our own email accounts don't change the "offer Sign in with Apple on iOS"
  requirement.)
- **Testing:** the dev-login stub keeps working for local development. The hosted
  Cognito pages can't run in local e2e tests; they get a manual check in the real
  environment, like Google login today.
- **Privacy policy and terms:** mention email accounts and that we send account emails
  (verification, codes, resets) via AWS SES.
- **Docs and rules:** CLAUDE.md's "never introduce email/password auth" rule, the
  DECISIONS.md auth row, and the README would all change.

## Rough effort

| Option | Our code | Console / infra | Ongoing burden |
| --- | --- | --- | --- |
| 0 — Do nothing | none | none | none |
| A — Passwords via Cognito | ~1–2 small PRs (login button, claims/provider, display-name default) | SES setup + sandbox exit, pool settings, branding | low (Cognito owns it) |
| B — Passwordless via Cognito | about the same as A | same as A, plus Essentials tier | low |
| A or B + optional TOTP 2FA | + an Account-page MFA feature | — | low |
| C — Build our own | weeks of security-sensitive work | SES anyway | **high** |

## Questions to think about in the morning

1. **Email accounts at all?** (Option 0 is a legitimate answer: anonymous + Google, plus
   Apple later.)
   > Decision: I think either 0 or B, leaning towards 0, but B seems kind of cool
2. If yes: **passwords (A), passwordless email codes/passkeys (B), or both on the same
   page?**
   > Decision: If yes, the nlet's go with B. No password seems ideal
3. If passwords: your rule (8+, a letter and a number → Cognito's "8 + number +
   lowercase"), or the NIST-style "10+ characters, no other rules"?
   > Decision: Sounds like we don't need this since we aren't dealing with passwords
4. 2FA: **none at launch, optional TOTP later** (recommended), or required for email
   users?
   > Decision: Yeah if we don't need 2FA let's not do it.
5. OK with **SES** (pennies, no fixed fee, about a day to get out of the sandbox)?
   > Decision: Yeah if we do go with Option B SES cost should be fine I think
6. Same email via Google and via a password: **separate accounts** (simplest) or linked?
   > Decision: Seperate accounts is fine. Linking seems interesting, but probably not woth the effort, since I'm not even committing to email login yet.

If it's a yes, I'll fold the answers into DECISIONS.md, update the CLAUDE.md auth rule,
and add the work to NEXT_STEPS.md (it would slot in after Track 0, alongside the auth
pieces).

---

Sources (checked 2026-10-13):
[Cognito pricing](https://aws.amazon.com/cognito/pricing/) ·
[Essentials plan features](https://docs.aws.amazon.com/cognito/latest/developerguide/feature-plans-features-essentials.html) ·
[Cognito email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html) ·
[Cognito MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html) ·
[Passwordless with Cognito](https://repost.aws/knowledge-center/cognito-passwordless-authentication) ·
[Cognito pricing explainer (dev.to)](https://dev.to/rafagross/amazon-cognito-pricing-tiers-mau-counting-and-the-defaults-that-inflate-the-bill-25hg)
