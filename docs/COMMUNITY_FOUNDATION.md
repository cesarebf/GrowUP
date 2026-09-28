# Phase 1 community foundation

Community creation/viewing and ownership were committed and hosted-validated at `640ae28bd76b9e155ad92f3e6f15ec68065fd3e9`. The subsequent instant-join/voluntary-leave slice is local and uncommitted; its new migration has not been applied to hosted Supabase. Existing Auth/session/private-profile architecture is unchanged. Password-recovery completion remains deferred pending custom SMTP/domain infrastructure.

## Supported behavior

- Verified eligible accounts create multiple communities at `/communities/new` and see their memberships at `/communities`.
- Creation requires an explicit visibility and join policy; neither has a database or form default. All nine combinations remain storable, including private + instant; no existing configuration is rewritten.
- `/c/{slug}` renders a minimal landing page. Public and unlisted direct links expose only ID, name, slug, description, visibility, join policy, and the viewer's own role (or null). No owner identity, private profile, roster, timestamps, or member content is published.
- Private nonmembers receive no metadata and the same unavailable page as a nonexistent slug. This is the conservative implementation for this slice; any future invitation preview needs an explicit field policy.
- Eligible nonmembers can explicitly join public/unlisted + instant communities. Other admission combinations have no working Join control. Private nonmembers retain the unavailable page.
- Current members, moderators, and admins can leave after explicit confirmation, regardless of admission policy. Leave deletes their current membership; repeat leave is safe. Owners see an explanation and no Leave control. Future ownership transfer/closure is required before owner departure.
- Eligible former members can rejoin immediately under current instant-admission rules, always as `member`, never restoring staff roles. Approval requests, invitations, bans/restrictions systems, role management, transfers, settings edits, closure, discovery, and content features are deferred. Billing/entitlements and moderation/audit history remain separate future systems.
- Slugs normalize outer spaces/case; stored slugs use 3–48 lowercase ASCII letters/numbers separated by single hyphens. Reserved names are `new`, `admin`, `api`, `auth`, `account`, `communities`, `settings`, `support`, `help`, `growup`, and `www`. UUIDs are durable identity; slugs can be changed by a future authorized workflow without changing references. No rename/history endpoint exists now.

## Implemented schema

Migration: `supabase/migrations/20260928000100_community_foundation.sql`, applied after the existing private-profile migration.

Join/leave migration: `supabase/migrations/20260928000200_community_join_leave.sql`; adds two RPCs only, without changing existing tables, RLS, grants, constraints, or configurations.

| Table | Columns / constraints |
| --- | --- |
| `communities` | UUID `id` primary key; non-null `owner_user_id` → Auth user; generated constant `owner_role = owner`; name (1–80 characters), unique slug, description (0–500 characters); required `visibility` (`public`, `unlisted`, `private`) and `join_policy` (`instant`, `approval_required`, `invitation_only`); creation/update timestamps. Text is bounded, trimmed, and excludes control characters. |
| `community_memberships` | Composite primary key (`community_id`, `user_id`); community/Auth foreign keys; required role (`member`, `moderator`, `admin`, `owner`); creation/update timestamps. Existence means current membership; there are no speculative pending/status rows. |

The community's deferred composite foreign key (`id`, `owner_user_id`, `owner_role`) requires a matching owner membership. A partial unique index allows at most one owner per community. Together these preserve exactly one matching owner at transaction completion, even for privileged SQL. A unique membership triple supports that FK. Indexes on community owner and membership user/community support ownership checks and private lists. Update triggers maintain timestamps.

Deleting an owner Auth user is restricted by the community FK. A narrow new Auth soft-delete trigger also blocks owner deletion, leaving the existing Auth/profile functions untouched. Creation locks the actor's Auth row to serialize against account deletion. Nonowner hard deletion cascades their memberships; community deletion is not exposed and does not cascade implicitly. Bans disable access without silently removing ownership. Transfer, closure, and unavailable-owner recovery require later reviewed workflows. The deferred FK already supports an atomic transfer, but no transfer API is provided.

## Authorization and creation

Both tables enable and force RLS. Anonymous users have no table privileges. Authenticated users have SELECT only: their own memberships if currently verified, non-anonymous, undeleted and unbanned; communities only through those memberships. Even owners cannot read other users' memberships or mutate tables through the API. There are no client DML grants or write policies.

