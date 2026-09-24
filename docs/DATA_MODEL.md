# GrowUP conceptual data model

Status: high-level proposal, not a migration or a commitment to exact table names. Add entities only in their approved feature phase. Community is the tenant; identity and explicitly global features use separate access rules.

## Entities and relationships

| Area | Major entities and relationships |
| --- | --- |
| Identity | Supabase Auth user has one application profile. Separate public display fields from private account/preferences data. One user can create and join many communities. |
| Communities | Community has exactly one owner, slug, description, cover, explicitly selected visibility (no silent default), and validated default landing feature. Users may own many communities; transfers require acceptance and leave the former owner as admin unless explicitly removed. Categories link many communities for discovery. |
| Membership and roles | Membership links user and community with lifecycle state; one current membership per pair, with history where needed. Community role assignments attach to that membership. Administrative roles are separate from commercial tiers. |
| Tiers and benefits | Community has many membership tiers; tiers have explicit entitlement grants such as access to a course or channel. Tier assignments link memberships to tiers with effective dates/source. Concurrent tiers and inheritance remain unresolved. |
| Prices | Tier has many versioned price options: currency, integer minor-unit amount, interval unit/count, availability, and provider references. Free access does not require a fabricated paid subscription. |
| Forum | Community has posts; posts have comments and authors. Comments and attachments must belong to the same community as their parent. Moderation state accompanies released content. |
| Courses | Community has courses; courses contain ordered modules and lessons. Lessons reference text/video/file content. Member lesson progress/completion links the member and lesson within that community; course progress can be derived. |
| Community chat | Community has channels; channels have messages, authors, attachments, and access rules. Channel entitlement restrictions supplement community membership. |
| DMs and global discussion | Global DM conversations have explicit participants and messages; participant access is independent of community ownership. Keep community channels separate from DMs. Model global discussion only after its audience/permission rules are resolved. |
| Media | Media metadata identifies storage object, uploader, owner scope, visibility, and parent content. Explicit community or conversation ownership permits matching storage authorization. |
| Creator billing | Creator billing account is a payer/payee identity linked to authorized users and covered communities. Exact billing coverage is unresolved. It has creator plan assignments, optional platform subscriptions, and Connect account mappings. |
| Member billing | Member subscription links a membership, tier price, billing account context, provider subscription, and lifecycle/period state. Keep history and tier assignment separate from the membership record. |
| Payment configuration | Creator plans have versioned prices, platform entitlements, and fee policies. Effective plan assignments identify the applicable commercial terms. Provider mappings include account and environment scope. |
| Payment processing | Webhook receipts and processing state support deduplication/retries; payment records reference invoice/charge, applied fee policy, amounts, and reconciliation state. Raw sensitive payload retention must be minimized. |
| Events and location, later | Community events have organizer, schedule, and controlled venue details. Separate member location-sharing records store consent, approximate location, audience, and revocation, potentially per community; do not put location in public profiles by default. |

Reports, moderation actions, and security audit records should be introduced alongside the capabilities they protect. Rich analytics, badges, notifications, and other future entities wait for concrete requirements.

## Invariants for the eventual schema

- Community-owned rows carry a non-null `community_id`. Where scope is duplicated on children, composite foreign keys or equivalent database constraints prove parent and child belong to the same community; filtering in application code is insufficient.
- Globally scoped tables use explicit ownership/participant rules. Avoid one nullable tenant column whose absence implicitly makes a row public.
- Roles do not grant paid benefits by implication, and paid tiers do not grant administrative powers. Any owner/staff content exception must be explicit policy.
- Store entitlements as meaningful capabilities/resource grants, independent of price, Stripe product names, and presentation order. Do not assume that a more expensive tier automatically includes another tier.
- Distinguish community membership state, tier access state, member subscription state, and creator subscription state. Stripe status alone is not the entire access decision.
- Price and fee-policy changes create effective versions; preserve the terms relevant to existing subscriptions and transactions. Use integer money amounts and bounded precise percentages, not floating-point financial calculations.
- Provider IDs are external references, not application primary identities. Scope them by provider account and test/live environment. Protect uniqueness accordingly.
- Add foreign keys, appropriate uniqueness, scoped indexes, timestamps, and explicit deletion/retention behavior with each migration. Audit ownership/role/commercial changes; do not settle all retention questions through automatic cascade deletion.
- RLS/grants must cover all exposed data and operations, including progress, attachments, memberships, and billing projections. Keep server-owned prices, role assignments, and subscription state protected against client mutation.

Billing rules are detailed in [PAYMENTS](PAYMENTS.md); privacy boundaries are in [SECURITY_AND_PRIVACY](SECURITY_AND_PRIVACY.md).
