# GrowUP Phase 1 authorization and product decisions

Status: **approved planning checkpoint, with the product owner's amendments**. The current implementation scope is email/password Auth and private profiles only. Community policies guide future work; no communities, roles, memberships, payments, OAuth, or location features are authorized in this slice. Remaining detailed decisions are listed at the end.

## Visibility and joining

Visibility controls discovery and nonmember previews; joining controls admission. Neither grants access to private content. **The creator must explicitly select public, unlisted, or private; never silently assign a visibility.** Community content remains member-gated by default, including publicly discoverable communities.

| Visibility | Approved discovery behavior | Admission planning |
| --- | --- | --- |
| Public | Discoverable through GrowUP home/search/discovery; content remains member-gated by default. | Open, approval-required, invitation-only; paid later. |
| Unlisted | Accessible by direct link; excluded from normal discovery. A link is not permission to read member content. | Same conceptual modes; confirm allowed combinations before implementation. |
| Private | Not publicly discoverable. Nonmember and invitation-preview fields must be explicitly limited. | Confirm supported combinations before community implementation; no implicit joining default. |

| Join mode | Proposed access rule |
| --- | --- |
| Instant | Verified, eligible user explicitly joins; active membership is created once. |
| Request approval | User submits one pending request; owner/admin approves or rejects. Pending/rejected requests grant no member access. |
| Invitation-only | Owner/admin issues an expiring, revocable, single-use invitation bound to the recipient's verified email. Acceptance is explicit; invitations grant member status only. |
| Paid access, later | Defer to Phase 5. Payment entitlement is an additional gate; payment must not bypass bans or required approval. Do not collect payments or create fake subscriptions in Phase 1. |

Proposed lifecycle: pending/invited users have no membership privileges; active users have role-scoped access; leaving revokes it; banned users cannot rejoin through another mode or invitation. Rejoining after voluntary departure follows the current admission policy. All admissions recheck current community rules atomically. Visibility changes must not expose existing content, profiles, or rosters automatically; previously public information cannot be recalled.

## Role permissions

Plan one effective community role per active membership, with exactly one owner per community and multiple admins/moderators allowed. Platform admin is a separate platform assignment, never inherited from a community role. Feature permissions below apply only when that feature is later implemented.

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

Resolve these before the affected future implementation; they do not block email/password Auth and private profiles:

1. Visibility/admission combinations, nonmember preview fields, invitation expiry, and rejected-request reapplication rules.
2. Operational staff access to reported content, support recovery, and community-owner/admin MFA policy. Platform administrators will require MFA.
3. Community closure, retention, and unavailable-owner recovery procedures.
4. Exact globally public versus broader community-visible profile fields. Sensitive account data stays private; public exposure is conservative and future location is separate and opt-in.
5. When to add Google sign-in and its provider/account-linking configuration.

Implement only Supabase email/password signup, verification, sign-in/out, password recovery, persistent secure sessions, protected routes, and minimal private profiles. Include environment separation, a profile migration with grants/RLS, and allow/deny tests. Keep account data separate from future public/community profile data without creating those future features. Community admission/roles follow separately. Do not add Google OAuth, payments, chat, location, or courses, and do not commit the Auth implementation until requested.
