# Phase 1 community foundation

Communities, ownership, instant join/leave, settings and requests are committed through `937dbc4`. Hosted schema effects are present; tracking contains only `20260930000900 / community_membership_requests`. [Invitation Pass 1](COMMUNITY_INVITATIONS.md) is local on clean base `699775f`, with its new migration unapplied; reviewed backend and Pass 2 UI await final integrated review and hosted validation. Auth eligibility stays in place; the narrow invitation-return cookie does not redesign Auth. Invitations require no paid infrastructure/domain.

## Supported behavior

- Verified eligible accounts create multiple communities at `/communities/new` and see their memberships at `/communities`.
- Creation requires an explicit visibility and join policy; neither has a database or form default. All nine combinations remain storable, including private + instant; no existing configuration is rewritten.
- `/c/{slug}` renders a minimal landing page. Public and unlisted direct links expose only ID, name, slug, description, visibility, join policy, and the viewer's own role (or null). No owner identity, private profile, roster, timestamps, or member content is published.
- Private nonmembers receive no metadata through the ordinary slug landing. Active capability preview is the separately approved bounded invitation exception; the landing RPC remains unchanged.
- Eligible nonmembers can explicitly join public/unlisted + instant communities. Other admission combinations have no working Join control. Private nonmembers retain the unavailable page.
- Current members, moderators, and admins can leave after explicit confirmation, regardless of admission policy. Leave deletes their current membership; repeat leave is safe. Owners see an explanation and no Leave control. Future ownership transfer/closure is required before owner departure.
- Eligible former members rejoin under current admission rules as member without restoring staff roles. Requests preserve immutable attempts. Local invitation backend supports explicit admission independently of unsolicited policy; consumed invites never restore departed membership. Invitation management and recipient UI are local; bans, role management, transfers, closure, discovery and content remain deferred. Billing/entitlements stay separate.
- Only the current eligible owner can edit name, short description, visibility, and join policy in the settings section of `/c/{slug}`. Admins and moderators cannot edit settings in this slice. Slug editing remains deferred. Admission-policy/visibility changes retain all existing memberships and roles; private + instant remains storable but does not admit new members.
- Slugs normalize outer spaces/case; stored slugs use 3–48 lowercase ASCII letters/numbers separated by single hyphens. Reserved names are `new`, `admin`, `api`, `auth`, `account`, `communities`, `settings`, `support`, `help`, `growup`, and `www`. UUIDs are durable identity; slugs can be changed by a future authorized workflow without changing references. No rename/history endpoint exists now.

## Implemented schema

Migration: `supabase/migrations/20260928000100_community_foundation.sql`, applied after the existing private-profile migration.

Join/leave migration: `supabase/migrations/20260928000200_community_join_leave.sql`; adds two RPCs only, without changing existing tables, RLS, grants, constraints, or configurations.

Settings migration: `supabase/migrations/20260928000300_community_settings.sql`; adds only the authenticated `update_community_settings` RPC and its restricted execution grant. Existing table grants, RLS, constraints, and admission RPCs remain unchanged.

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

Definer functions use an empty `search_path` and schema-qualified relations. Public/anonymous/authenticated default execute grants are revoked before granting the intended RPCs (creation/join/leave/settings to authenticated; landing to anonymous/authenticated). Trigger functions have no client execute grant. No service-role client or new dependencies are introduced. This follows the [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions).

## Instant join and voluntary leave

`join_community(p_community_id uuid)` and `leave_community(p_community_id uuid)` derive the actor from `auth.uid()`; neither accepts user or role arguments. Both lock the actor's Auth row, then recheck the existing verified/non-anonymous/undeleted/unbanned eligibility rule. This also serializes the account's join/leave retries. Both then take a shared community-row lock, preventing policy/visibility updates or deletion until commit while allowing different accounts to join concurrently. Leave locks the caller's membership before checking its role. Future privileged mutation workflows must account for this lock order.

Join preserves an already-current member's role and returns the community slug, including after admission has closed. New admissions require public/unlisted + instant and insert only `member`, with the composite primary key and `ON CONFLICT DO NOTHING` preventing duplicates. Missing and inaccessible targets use the same safe error. Only basic membership is created; no entitlement, commercial assignment, or future restricted-resource access is granted.

