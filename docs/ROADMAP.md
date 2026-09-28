# GrowUP roadmap

Status: proposed sequence, not a promise of release dates or authorization to implement. Core Auth/private profiles, the community foundation, and instant join/voluntary leave are committed and hosted-validated; password-recovery completion awaits custom SMTP/domain infrastructure. Owner community settings are implemented locally and await review and hosted validation. Confirm scope and unresolved decisions before each further phase.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | Core Auth/private profiles, community creation/viewing/ownership, and instant join/voluntary leave are hosted-validated; recovery completion is deferred. Owner settings for name/description/visibility/join policy are implemented locally with migration/security tests and await review/hosted validation. Approval requests, invitations, role management, transfers, and Google require later approved slices. |
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

Review the uncommitted owner community settings slice. With separate explicit authorization, apply only `20260928000300_community_settings.sql` to development Supabase, regenerate/compare database types, and validate owner save and refreshed landing/list, nonowner form exclusion, direct RPC/REST denials, current ownership/eligibility, immutable slug/ownership, unchanged memberships, public + instant → private + instant admission denial, and independent-session settings/join concurrency as described in [Community foundation](COMMUNITY_FOUNDATION.md). Commit/push only when explicitly requested. Add no new product features during validation.
