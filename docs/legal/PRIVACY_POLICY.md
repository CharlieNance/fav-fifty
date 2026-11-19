# Privacy Policy

Last updated: 2026-11-18

Fav Fifty ("the app", "we") is a small personal project, not a company. This policy
explains what we collect and why, in plain language. It is not a substitute for legal
advice, but it's an accurate description of how the app actually works.

## Using Fav Fifty without an account

You don't need an account to make lists. If you don't sign in:

- **Your lists are saved only in your browser, on your device** (in its local storage).
  They are **never sent to us**, and we can't see them, back them up, or recover them.
- **They can be lost.** Clearing your browser's data for the site deletes them, and some
  browsers (Safari in particular) may delete them if you don't visit for a while. The
  app's **Export** button saves a copy as a file you keep.
- **Importing a file** reads it in your browser and adds its lists to your device. The
  file isn't uploaded anywhere unless you're signed in (see below).

The app also keeps a couple of small notes in your browser so it doesn't nag you:
when you last dismissed the "keep your lists safe" reminder, and, for the current
browser session only, that you chose "Not now" on the offer to add your lists to your
account. These aren't cookies, aren't used for tracking, and aren't sent to us.

The app does tell us, without any list content, *that* certain things happened (for
example "a list was created"), so we can see whether people use it. See
[Usage statistics](#usage-statistics) below.

## Usage statistics

We count how the app is used, in two ways. Neither uses cookies or advertising
identifiers, and neither is used for anything but understanding and improving Fav
Fifty.

- **Page visits, through Cloudflare Web Analytics.** A small script from Cloudflare
  counts page views, which site sent you (e.g. Discord), your country, and your
  browser and device type. Cloudflare sees your IP address to do this, as any website
  you load does, and gives us only totals; it doesn't use cookies or track you across
  sites. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **App events, sent to our own server.** When you open the app, create a list, add
  an item, export or import lists, or start and finish signing in, the app sends us a
  short note saying so. Each note has the event's name, the time, a random ID the app
  makes up for your browser tab (it's forgotten when you close the tab), whether
  you're on the web or a phone app, the app's version and, for a few events, a fixed
  label (such as whether an import went to your device or your account, or which
  sign-in button you used).
  - **Never included:** the titles or contents of your lists, anything you type,
    search text, or your IP address.
  - **If you're signed in,** the note is linked to your account. If you aren't, it
    isn't linked to anything that identifies you.
  - **Kept 90 days,** then only daily totals remain (counts, not individual notes).

## Protecting the service from abuse

Whether or not you sign in, our server counts the requests that reach it **per IP
address, per hour**: how many there were, and how many were turned away for coming
too fast. We use these counts only to spot floods and scraping, and to block an
address that is abusing the service.

- **Kept 7 days,** then deleted. They aren't linked to your account, your lists, or
  the usage statistics above.
- **A blocked address** stays on our block list, with a note of why, until we remove
  it.

## Adding your on-device lists to an account

When you sign in with lists saved on your device, the app asks whether to add them to
your account. **Nothing is uploaded unless you choose to.** If you do (or if you import
a file while signed in), those lists are sent to us and become part of your account,
covered by the rest of this policy. With each one we store a **random identifier the
app made up for your browser**, so a retry after a dropped connection can't add the same
list twice. It isn't linked to your device's hardware or to anything outside Fav Fifty.
Lists you upload are then removed from the device.

## What we collect when you sign in

- **An account identifier, name, and profile picture.** When you sign in with Google,
  our authentication provider (AWS Cognito) gives us a stable ID for your account, your
  display name, and your profile picture.
- **Your email address.** Google also shares your email address at sign-in. Our
  authentication provider (AWS Cognito) retains it as part of your account there, and
  our own application database stores it too, as a safety net so we can still find
  and reconnect your account if we ever have to recreate our Cognito user pool. We
  don't use it to contact you and it isn't shown to other users.
- **The content you save to your account.** Lists, list items, notes, images (currently
  as links you provide, not uploads), and tags, including any lists you add from your
  device or a file.
- **Basic technical data.** Standard server logs (e.g. request timestamps, error info)
  used only to operate and debug the service, and a login timestamp on your account.
- **A session cookie.** Used only to keep you signed in. It is not used for advertising
  or tracking, and it isn't shared with third parties.

## What we don't collect (today)

Beyond what's listed above, we don't collect your phone number, precise location,
payment information, or advertising/tracking data.

**This may change as the app grows.** For example, we might later use your email (or
add a phone number) for optional features like notifications. Any such change would be
opt-in and this policy would be updated first.

## How we use it

Only to run the app: to know who you are when you sign back in, to show your name and
avatar next to your lists, and to associate your content with your account. We do not
sell or share your data with third parties, and we don't use it for advertising.

## Who can see your data

**Lists saved to your account are not private from us.** Fav Fifty is run by one person,
who has access to the database and may read stored content, including lists that aren't
published, when it's needed to debug a problem or investigate an account (for example, a
report of abuse). Access through the app's admin tools (being built) is logged. Lists
kept only on your device never reach us, so we can't see those.

What we will **never** do with your data: sell it, share it with advertisers, use it for
anything other than running Fav Fifty, or publish content you haven't chosen to publish.

## Where it's stored

Lists saved to your account, their items and tags, your account identifier, display
name, avatar, and email address are stored in a database we operate on AWS, in the
United States. Your email address also lives in AWS Cognito (our authentication
provider). Authentication itself is handled by Google and AWS Cognito; we never see or
store your Google password. Lists you haven't added to an account stay in your browser.

## Your choices

- You can use Fav Fifty without an account at all.
- You can delete on-device lists in the app, or all at once by clearing your browser's
  data for the site.
- You can ask us to delete your account and associated content at any time by
  contacting us (below). Deleting your account removes your lists, items, and tags.

## Children

Fav Fifty is not directed at, and is not knowingly used by, children under 13.

## Security

We take reasonable steps to protect your data (e.g. encrypted connections, hashed/signed
session cookies), but as with any online service, we can't guarantee absolute security.
Anyone with access to your device and browser can see lists saved on it.

## Changes to this policy

If this policy changes in a meaningful way, we'll update the date above and, where
practical, note what changed.

- **2026-11-18:** usage statistics (Cloudflare Web Analytics and app events), and
  per-IP request counts kept 7 days for abuse protection.
- **2026-11-14:** using the app without an account, lists saved on your device, and
  adding them to an account.
- **2026-10-13:** the operator's access to stored content.

## Contact

Questions about this policy or a data deletion request: **[owner contact email — fill in
before publishing]**.