Leave rejects owners and deletes only the actor's nonowner membership in the requested community. Missing communities and already-absent memberships return the same empty success. It does not check admission policy. Existing owner constraints remain defense in depth. Successful join redirects to the database-returned slug; leave redirects to `/communities`. Both actions invalidate the membership list and landing routes; dynamic reads and unchanged RLS remove membership-derived access after commit. Public/unlisted landing metadata remains available. Separate stale tabs update on their next request; no realtime feature or content cache is introduced.

The UI uses the existing server identity check, and the database repeats authorization atomically. Leave confirmation is required by both the form and Server Action service; direct authenticated RPC callers intentionally invoke the same narrow operation without a UI confirmation parameter. Errors/logs disclose no provider messages, private community metadata, or account content.

## Owner community settings

`update_community_settings(p_community_id uuid, p_settings jsonb)` derives the actor from `auth.uid()`, locks their Auth row, and rechecks current eligibility. It then exclusively locks only a community whose ID and current `owner_user_id` match the request and actor. Missing and unauthorized targets produce the same error. The locator is untrusted; ownership of one community never authorizes another. Ownership is checked again after waiting on a concurrent row update. This account → community lock order matches join/leave; their shared community locks serialize admission against settings changes.

The settings object accepts only `name`, optional `description`, `visibility`, and `join_policy`, all strings. Unknown keys, nulls, nonobjects, and wrong types fail. Existing constraints validate the single atomic update: name is required and 1–80 characters; description is at most 500; both trim outer ASCII spaces and reject control characters. Omitted/blank description becomes an empty string. Visibility and join policy must exactly match their existing allowed values. Every combination remains storable. No update touches a slug, owner, membership, or role. The existing `updated_at` trigger records the update time; no settings history system is introduced. Concurrent valid saves use the last committed settings.

The dynamic landing page renders the form only for the database-returned eligible owner role, without exposing owner identity. The Server Action independently verifies identity, rejects malformed/duplicate/unknown form fields (excluding React transport metadata), and calls the RPC with the cookie-bound client. A stale owner form cannot bypass database authorization. Explicit save shows safe errors or a success message and revalidates the current landing page and membership list. Other tabs see changes on their next request. Plain text is rendered with React escaping.

The request migration adds an `AFTER UPDATE OF visibility, join_policy` trigger to cancel that community's pending requests when the new settings are ineligible. It works within the existing exclusive community lock, taking no Auth or membership locks. Failure rolls back the settings update. Public/unlisted + approval_required preserves pending attempts; reopening eligibility never revives cancelled attempts. Settings success also revalidates the future requests route. The existing settings/join/leave RPC bodies and all historical migrations remain unchanged.

## Verification and release boundaries

`tests/community-rls.test.mts` executes all six local migrations, including the unapplied invitation migration, in PGlite with Supabase-like permissive starting grants and emulated Auth identity. Its 104 tests preserve foundation/join/leave/settings behavior, including role and eligibility denials, immutable ownership/slug, cross-tenant isolation, atomic failures, execution restrictions, and direct-write denial. All nine settings combinations are tested against admission. `tests/community.test.mts` covers the existing server services. Request-specific SQL, service, and independent PostgreSQL concurrency suites are documented in the request contract. Existing Auth/profile/session tests remain required.

PGlite queues one backend and is not evidence of session races. Request race tests additionally run against independent local PostgreSQL 17 sessions. Hosted PostgREST/Auth/browser validation of the new subsystem remains outstanding. Do not replay the settings or other historical migrations: their effects already exist in hosted development. Review the complete backend/UI feature, and use only a separately authorized targeted new-migration rollout. Do not repair hosted history, commit, or push as part of this implementation pass.

Before wider exposure, decide and implement creation abuse controls/rate limits and operational handling of abandoned ownership. Unlisted links are guessable and shareable; slug uniqueness necessarily reveals availability, including collisions with private slugs. No public discovery endpoint or member content is introduced in this slice. Schema-wide privileged SQL remains an administrative trust boundary.
