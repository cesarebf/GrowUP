# GrowUP Phase 1 authorization and product decisions

Status: **approved decisions, with the product owner's amendments**. Auth/private profiles, the [community foundation](COMMUNITY_FOUNDATION.md), instant join/leave, and owner settings are committed through `4516d35`; their schema effects are present in hosted development. [Approval requests](COMMUNITY_MEMBERSHIP_REQUESTS.md) include the reviewed local backend and Pass 2 requester/reviewer UI. Final review and hosted rollout remain pending. Recovery completion awaits custom SMTP/domain infrastructure. Invitations and role-management workflows remain deferred.

## Visibility and joining

Visibility controls discovery and nonmember previews; joining controls admission. Neither grants access to private content. **The creator must explicitly select public, unlisted, or private; never silently assign a visibility.** Community content remains member-gated by default, including publicly discoverable communities.

| Visibility | Approved discovery behavior | Admission planning |
| --- | --- | --- |
| Public | Discoverable through future GrowUP home/search/discovery; content remains member-gated by default. | Instant implemented; approval-required implementation local only; invitation-only and paid deferred. |
| Unlisted | Accessible by direct link; excluded from normal discovery. A link is not permission to read member content. | Instant implemented; approval-required implementation local only; invitation-only deferred. |
| Private | Not publicly discoverable. Nonmember and invitation-preview fields must be explicitly limited. | Both unsolicited instant admission and approval requests are denied, regardless of stored policy. Invitations deferred. |

| Join mode | Proposed access rule |
| --- | --- |
| Instant (approved) | Verified, eligible user explicitly joins only public/unlisted communities with `join_policy = instant`; current membership is created once, as `member`. Private + instant remains valid stored configuration but cannot admit users. |
| Request approval (approved; local only) | Eligible nonmember explicitly submits to public/unlisted + approval_required with a shared attempt-specific name. Owner/admin approves or rejects; moderator cannot review. Requests grant no access. Approval atomically creates only member. |
| Invitation-only | Owner/admin issues an expiring, revocable, single-use invitation bound to the recipient's verified email. Acceptance is explicit; invitations grant member status only. |
| Paid access, later | Defer to Phase 5. Payment entitlement is an additional gate; payment must not bypass bans or required approval. Do not collect payments or create fake subscriptions in Phase 1. |

Approved current lifecycle: a `community_memberships` row represents current membership, with no status column. Voluntary leave deletes the row and revokes membership-derived access, regardless of current admission policy; already-absent leave is idempotent. Members, moderators, and admins may leave. Owners cannot leave until a future accepted transfer or approved closure workflow resolves ownership. Eligible former members may immediately rejoin when current rules permit instant admission, always as `member`; former staff roles are never restored. Already-current members retain their role on an idempotent join.

All new admissions atomically recheck current account eligibility and community visibility/join policy. Requests are separate attempts, never membership status values. Repeated pending submission returns the same ID/name/time; terminal rejected/withdrawn/cancelled attempts require explicit reapplication into a new row. Old approvals never re-enroll departed members. Settings that close eligibility cancel pending requests as policy_changed, without changing current memberships. Restoring eligibility never reopens old attempts. An already-member review cancels the request and preserves the current role. No cooldown is introduced. Bans/restrictions, invitations, billing/entitlements, and moderation remain deferred systems. Membership grants no paid/resource entitlement.

The requester explicitly enters a name for each attempt. The UI shows: “This name will be shared with this community's owner and admins to review your request.” It is a self-chosen label, not verified identity, and must be rendered as escaped plain text. Never copy private profile or provider names automatically; emails and private profiles stay private. The queue omits Auth IDs and reviewer identity; own receipts omit private-community metadata when the requester is a nonmember.

## Role permissions

Plan one effective community role per active membership, with exactly one owner per community and multiple admins/moderators allowed. Platform admin is a separate platform assignment, never inherited from a community role. Feature permissions below apply only when that feature is later implemented.

Current settings exception to the future role matrix: only the eligible current owner may edit name, short description, visibility, and join policy. Admins and moderators have no settings permission in this slice. Slug editing is deferred. Policy changes preserve existing memberships; private + instant is valid stored configuration but cannot admit new members.

| Role | Allowed within its scope | Important limits |
| --- | --- | --- |
| Member | Read permitted community content/directory; participate; manage own profile/content subject to moderation; report abuse; leave. | No admission, moderation, settings, or role management. |
| Moderator | Member permissions; review reports, moderate content, and suspend/ban ordinary members. | Cannot approve joins, issue invitations, change settings/roles, or sanction moderators/admins/owner. |
| Admin | Moderator permissions; approve requests, invite members, manage routine settings/content organization, appoint/remove moderators, and sanction moderators/members. | Cannot appoint/remove admins, change visibility/join policy, transfer ownership, archive/delete the community, or control creator billing. |
| Owner | Admin permissions; appoint/remove admins; change visibility/join policy; transfer ownership; authorize archive/deletion; control creator billing when introduced. | Cannot leave/delete their account while retaining ownership; cannot read private account fields or DMs by virtue of ownership. |
| Platform admin | Audited platform support, abuse investigation, and account/community suspension through explicit operational permissions. | No automatic community membership, routine DM access, private-location access, or unrestricted content browsing. No self-service assignment of platform privilege. |