The Server Action validates identity through the established `getVerifiedUser`, validates form metadata, and uses the ordinary cookie-bound Supabase client. `create_community` takes metadata only, rechecks current account eligibility, derives ownership from `auth.uid()`, and inserts community plus owner membership in one transaction. Unique slugs prevent duplicate effects for repeated submissions with the same slug; an ambiguous network failure tells the user to check their community list before retrying. Success redirects to the normalized `/c/{slug}`.

`get_community_landing` is an exact-slug projection, not a discovery/list RPC. Its explicit visibility/member check is necessary because it is a SECURITY DEFINER function. It never returns another user's role or sensitive identity. Private responses and membership lists are dynamic and use the existing session/no-cache path, without shared application caching. A direct link does not grant future content access.

Definer functions use an empty `search_path` and schema-qualified relations. Public/anonymous/authenticated default execute grants are revoked before granting the intended RPCs (creation/join/leave to authenticated; landing to anonymous/authenticated). Trigger functions have no client execute grant. No service-role client or new dependencies are introduced. This follows the [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions).

## Instant join and voluntary leave

`join_community(p_community_id uuid)` and `leave_community(p_community_id uuid)` derive the actor from `auth.uid()`; neither accepts user or role arguments. Both lock the actor's Auth row, then recheck the existing verified/non-anonymous/undeleted/unbanned eligibility rule. This also serializes the account's join/leave retries. Both then take a shared community-row lock, preventing policy/visibility updates or deletion until commit while allowing different accounts to join concurrently. Leave locks the caller's membership before checking its role. Future privileged mutation workflows must account for this lock order.

Join preserves an already-current member's role and returns the community slug, including after admission has closed. New admissions require public/unlisted + instant and insert only `member`, with the composite primary key and `ON CONFLICT DO NOTHING` preventing duplicates. Missing and inaccessible targets use the same safe error. Only basic membership is created; no entitlement, commercial assignment, or future restricted-resource access is granted.

Leave rejects owners and deletes only the actor's nonowner membership in the requested community. Missing communities and already-absent memberships return the same empty success. It does not check admission policy. Existing owner constraints remain defense in depth. Successful join redirects to the database-returned slug; leave redirects to `/communities`. Both actions invalidate the membership list and landing routes; dynamic reads and unchanged RLS remove membership-derived access after commit. Public/unlisted landing metadata remains available. Separate stale tabs update on their next request; no realtime feature or content cache is introduced.

The UI uses the existing server identity check, and the database repeats authorization atomically. Leave confirmation is required by both the form and Server Action service; direct authenticated RPC callers intentionally invoke the same narrow operation without a UI confirmation parameter. Errors/logs disclose no provider messages, private community metadata, or account content.

## Verification and release boundaries

`tests/community-rls.test.mts` executes all three migrations in PGlite with Supabase-like permissive starting grants and emulated Auth identity. It verifies foundation invariants plus all nine admission combinations, current account eligibility, policy changes before submission, membership uniqueness/retries, role preservation, rejoin-as-member, each nonowner departure, owner rejection, private-access revocation, caller/tenant scoping, indistinguishable inaccessible targets, and RPC privileges. `tests/community.test.mts` covers the server service, forged fields, confirmation, safe redirects/errors, and eligibility. Existing Auth/profile/session tests remain required.

Local SQL tests do not verify hosted PostgREST, Auth administration, browser flows, or independent-session lock races. Concurrent test submissions are queued on PGlite's single backend. Next, review this uncommitted slice; only with separate authorization apply the new migration to development Supabase and validate join → redirect → list, confirmation → leave → access revocation, owner/private denials, two-user isolation, direct REST/RPC permissions, and independent-session duplicate join, join/leave, policy-change, and eligibility-change races. Regenerate/compare database types. Do not reapply or edit previously applied migrations. No hosted migration, commit, or push is authorized in this task.

Before wider exposure, decide and implement creation abuse controls/rate limits and operational handling of abandoned ownership. Unlisted links are guessable and shareable; slug uniqueness necessarily reveals availability, including collisions with private slugs. No public discovery endpoint or member content is introduced in this slice. Schema-wide privileged SQL remains an administrative trust boundary.
