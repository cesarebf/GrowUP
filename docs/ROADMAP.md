# GrowUP roadmap

Status: proposed sequence, not release dates or rollout authorization. Checkpoint `0a5a0cf` includes completed invitations. [Role-management Pass 1](COMMUNITY_ROLE_MANAGEMENT.md) is implemented locally; independent backend/security review passed and local backend validation is complete, including all 125 real PostgreSQL concurrency cases. Hosted rollout, browser acceptance and final management UI are not done. Confirm later phase scope separately.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | Auth/profiles/community/settings/requests/invitations are included in the accepted source checkpoint `0a5a0cf`. [Role-management Pass 1](COMMUNITY_ROLE_MANAGEMENT.md) is local; its local backend validation passed (1,221 tests, including 125 real PostgreSQL concurrency cases). Hosted schema/security and Auth/PostgREST acceptance, final management UI and browser acceptance remain pending; Phase 1 is not complete. Transfers, Google and recovery completion remain deferred. |
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

The uncommitted [role-management Pass 1 backend](COMMUNITY_ROLE_MANAGEMENT.md) has completed independent backend/security review and local validation. Obtain separate authorization for commit/push and the next UI or hosted-validation slice. The source checkpoint is `0a5a0cf`; invitations are complete for this task and their semantics remain frozen. The role-management migration has not been applied remotely. Hosted rollout, browser acceptance and final member-management UI remain separate later gates. Commit/push/deploy only when requested.
