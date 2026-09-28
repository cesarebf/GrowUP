# Phase 1 community foundation

Implemented locally; migration and hosted integration remain unreviewed/unapplied by this task. Existing Auth/session/private-profile architecture is unchanged. Core Auth was previously committed, pushed, and live-validated; password-recovery completion remains deferred pending custom SMTP/domain infrastructure.

## Supported behavior

- Verified eligible accounts create multiple communities at `/communities/new` and see their memberships at `/communities`.
- Creation requires an explicit visibility and join policy; neither has a database or form default. All nine combinations can be stored as configuration. This does not settle future admission eligibility rules.
- `/c/{slug}` renders a minimal landing page. Public and unlisted direct links expose only ID, name, slug, description, visibility, join policy, and the viewer's own role (or null). No owner identity, private profile, roster, timestamps, or member content is published.
- Private nonmembers receive no metadata and the same unavailable page as a nonexistent slug. This is the conservative implementation for this slice; any future invitation preview needs an explicit field policy.
- No join button exists, including for `instant`. Instant admission, requests/approval, invitations, role management, transfers, settings edits, closure, discovery, and content features are deferred. Platform administration and commercial entitlements remain separate.
- Slugs normalize outer spaces/case; stored slugs use 3–48 lowercase ASCII letters/numbers separated by single hyphens. Reserved names are `new`, `admin`, `api`, `auth`, `account`, `communities`, `settings`, `support`, `help`, `growup`, and `www`. UUIDs are durable identity; slugs can be changed by a future authorized workflow without changing references. No rename/history endpoint exists now.

## Implemented schema

Migration: `supabase/migrations/20260928000100_community_foundation.sql`, applied after the existing private-profile migration.

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

Definer functions use an empty `search_path` and schema-qualified relations. Public/anonymous/authenticated default execute grants are revoked before granting only the two intended RPCs (creation to authenticated; landing to anonymous/authenticated). Trigger functions have no client execute grant. No service-role client or new dependencies are introduced. This follows the [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions).

## Verification and release boundaries

`tests/community-rls.test.mts` executes both migrations in PGlite with Supabase-like permissive starting grants and emulated Auth identity. It verifies creation/rollback, configuration and slug constraints, role isolation, anonymous/nonmember landing projections, grant and RLS denial, immediate access revocation, owner constraints, deletion guards, and future transfer representability. `tests/community.test.mts` covers the server service and validation boundary, forged fields, safe errors, and user-scoped listing. Existing Auth/profile/session tests remain required.

Local SQL tests do not verify hosted PostgREST relationship resolution, hosted Auth administration, multi-session lock races, browser cookies, or deployment. Before deploying this slice, review/apply the migration in a separate development Supabase project and validate the real creation → redirect → list flow, signed-out public/unlisted/private pages, two-user isolation, and direct REST/RPC denial. Regenerate database types and compare them with the checked-in minimal contract. Do not edit the previously applied Auth migration.

Before wider exposure, decide and implement creation abuse controls/rate limits and operational handling of abandoned ownership. Unlisted links are guessable and shareable; slug uniqueness necessarily reveals availability, including collisions with private slugs. No public discovery endpoint or member content is introduced in this slice. Schema-wide privileged SQL remains an administrative trust boundary.
