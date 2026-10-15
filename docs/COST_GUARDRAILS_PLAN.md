# Cost Guardrails — "Go Down Before a Big Bill"

Planning doc. Fav Fifty will **never make money** (owner, QUESTIONS.md Q15: no ads, no
charges, open source forever), so a surprise $1,000 month would be catastrophic.
**Owner rule: if cost-driving traffic goes wild, the site degrades and then goes
offline rather than running up the bill, and it comes back only when the owner
revives it.** Numbers decided in Q21/Q22 (2026-10-13). Nothing is built yet. Related:
[DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md),
[ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md),
[ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md).

## The honest starting point

- **A Paid AWS account has no "stop billing at $X" setting.** Budgets notify; billing
  data **lags by hours, up to about a day**.
- So the guardrail has three layers:
  1. **Cap by construction:** every service's worst case is bounded.
  2. **Fast usage tripwires:** CloudWatch alarms that fire in minutes and drive an
     automatic **breaker**.
  3. **A dollar backstop:** Budgets + Cost Anomaly Detection feeding the same breaker.
- The decided topology (one fixed-price Lightsail box, CloudFront flat-rate plans,
  Lambda only for stateless routes) makes layer 1 unusually strong. **Almost the
  whole bill is fixed.**

## Account timeline (Q22)

- The owner is ~4 months into AWS's credit-based **Free account plan** (started around
  June 2026). While on it, **the account cannot be billed at all**, but it ends after
  6 months or when credits run out (around **December 2026**). The account must then
  upgrade to **Paid** or it closes (resources are kept 90 days).
- **The CloudFront flat-rate plans require a Paid account.** So the plan is:
  1. **Before upgrading:** set up Budgets, Cost Anomaly Detection, and the
     notification channels below. That way protection exists the moment billing can
     happen.
  2. **Upgrade to Paid** as part of the first deploy, ahead of the Free plan's expiry.
     It's one-way, and remaining credits carry over to future bills.
  3. **Immediately subscribe both distributions to the flat-rate Free plan** ($0,
     no overages).

## Layer 1 — Cap by construction

| Cost source | Bound | Worst case if everything else fails |
| --- | --- | --- |
| **CloudFront ×2** (data out, requests, WAF, DNS) | **Flat-rate Free plan: no overage charges, ever.** Past the 1M request / 100 GB allowance, AWS may slow delivery instead of billing. Blocked WAF requests don't count. | **$0** |
| **Lightsail instance** (FastAPI + Postgres) | Fixed price. ~3 TB of transfer included; traffic only reaches it through CloudFront + WAF. Stopped instances are still billed, so the breaker cuts *traffic*, not the box. | **~$12** (+ transfer overage only past ~3 TB, practically unreachable behind the WAF) |
| **Lambda** (catalog, showcase) | **Reserved concurrency ~3** (Q16), 256–512 MB, short timeouts | 3 × 0.5 GB × a full month ≈ **$60** (*if pinned 24/7*; the breaker trips long before) |
| **Logs** | Kept **on the box** with rotation, so no CloudWatch Logs ingestion. CDN/WAF log ingestion is covered by the flat-rate plan. | $0 |
| **Cognito** | Google sign-in friction; sign-up spike alarm; breaker turns new sign-ups off; keep the pool on the cheaper **Lite** tier if it has what we use | Negligible |
| **External catalog APIs** | Free or free-key only. **Never attach a billing card to a provider**, so Google Places is excluded (Q14). | $0 |
| **S3** (SPA, backups) | Tiny; covered by the plan's 5 GB S3 credit | ~$0 |
| **Secrets/config** | SSM Parameter Store standard tier (free), not Secrets Manager | $0 |
| **Snapshots** | Lightsail automatic snapshots, bounded by retention | ~$1–2 |

Not in the picture any more (Q20): Aurora capacity and I/O, VPC peering, NAT. A full
Lambda move would bring those back; it's deferred (DEPLOYMENT_TOPOLOGY_PLAN.md
§Future).

## Layer 2 — Usage tripwires and the breaker

### Signals (standard metrics are free; alarms ~$0.10/month each)

