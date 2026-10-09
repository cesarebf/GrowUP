# GrowUP product

Status: checkpoint `0a5a0cf` includes completed invitations. The current accepted slice is [Community Role Management Pass 1](COMMUNITY_ROLE_MANAGEMENT.md): backend/services/tests implemented locally, independent backend/security review passed and local backend validation complete with 1,221 tests passed, including 125 real PostgreSQL concurrency cases. Hosted rollout, hosted Auth/PostgREST acceptance, final management UI and browser acceptance are not done; the feature and Phase 1 remain incomplete. General recovery completion remains deferred. “Confirmed” means required by the product vision, not necessarily part of the first release.

## Vision

GrowUP (“Group + Grow”) is an accessible, affordable, feature-rich community platform for creators and members. It combines education, discussion, chat, and memberships with its own branding, UX, architecture, and implementation. Skool and Discord are functional references, not designs or code to copy.

## Confirmed requirements

- Multi-tenancy from the beginning: users can create communities and join multiple communities while community data remains isolated.
- Communities can eventually contain a forum, courses, channel-based chat, member directory, events, membership tiers, and files/media.
- Owners configure their community's default landing experience, including Forum, Courses, or Chat. It is not a universal hardcoded homepage.
- Global discovery uses communities as the primary cards, with search, categories, covers/thumbnails, creator identity, relevant community information, and recommendations. YouTube is a conceptual discovery reference only.
- Users can participate in community chat and global realtime discussion, and send user-to-user DMs. Audience and access rules for global discussion remain unresolved.
- Courses support modules, lessons, video, text, files, completion/progress, and access controlled by membership benefits.
- Owners can offer multiple membership tiers with different content, courses, channels, status, badges, and future benefits. Prices can support weekly, monthly, semiannual, and yearly billing; a community must not be limited to one price.
- Three creator arrangements are required: paid membership plus a monthly creator subscription and 0% platform transaction fee; paid membership plus configurable revenue share without a required monthly creator subscription; free membership plus a monthly creator subscription. Payment-processing fees remain separate. See [PAYMENTS](PAYMENTS.md).
- Member location sharing is voluntary, removable, and approximate by default, to support local meetups. Precise/private locations must not leak through public surfaces.
- Security, correct authorization, privacy, maintainability, and simplicity govern implementation. Use the selected stack in [ARCHITECTURE](ARCHITECTURE.md).
- Creators explicitly select public, unlisted, or private visibility; no implicit visibility default. Public communities appear in GrowUP discovery, unlisted communities are accessed by link, and private communities are not publicly discoverable. Content stays member-gated by default.
- Instant admission permits only public/unlisted + instant for currently eligible accounts. Private + instant stays valid configuration but cannot admit users. Voluntary leave deletes current membership for members/moderators/admins, independent of admission policy; owners cannot leave. Eligible rejoining follows current rules and always starts as `member`.
- Only the current eligible owner may edit community name, short description, visibility, and join policy in the settings slice. Slug editing remains deferred. Changing visibility/admission policy does not remove existing members; private + instant remains storable but denies new instant joins.
- Approval requests accept eligible nonmembers only for public/unlisted + approval_required. Attempts use an explicitly shared name; owner/admin approval creates only member. Terminal attempts preserve history and permit explicit reapplication. Incompatible settings cancel pending requests; private communities deny unsolicited requests.
- Invitations are community-owned, revocable single-use capabilities, not email-bound, with exactly 168 elapsed hours of validity. Current owner/admin manages them; eligible authenticated holders explicitly accept as member across every stored visibility/join policy. Existing memberships stay exact and leave the invite unused. Successful new admission consumes it and cancels pending own requests atomically. Policy changes and creator demotion do not revoke grants. Backend and UI are local; final integrated review and hosted validation remain pending.
- Users may own multiple communities; each community has exactly one owner and can have multiple admins/moderators. Transfers require acceptance; the previous owner becomes admin unless explicitly removed.
- The current Auth slice uses email/password, verified email, recovery, persistent secure sessions, logout, and private profiles. Google OAuth is deferred; platform administrators will eventually require MFA.

## Future ideas, not current implementation scope

Achievements, points, levels, leaderboards, referrals, creator/platform analytics, richer moderation and notifications, recommendations for members, creator customization, AI, affiliates, and mobile/PWA support. These are candidates for later work, not promises of specific behavior. Basic abuse handling must accompany any released social feature.

## Unresolved product decisions

The [approved Phase 1 decision matrix](PHASE_1_DECISIONS.md) records the accepted policies and remaining details. Sensitive account data is private; future community-facing profiles may expose more than globally public profiles, and location consent remains separate.

- Initial audience, launch countries/languages/currencies, measurable affordability goals, and the exact first-release scope.
- Future public preview extensions and discoverable directory/profile fields. Invitation/limited-capability-preview rules and approval-request rules are resolved in their accepted contracts.
- Operational moderation/support procedures, unavailable-owner recovery, community closure, and community-staff MFA.
- Creator billing per community versus per creator/account; plan limits, prices, rates, trials, and changes between arrangements.
- Whether members can hold multiple tiers, whether higher tiers inherit benefits, and upgrade/downgrade, cancellation, refund, and delinquency rules.
- Discovery ranking/eligibility, DM contact permissions, global chat audience, moderation responsibility, age policy, and retention/deletion rules.
- Location visibility audience, precision choices, and rules for revealing private meetup addresses.

Resolve decisions before implementing the affected behavior. See [ROADMAP](ROADMAP.md) for sequencing; product implementation requires an approved task scope.
