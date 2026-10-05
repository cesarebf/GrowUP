# GrowUP roadmap

Status: proposed sequence, not release dates or rollout authorization. Auth, profiles, communities, instant join/leave, settings and requests are committed through `937dbc4` and present in development. Clean base `699775f` plans invitations; reviewed Pass 1 backend and Pass 2 UI are implemented locally. Final integrated review and hosted migration/validation remain pending. Invitation infrastructure/domain dependency: NONE. Confirm later phase scope separately.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | Auth/profiles/community/settings/requests committed. Reviewed invitation Pass 1 backend and Pass 2 UI local; final integrated review pending. Hosted migration/API/browser and provider-log gates require later authorization. Role management, transfers, Google and recovery completion remain deferred. |
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

Perform final integrated review of local [invitation Pass 1 + Pass 2](COMMUNITY_INVITATIONS.md), preserving the independently reviewed backend and assessing manager/recipient UI, Auth return, privacy and local validation. Under later explicit authorization, apply only `20260930175249_community_invitations.sql`, compare hosted types/security and validate real Auth/PostgREST plus provider token logging with synthetic fixtures. Current tracking contains only requests; do not repair tracking or replay older migrations. Pass 2 supplies manager/recipient UI and production-build browser checks using a loopback fixture API; this does not replace real hosted acceptance. Paid infrastructure/domain remains unnecessary. Commit/push/deploy only when requested.
