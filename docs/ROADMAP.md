# GrowUP roadmap

Status: proposed sequence, not a promise of release dates or authorization to implement. Auth/private profiles, community foundation, instant join/leave, and owner settings are committed through `4516d35`, with their schema effects present in hosted development. Approval-request backend and Pass 2 UI are implemented locally; final review and hosted migration rollout remain pending. Password recovery completion awaits custom SMTP/domain infrastructure. Confirm scope before each further phase.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | Auth/private profiles, community foundation, instant join/leave and owner settings form the committed checkpoint. Approval-request backend and UI are local and await final review, then separately authorized targeted rollout/API/browser validation. Invitations, role management, transfers and Google require later approved slices. Recovery completion remains deferred. |
| 2 — Forum / Community experience | Posts, comments, member directory, further community settings, and configurable landing behavior for available features. Basic discovery cards/categories/search and an agreed initial recommendation rule. Exit with coherent permissions, safe content/media handling, and basic reporting/moderation. |
| 3 — Courses | Modules, lessons, content/media, completion/progress, and explicit resource entitlements. Establish the minimum tier/access representation needed for courses without Stripe or checkout; resolve assignment rules first. Exit with tested access restrictions and an approved video-delivery approach. |
| 4 — Chat / DMs / Realtime | Community channels, durable messages, private DMs, and authorized realtime/presence. Global discussion only after its audience is agreed. Exit with blocking/reporting, rate limits, participant isolation, and verified permission revocation. |
| 5 — Membership tiers and Stripe | Extend the earlier entitlement model into creator-managed commercial tiers/prices and all three creator arrangements. Resolve Connect/payment decisions first. Exit with sandbox-verified onboarding, billing lifecycles, fee handling, webhook replay/retries, and reconciliation; approve operations before live payments. |
| 6 — Events / Location / Meetups | Community events and opt-in approximate location sharing. Exit with explicit audiences, private venue controls, consent/removal UX, and tested deletion/disclosure boundaries. |
| 7 — Creator tools / Analytics | Prioritize creator administration, customization, and useful metrics from actual needs. Exit with defined metrics, tenant-safe aggregates, and privacy/retention limits. |
| 8 — Platform administration | Dedicated tools for platform support, moderation, billing oversight, and operational workflows. Exit with least-privilege administrative roles and audited access. Earlier phases already include the minimum controls required to operate safely. |
| 9 — Production hardening | Consolidated load/performance/accessibility review, security checks, backup restoration, monitoring/alerts, incident runbooks, and release readiness. Any earlier public or paid release must already satisfy the relevant gates. |
| 10 — Future expansion | Evaluate achievements, points, levels, leaderboards, referrals, notifications, affiliates, richer recommendations, AI, and mobile/PWA from evidence. Require explicit scope before adding features or infrastructure. |

## Recommended exact next task

Review the complete uncommitted [approval-request backend and Pass 2 UI](COMMUNITY_MEMBERSHIP_REQUESTS.md), including local SQL, concurrency, Server Action and presentation tests. Before using the controls against hosted development, separately authorize targeted application of only `20260929140004_community_membership_requests.sql`, regenerate/compare types, and validate real Auth/PostgREST/browser behavior. Historical migration effects already exist despite empty tracking: do not replay them or use a whole-repository migration push. History reconciliation needs its own verified, authorized baseline operation. Commit/push only when requested.