Community-role actions require an active account/membership and applicable resource entitlements. Platform operations use separate explicit grants and do not require community membership. Staff inspection of reported restricted content requires a narrow, audited moderation permission; it is not general free access to paid courses/channels. Platform suspension overrides community grants. Community staff sanctions must target lower roles; owner unavailability or misconduct escalates to a defined platform process, not automatic promotion of an admin. No role can grant its own elevation.

## Ownership

| Decision | Recommendation |
| --- | --- |
| Multiple communities per user | Allow conceptually; do not assume one owner can own only one community. Future configurable plan/abuse limits remain separate. |
| Multiple admins/moderators | Allow multiple of each, subject to the role-management boundaries above. |
| Multiple owners | One owner in Phase 1; use admins for delegation. Defer co-ownership. |
| Transfer | Current owner reauthenticates and nominates an active, verified member; recipient must accept. Atomically replace the owner; previous owner becomes admin unless explicitly removed. Audit/notify both. |
| Owner departure/deletion | Require accepted transfer or an approved community closure process. Involuntary account closure and inaccessible-owner recovery need a reviewed support policy. Never orphan a community silently. |

Ownership transfer must not implicitly transfer a legal billing identity or Connect account when payments arrive. Closure, retention, and financial obligations must be settled before implementing destructive deletion.

## Profile privacy

| Audience | Proposed fields and defaults |
| --- | --- |
| Public | Only deliberately published display name/handle, optional avatar, bio, and links. Public profile/discoverability off by default. Publishing a public/unlisted community requires acknowledgement of the creator identity shown on its landing page. |
| Shared community members | Chosen display name/handle, optional avatar, community role, and optional bio. Directory visible only to active members; do not expose other community memberships. |
| Account owner only | Email, auth/provider details, preferences, private membership list, and personal billing/account data through appropriate account screens. Community staff cannot see login email; invitation managers can see addresses they explicitly invited, with restricted retention. |
| Restricted system data | Credentials/tokens never exposed through profile or support screens. Internal security records require restricted operational access, a purpose, and an audit trail. |

Do not collect real name, date of birth, phone, or location for the initial profile without an approved need. Community participation exposes the selected display identity to that community, not automatically to the public. No location fields or sharing UI in Phase 1; later location consent remains separate. Avoid silently publishing Google-provided names/photos.

## Authentication

| Area | Recommendation |
| --- | --- |
| Sign-in | Implement email/password only, including secure persistent sessions and logout. Google and all other OAuth providers are deferred. |
| Verification | Require verified email for authenticated application/profile access. Unverified users can complete email verification/recovery and view public pages. |
| Recovery | Provider-managed expiring password-reset flow with generic responses, rate limits, and allowlisted redirects. No community-admin password resets. |
| Future providers | Link profiles to stable Supabase Auth user IDs, not emails or a password-specific identity. Keep Google compatible but add no OAuth/linking UI now. Never implement custom account merging based on submitted email strings. |
| Sensitive actions | Reauthenticate for ownership transfer and sensitive account changes; require MFA for platform administrators before privileged operational access. Community-owner/admin MFA policy needs approval. |

Confirm provider setup and production email delivery before release. Technical references: Supabase [password/verification/recovery](https://supabase.com/docs/guides/auth/passwords), [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), and [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking). These establish available mechanisms, not approval of GrowUP's proposed policies.

## Remaining decisions and authorized implementation slice

Resolve these before the affected future implementation; they do not block the implemented Auth or community foundation:

1. Invitation rules, expiry and future preview extensions. Approval combinations, explicit shared-name privacy, cancellation, and reapplication are resolved in the request contract. All nine configurations remain storable; private nonmembers receive no community metadata.
2. Operational staff access to reported content, support recovery, and community-owner/admin MFA policy. Platform administrators will require MFA.
3. Community closure, retention, and unavailable-owner recovery procedures.
4. Exact globally public versus broader community-visible profile fields. Sensitive account data stays private; public exposure is conservative and future location is separate and opt-in.
5. When to add Google sign-in and its provider/account-linking configuration.

The current authorized slice includes approval-request Pass 2: requester/name-sharing/withdrawal controls, bounded own history, owner/admin review, accurate creation/settings help, and focused Server Action/UI tests. The independently reviewed Pass 1 database state machine and services remain unchanged. Preserve Auth and private profiles. Invitations, bans/restrictions systems, role management, ownership transfer, deletion workflows, discovery, OAuth, payments and content remain outside scope. Leave the implementation uncommitted and unpushed; do not mutate hosted Supabase, apply the new migration, or replay/repair historical migrations.