| Alarm | Metric | Starting threshold (tune after the first month) |
| --- | --- | --- |
| Edge traffic spike | CloudFront `Requests` (distribution #1 and #2) | > 20× the trailing baseline for 15 min |
| Catalog compute | Lambda `Throttles` / `ConcurrentExecutions` at the cap | Sustained throttling for 10 min |
| Box under strain | Lightsail `CPUUtilization` / burst capacity exhausted | Burst capacity at 0 for 30 min |
| Disk filling | Box disk usage (a small cron check publishing a metric) | > 80% |
| Sign-up spike | App metric: new users per hour | > 50/hour |
| Down | Route 53 health check on `/api/v1/health` | 3 failures in a row (alert only) |

### Levels (Q21)

Alarms and budgets publish to one SNS topic. A standalone **breaker Lambda**
subscribes to it. The breaker sits outside the app, has no database access, and has
a least-privilege IAM role.

| Level | Triggered by | What happens |
| --- | --- | --- |
| **0 — Notify** | Budget **$25** (actual or forecast), any single alarm | Notifications only (see below) |
| **1 — Degrade** | Budget **$50**, or tripwires firing | Runtime-settings switches flip off: catalog, showcase, analytics events, list import, new sign-ups. WAF rate rules tighten. Existing lists keep working. |
| **2 — Maintenance** | Budget **$100**, or tripwires still firing 30 min after Level 1 | CloudFront API behaviors return a friendly "Fav Fifty is taking a breather" 503 (CloudFront Function, included in the plan). Lambda reserved concurrency → 0. The image distribution serves a placeholder. The box keeps running (fixed cost) but no traffic reaches it. The SPA shell still loads, and **anonymous on-device lists keep working**. |

- **Recovery is manual at every level** (owner, Q21: "it should require a manual
  revive"). Reset from the admin portal's Settings page, or with a
  `tools/breaker.sh reset` script (offer to add it when built). Nothing auto-recovers.
- The breaker is **idempotent** and records each trip (time, trigger, level) in SSM
  parameter history and the notification itself.

### Notifications (Q21: "any notification I can get … repeat emails, maybe even a text")

- **Email** via SNS. Free at this volume.
- **Repeat while tripped:** CloudWatch only notifies on a state *change*, so while
  `breaker_level ≥ 1` a scheduled rule (EventBridge, every 30–60 min) re-sends a
  reminder until the owner resets it. Effectively $0.
- **Phone push, free:**
  - The **AWS Console Mobile App** via **AWS User Notifications** (no extra charge).
  - A **Discord webhook**: the breaker posts to a private Discord channel and
    @-mentions the owner, and Discord's mobile app pushes it. Fits where the
    community already lives. The webhook URL goes in SSM, never in git.
- **SMS (text message): not free.** US SMS through SNS needs a registered toll-free
  originating number (about $2/month plus registration) plus per-message fees.
  **Flagged; not planned.** The push options above do the same job for $0.

### Game day (launch blocks on this)

1. Force an alarm into ALARM state (`aws cloudwatch set-alarm-state`).
2. Verify Level 1: the switches flip, the UI degrades gracefully (catalog shows "lookup
   is resting", lists still work), and the notifications arrive (email, push, Discord).
3. Escalate and verify Level 2: the maintenance response comes up, Lambda is
   throttled, and the images placeholder shows.
4. Verify reminders repeat until reset.
5. Reset and verify full recovery.

Re-run it after any topology change.

## Layer 3 — Dollar backstop

- **AWS Budgets** (monthly, actual + forecast) at **$25 / $50 / $100**, all
  notifying into the breaker's SNS topic (Q21).
- **AWS Cost Anomaly Detection** (free): daily anomaly alerts per service.
- **Free-tier usage alerts** on (Billing preferences).
- Billing data lags, so this is the backstop; the usage tripwires are primary.

## Visibility

- The admin dashboard shows month-to-date cost, the forecast, and breaker state.
  Cost comes from a **once-a-day** Cost Explorer snapshot (the API charges $0.01 per
  request) taken by a scheduled job that writes the result to SSM or S3. Never call it
  on page load.

## Residual risk (stated plainly)

- Billing lag: usage tripwires close most of the gap, not all of it.
- Self-inflicted misconfiguration (e.g. Terraform creating something big).
  Mitigations: reviewed `terraform plan` diffs, the budgets, the anomaly alerts.
- Account or credential compromise. Mitigations: root MFA (done); the box's IAM key
  scoped narrowly and rotated; GitHub OIDC (not keys) when CI deploys; the budgets.

## Build order

1. **Now, still on the Free account plan:** Budgets ($25/$50/$100), anomaly detection,
   the SNS topic, email + mobile-app push + the Discord webhook.
2. **Runtime settings** in SSM plus the app reading them (ADMIN_AND_ANALYTICS_PLAN.md).
   The breaker's Level 1 needs them.
3. **First deploy:** upgrade to Paid, flat-rate plans, WAF, Lambda reserved
   concurrency, box log rotation.
4. **Breaker Lambda + alarms + repeat reminders**, then **game day**, before
   announcing on Discord.
5. The admin dashboard cost/breaker panel, and `docs/RUNBOOK.md` ("the breaker
   tripped", "reset", "block an IP", "restore from backup").
