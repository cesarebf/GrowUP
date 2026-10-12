# GrowUP roadmap

Status — 2026-10-11: **Phase 1 COMPLETE** under its approved scope and explicit deferrals. Current source checkpoint: `c29e6ba23f95b22e6eec5b9d03e341111245f061` (`feat: add community role management UI`), committed/pushed to `main`; local HEAD, origin/main and remote GitHub main match. [GitHub Actions run 38144616210](https://github.com/cesarebf/GrowUP/actions/runs/38144616210) is completed/successful. Later phases remain a proposed sequence, not release dates or implementation/rollout authorization.

Security, accessibility, authorization, and relevant tests belong to every phase. Basic moderation and operational controls must exist before exposing the associated features to real users.

| Phase | Intended scope and exit condition |
| --- | --- |
| 1 — Foundation / Auth / Communities | **COMPLETE.** Approved Auth/private profiles, communities, instant join/leave, owner settings, approval requests, invitations and role management are complete. Role-management backend/hosted acceptance, final UI, independent UI/security review and real browser acceptance passed; UI is committed/pushed with green CI. Existing deferrals remain unchanged. |
| 2 — Forum / Community experience | Posts, comments, member directory, further community settings, and configurable landing behavior for available features. Basic discovery cards/categories/search and an agreed initial recommendation rule. Exit with coherent permissions, safe content/media handling, and basic reporting/moderation. |
| 3 — Courses | Modules, lessons, content/media, completion/progress, and explicit resource entitlements. Establish the minimum tier/access representation needed for courses without Stripe or checkout; resolve assignment rules first. Exit with tested access restrictions and an approved video-delivery approach. |
| 4 — Chat / DMs / Realtime | Community channels, durable messages, private DMs, and authorized realtime/presence. Global discussion only after its audience is agreed. Exit with blocking/reporting, rate limits, participant isolation, and verified permission revocation. |
| 5 — Membership tiers and Stripe | Extend the earlier entitlement model into creator-managed commercial tiers/prices and all three creator arrangements. Resolve Connect/payment decisions first. Exit with sandbox-verified onboarding, billing lifecycles, fee handling, webhook replay/retries, and reconciliation; approve operations before live payments. |
| 6 — Events / Location / Meetups | Community events and opt-in approximate location sharing. Exit with explicit audiences, private venue controls, consent/removal UX, and tested deletion/disclosure boundaries. |
| 7 — Creator tools / Analytics | Prioritize creator administration, customization, and useful metrics from actual needs. Exit with defined metrics, tenant-safe aggregates, and privacy/retention limits. |
| 8 — Platform administration | Dedicated tools for platform support, moderation, billing oversight, and operational workflows. Exit with least-privilege administrative roles and audited access. Earlier phases already include the minimum controls required to operate safely. |
| 9 — Production hardening | Consolidated load/performance/accessibility review, security checks, backup restoration, monitoring/alerts, incident runbooks, and release readiness. Any earlier public or paid release must already satisfy the relevant gates. |
| 10 — Future expansion | Evaluate achievements, points, levels, leaderboards, referrals, notifications, affiliates, richer recommendations, AI, and mobile/PWA from evidence. Require explicit scope before adding features or infrastructure. |

## Phase 1 exit review

No non-deferred Phase 1 requirement remains unfinished. Core Auth/private-profile and community slices are committed and accepted; invitation completion includes hosted schema/security, real Auth/PostgREST, browser and accessible provider-token-log inspection, with cleanup/baseline verification. [Role management](COMMUNITY_ROLE_MANAGEMENT.md) is feature-complete. Detailed historical validation records retain their original boundaries; final hosted/browser results are supplied product-owner acceptance evidence, not reruns during this documentation review.

Ownership transfer/co-ownership/closure, Google and other OAuth, broader public profiles/member directory, bans/moderation beyond the approved slice, payments/paid access, general recovery completion and provider-production readiness, production domain/infrastructure, and public-launch operational gates remain deferred. Slug editing and other unresolved future decisions remain unchanged. Phase completion does not mean public-release readiness or authorize deferred implementation. The two accepted role-management UX notes are non-blocking polish debt.

## Recommended exact next task

**Next major phase: Phase 2 — Forum / Community experience.** Prepare a Phase 2 scope-and-decisions document for approval, using only the existing roadmap scope: posts, comments, member directory, further community settings, configurable landing behavior, basic discovery cards/categories/search, an initial recommendation rule, and basic reporting/moderation. Identify unresolved decisions, permissions/privacy boundaries, acceptance criteria and the first proposed implementation slice. Planning must preserve Phase 1 decisions and deferrals; it does not authorize code, SQL/migrations, hosted changes, integrations or deployment. Do not begin Phase 2 implementation in this reconciliation.
