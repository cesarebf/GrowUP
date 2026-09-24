# GrowUP roadmap

Status: proposed sequence, not a promise of release dates or authorization to implement. Planning and the minimal application scaffold are in place; Phase 1 product features remain unimplemented. Confirm scope and unresolved decisions before each phase; build only the entities needed then.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | The scaffold is committed and pushed; the Phase 1 core decisions are approved. Implement email/password Supabase Auth and private profiles first, with verification/recovery, secure sessions, migrations, and RLS tests. Google is deferred. Communities/admission/roles require a separate approved slice. |
| 2 — Forum / Community experience | Posts, comments, member directory, community settings, and configurable landing behavior for available features. Basic discovery cards/categories/search and an agreed initial recommendation rule. Exit with coherent permissions, safe content/media handling, and basic reporting/moderation. |
| 3 — Courses | Modules, lessons, content/media, completion/progress, and explicit resource entitlements. Establish the minimum tier/access representation needed for courses without Stripe or checkout; resolve assignment rules first. Exit with tested access restrictions and an approved video-delivery approach. |
| 4 — Chat / DMs / Realtime | Community channels, durable messages, private DMs, and authorized realtime/presence. Global discussion only after its audience is agreed. Exit with blocking/reporting, rate limits, participant isolation, and verified permission revocation. |
| 5 — Membership tiers and Stripe | Extend the earlier entitlement model into creator-managed commercial tiers/prices and all three creator arrangements. Resolve Connect/payment decisions first. Exit with sandbox-verified onboarding, billing lifecycles, fee handling, webhook replay/retries, and reconciliation; approve operations before live payments. |
| 6 — Events / Location / Meetups | Community events and opt-in approximate location sharing. Exit with explicit audiences, private venue controls, consent/removal UX, and tested deletion/disclosure boundaries. |
| 7 — Creator tools / Analytics | Prioritize creator administration, customization, and useful metrics from actual needs. Exit with defined metrics, tenant-safe aggregates, and privacy/retention limits. |
| 8 — Platform administration | Dedicated tools for platform support, moderation, billing oversight, and operational workflows. Exit with least-privilege administrative roles and audited access. Earlier phases already include the minimum controls required to operate safely. |
| 9 — Production hardening | Consolidated load/performance/accessibility review, security checks, backup restoration, monitoring/alerts, incident runbooks, and release readiness. Any earlier public or paid release must already satisfy the relevant gates. |
| 10 — Future expansion | Evaluate achievements, points, levels, leaderboards, referrals, notifications, affiliates, richer recommendations, AI, and mobile/PWA from evidence. Require explicit scope before adding features or infrastructure. |

## Recommended exact next task

Commit and push the [approved Phase 1 planning checkpoint](PHASE_1_DECISIONS.md), then implement the authorized Supabase email/password Auth + private profile slice. Validate lint, types, tests, build, secret handling, and RLS isolation. Leave that implementation uncommitted for review. No community, role, membership, payment, OAuth, or location functionality is included.
