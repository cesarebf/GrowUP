# GrowUP product

Status: planning foundation and minimal application scaffold; no product features are implemented. “Confirmed” means required by the product vision, not necessarily part of the first release. Architecture and entity designs in the other documents are proposals unless explicitly identified as requirements.

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

## Future ideas, not current implementation scope

Achievements, points, levels, leaderboards, referrals, creator/platform analytics, richer moderation and notifications, recommendations for members, creator customization, AI, affiliates, and mobile/PWA support. These are candidates for later work, not promises of specific behavior. Basic abuse handling must accompany any released social feature.

## Unresolved product decisions

- Initial audience, launch countries/languages/currencies, measurable affordability goals, and the exact first-release scope.
- Community visibility (public/unlisted/private), join/invite/approval rules, public previews, and which directory/profile fields are discoverable.
- Initial roles and powers, ownership transfer, and whether creators can administer communities as a team.
- Creator billing per community versus per creator/account; plan limits, prices, rates, trials, and changes between arrangements.
- Whether members can hold multiple tiers, whether higher tiers inherit benefits, and upgrade/downgrade, cancellation, refund, and delinquency rules.
- Discovery ranking/eligibility, DM contact permissions, global chat audience, moderation responsibility, age policy, and retention/deletion rules.
- Location visibility audience, precision choices, and rules for revealing private meetup addresses.

Resolve decisions before implementing the affected behavior. See [ROADMAP](ROADMAP.md) for sequencing; product implementation requires an approved task scope.
