# Approval-required membership requests — backend and UI

Implemented locally against `4516d35b4c91a6ec436a1bf7947759d0a1075172` on 2026-09-29. Pass 1 received independent review: **PASS WITH NON-BLOCKING NOTES**. Pass 2 adds the approved requester/reviewer UI while preserving the reviewed backend byte-for-byte. Both passes remain uncommitted. This document is not rollout authorization; the migration remains unapplied to hosted Supabase.

## Pass 2 UI

- The dynamic community landing prioritizes current membership, then instant join or approval-required admission. Public/unlisted approval requests require a verified eligible account and a successful latest-own-attempt lookup (`limit: 1`). Private and invitation-only communities have no unsolicited request control. Read failures require refresh; a newly redacted receipt suppresses an earlier landing preview.
- Request names start blank, use the backend validator, and carry an explicit owner/admin sharing notice stating that private profile names and email are not exposed. Pending attempts show their snapshotted name and exact-attempt withdrawal. Terminal receipts allow an explicit new request when currently eligible. Existing instant join, leave, roles and owner settings are preserved.
- `/communities/requests` reads only the existing own-history service. Pages contain at most 20 attempts, newest first, with validated paired timestamp/UUID cursors preserving microseconds. Redacted receipts use generic community text and no link or inferred metadata. Approved history does not assert current membership. No reviewer identity is rendered.
- `/c/{slug}/requests` admits only the current owner/admin at the server page boundary; the queue RPC and review RPCs independently authorize again. The queue has at most 20 pending attempts per page, oldest first, showing only shared names and request timestamps. Fixed Approve/Reject actions receive the exact attempt ID; no Auth IDs, emails, private profiles or reviewer identities are displayed.
- Action results render the returned status and cancellation reason, including duplicate pending and already-resolved attempts. Both review controls disable together. Pending operations expose textual loading states; feedback receives focus and an accessible status/alert. Once an action returns, controls require a fresh read before another action; **Refresh status** reloads the page without replaying intent. Existing Server Action invalidation also reconciles landing/queue renders. No optimistic terminal transition, automatic retry, realtime or shared cache was added.
- Creation/settings help explains instant, approval, invitation-only and private restrictions, and settings-driven cancellation. Styling follows existing form classes and theme tokens. No dependencies, services, Server Actions, types, SQL, or database behavior changed in Pass 2.

Tests use the existing Node runner, installed TypeScript transpilation and React static rendering. Framework boundaries are stubbed; actual pages, components, action reducers, Server Actions and services execute. This verifies presentation/orchestration, not browser hydration, screen-reader behavior or real Auth/PostgREST integration. Those remain rollout validation gates.

Pass 2 final validation: **412 tests passed, 0 failed, 0 skipped**, across 13 suites on Node 24.21.0/npm 11.19.0. This includes the preserved 344 tests (all 34 independent PostgreSQL races enabled), 19 direct Server Action tests, and 49 presentation/page/action-reducer tests. The latter cover all nine admission combinations, member precedence, owner/admin queue and other-role denial, name-sharing/escaping, redacted receipts, pagination, terminal results, disabled/loading states, uncertain outcomes and review feedback retained after a queue row disappears. Lint, strict typecheck, production build with process-local `NEXT_TELEMETRY_DISABLED=1`, and `git diff --check` passed. The disposable loopback PostgreSQL 17.11 server was stopped afterward. Hosted Auth/PostgREST/browser testing was not performed. No dependency or lockfile changes.

The remaining sections describe the preserved Pass 1 database/server implementation and its original validation. References to the later UI pass below are historical; the UI described above is now implemented locally.

Migration: `supabase/migrations/20260929140004_community_membership_requests.sql`, created with Supabase CLI 2.118.0 `migration new community_membership_requests` after inspecting help. One transaction creates the subsystem and explicit privileges. The four historical migrations, their RPC bodies, membership roles/timestamps, and ownership constraints are unchanged. No backfill, hosted mutation, migration replay/repair, commit, push or deployment was performed.

## Schema and lifecycle

`public.community_membership_requests` stores `id`, `community_id`, `requester_user_id`, `requester_display_name`, `status`, `created_at`, `resolved_at`, `resolved_by_user_id`, and `cancellation_reason`. IDs/times are database generated; caller APIs cannot supply them. Attempt identity, tenant, requester, shared name and creation time never change. CHECKs require an explicit valid resolution shape and `resolved_at >= created_at`. Resolution uses the database clock, bounded below by creation time to preserve that invariant if the wall clock moves backwards.

Statuses are `pending`, `approved`, `rejected`, `withdrawn`, `cancelled`. Pending rows have no resolution metadata. Approved/rejected rows require a nonrequester actor and time; withdrawn requires requester actor and time. Cancelled requires time, NULL actor, and one of `policy_changed`, `already_member`, `requester_unavailable`. The insert/update guard requires pending creation and a single terminal transition, rejecting terminal rewrites and same-state metadata edits. RPC retries do not update rows.

| Operation | Result | Membership |
| --- | --- | --- |
| Eligible nonmember submits to public/unlisted + approval_required | New pending attempt | None |
| Same eligible nonmember submits while pending | Existing ID/name/time, `already_pending` | None |
| Requester withdraws exact own pending ID | withdrawn | Unchanged |
| Current eligible owner/admin approves eligible pending attempt | approved | Insert literal member atomically |
| Owner/admin rejects pending | rejected | None |
| Review finds existing membership | cancelled / already_member | Every existing field and role preserved |
| Approval finds requester account ineligible | cancelled / requester_unavailable | None |
| Settings become private or cease approval_required | All tenant pending rows cancelled / policy_changed | Existing members unchanged |
| Exact-ID terminal retry or policy reopening | Same terminal attempt | No enrollment or membership deletion |
| Explicit eligible reapplication after terminal resolution, including approval then leave | New pending row | Only a new approval can admit |

Approval ordering follows the plan: current reviewer authority/self-review, terminal replay, policy eligibility, requester account eligibility, membership presence, insertion, resolution. Rejection does not disclose or require requester account eligibility. Withdrawal ignores current admission policy. The acting account must always remain verified, non-anonymous, undeleted and not currently Auth-banned. Private communities reject unsolicited requests for every stored join policy. All nine stored policy/visibility combinations remain valid.

Indexes: UUID primary key; partial unique `(community_id, requester_user_id) WHERE status='pending'`; partial queue `(community_id, created_at, id) WHERE status='pending'`; requester/community history `(requester_user_id, community_id, created_at DESC, id DESC)`; requester history `(requester_user_id, created_at DESC, id DESC)`; full community FK index `(community_id)`. The existing membership PK is the final duplicate-membership guard.

Requester FK hard deletion cascades their attempts, including shared names. Community FK is NO ACTION. There is no membership FK, so leave retains request history. Reviewer audit UUID is deliberately a snapshot without Auth FK: reviewer deletion cannot block or rewrite someone else's terminal history. Soft-deleted/ineligible requesters cannot gain membership through approval. Retention beyond those rules and account-deletion workflows are not added here.

## Database entry points and privacy

| Authenticated RPC | Inputs | Projection |
| --- | --- | --- |
| `request_community_membership` | community UUID, explicit display name | request ID, status, outcome, cancellation reason |
| `withdraw_community_membership_request` | community UUID, exact request UUID | Same, requester reasons |
| `approve_community_membership_request` | community UUID, exact request UUID | Same, reviewer reasons |
| `reject_community_membership_request` | community UUID, exact request UUID | Same, reviewer reasons |
| `get_my_community_membership_requests` | optional community, paired before timestamp/UUID, limit | Own ID/community locator/name/status/times/reason and permitted community name/slug |
| `list_community_membership_requests` | community, paired after timestamp/UUID, limit | Pending request ID, shared name, status, creation time only |

Mutation outcomes are `created`, `already_pending`, `resolved`, `already_resolved`, `cancelled`. An already-resolved response is an informational result; the later UI must not claim a different requested decision succeeded. Reviewers receive `cannot_be_admitted` instead of `requester_unavailable`, never the account's verification/deletion/ban details. SQL denials use `42501` and malformed arguments use `22023`; applications never surface raw SQL messages. Missing, wrong-tenant, inaccessible, and unauthorized locators share the unavailable response. Authorization precedes terminal-detail responses.

History is newest-first; queue is oldest-first, both with `(created_at,id)` tuple cursors. Defaults are 20, allowed limits 1–50, with paired finite timestamps/UUIDs. Exact-community limit 1 serves future landing state. For private nonmembers, own receipts keep their original community UUID locator but community name/slug are NULL. No description, visibility, policy, owner, or member metadata is returned. No discovery endpoint or public request count exists.

The table enables and forces RLS, revokes all PUBLIC/anon/authenticated table and column grants, and has no direct-read/write policies. Six definer entry points independently derive `auth.uid()` and check current tenant authority. Each uses empty `search_path`, qualified relations, and no dynamic SQL. Default execution is revoked before authenticated-only grants. Trigger functions and the internal `review_community_membership_request(uuid,uuid,boolean)` helper have no client EXECUTE. Fixed approve/reject wrappers choose the decision; no browser-callable generic review function or supplied identity/authority exists.

Two triggers are added: `membership_requests_lifecycle` calls `guard_community_membership_request`; `communities_cancel_ineligible_requests` calls `cancel_ineligible_community_membership_requests` after visibility/join-policy updates. The latter cancels even anomalous pending rows in an already-ineligible NEW configuration and rolls back with settings on failure. It never locks Auth or membership rows or writes an actor FK.

Names are explicit attempt-specific labels, 1–80 Unicode codepoints, trimmed only at outer ASCII spaces, excluding control characters (C0, DEL, C1). Private profiles and provider metadata are never read. The later UI must display: “This name will be shared with this community's owner and admins to review your request.” Render names as escaped plain text. They are self-chosen labels, not verified identities, and must never be logged.

## Locking actually implemented

READ COMMITTED is the supported transaction model. Review first looks up immutable requester/tenant routing hints without locking or returning data. It then:

1. Locks reviewer and stored requester Auth rows `FOR UPDATE`, deduplicated and sorted by UUID. Submit/withdraw lock only their actor. Eligibility is re-read in a separate statement after waiting.
2. Locks the community `FOR SHARE`, then re-reads policy/owner. Settings retains its existing `FOR UPDATE`. No community lock upgrade occurs.
3. Locks relevant existing memberships `FOR SHARE`, sorted `(community_id,user_id)`, then re-reads reviewer authority. Owner role additionally agrees with `owner_user_id`. Submit locks/checks any own membership; withdrawal has no membership effect or need for that lock.
4. Locks the exact request `FOR UPDATE`, rechecking tenant, stored requester and status. Submission's actor lock serializes first inserts/retries; partial uniqueness is the final guard.
5. Inserts member with `ON CONFLICT DO NOTHING`, never a role update, and resolves atomically. A conflict cancels already_member. Unexpected failures roll back both records.

Settings cancellation holds the community write lock; other request mutations cannot reach their request locks until it commits. It acquires no additional Auth/membership locks. Existing join/leave/create follow the compatible account → community → membership order and are unchanged. Queue reads lock actor → community → reviewer membership before current authorization; history locks its actor and uses a single authorized projection snapshot. No network operation occurs inside a database transaction.

Trusted membership/demotion fixtures and future role tools must use sorted relevant Auth locks before community/membership locks. Arbitrary administrator SQL, disabled triggers, or deliberately violating the protocol is outside the end-user trust boundary. Lock/deadlock/serialization errors cause safe refresh guidance; services never automatically replay admission intent or reuse aborted transactions.

## Server boundary and contract

`request-validation.ts` holds request types, strict form validation and page/cursor validation. `requests.ts` is server-only, uses `getVerifiedUser`, fixed RPC names and the supplied ordinary cookie-bound client, validates returned projection shape/status/reason/locator, and logs only operation/code. Four thin Server Actions create that same client, handle authentication expiry, and revalidate `/communities`, landing pages, and future request pages. Settings also invalidates the request route. Reads have no shared cache. No service-role client, REST endpoint, dependency, Auth-service change or landing-RPC change is introduced.

The maintained TypeScript contract includes only client-executable request functions and exact safe projections. Baseline hosted-generated types were inspected read-only on 2026-09-29; the new objects cannot be generated from hosted development before rollout. Local tests inspect RPC signatures/projections and exercise the actual migration. Regenerate/compare against hosted types only after separate rollout authorization.

## Local validation and reproducibility

The SQL suite uses real PGlite PostgreSQL with emulated Supabase Auth and deliberately permissive initial grants, then applies all five local migration files to an empty database. It covers all nine eligibility combinations, accounts/roles, direct DML/upsert denial, FORCE RLS, column grants, request signatures, history/name immutability, NULL resolution constraints, FKs, partial uniqueness, request privacy, bounded pagination, account deletion, stale authority and injected membership/resolution/settings rollback. Existing 104 community tests now load the fifth migration too; Auth/private-profile/session tests remain in the complete suite.

Independent-session tests use `psql` processes and a disposable local PostgreSQL 17 database. They confirm B is blocked by A using `pg_blocking_pids` before allowing A to commit, then assert terminal history, membership/role correspondence, pending/membership uniqueness, exactly one owner, policy eligibility and unchanged other tenants. Cross-reviewers use a lower-UUID barrier; unrelated accounts/tenants must proceed without waiting. PGlite Promise concurrency is not counted as race evidence.

Run with the pinned Node 24.21.0/npm 11.19.0 toolchain. No dependency changes are required (`npm ls --depth=0` verifies the installed lockfile versions). Standard local checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

To include the independent-session suite, start an empty, disposable local PostgreSQL 17 server bound to `127.0.0.1` on a test port using local test authentication. Set `GROWUP_TEST_PSQL` to its `psql` executable and `GROWUP_TEST_PG_PORT` to that port, then run `npm test`. The harness always targets loopback, strips inherited libpq connection settings, uses database user `postgres`, creates its own random `growup_requests_*` database and drops only that database. It may create missing cluster-level `anon`/`authenticated` NOLOGIN roles for fixtures. Stop the disposable server afterwards. Without both variables the race suite explicitly skips; the other suites still run. Do not aim this harness at an existing working database/server.

This pass ran local PostgreSQL 17.11 from EDB's portable Windows binaries, outside the repository, with no installed service or application driver. The race matrix covers submit/submit; submit/withdraw; approve/withdraw; approve/reject; approve/approve; withdraw/reject; each request operation/settings in both orders; close/reopen/stale approval; reviewer leave/demotion; requester eligibility changes; membership insertion; terminal approval replay/leave; settings/settings; cross-reviewers; unrelated tenants.

Recorded results: **344 tests passed, 0 failed, 0 skipped**, across 11 suites with local PostgreSQL enabled: 86 request SQL tests, 36 request service tests, 34 independent-session races, and 188 existing regression tests. Lint, strict typecheck and production build passed. The build required process-local `NEXT_TELEMETRY_DISABLED=1` after an initial Windows EXDEV rename failure in Next's telemetry configuration; no application/configuration file was changed for that environment issue. `git diff --check` and checks of all untracked additions passed. Dependency versions match the pinned installation; package/lockfiles and historical migration files are unchanged.

## Hosted rollout and remaining gates

Read-only GitHub inspection confirmed the checkpoint. Read-only Supabase inspection of development `uyixafcoseuuprpfzhnz` confirmed historical RPCs and an empty migration list; type generation is also read-only. This pass made no hosted writes. The existing history gap is not evidence that old SQL needs applying.

1. Review the complete uncommitted backend + UI diff and local test results before commit or hosted rollout. Pass 2 implements request controls/sharing notice, history/private fallback, owner/admin queue and settings/creation help without changing the reviewed backend.
2. Under separately explicit hosted authorization, reconfirm the project and historical schema/grants/functions. Apply **only** the reviewed new request migration transaction through a targeted operation; never whole-repository push/replay. Check that the new migration gets a tracking entry. Do not run, repair or mark historical migrations during this pass.
3. Before future bulk migration tooling, inventory and compare all four historical effects. Only after that verification and explicit authorization may an operational history repair mark verified versions applied. Never reexecute the historical SQL as a substitute.
4. Inspect new grants/RLS/search paths/indexes/triggers and regenerate/compare types. Review advisor results against the recorded baseline: landing anonymous definer exposure, six existing authenticated definer entry points, and disabled leaked-password protection. New authenticated definer warnings require review of these exact authorization/projection checks; no blanket exception or Auth configuration change is implied.
5. With disposable fixtures and ordinary publishable-key sessions, repeat owner/admin/moderator/member/nonmember/anon/ineligible, cross-tenant, forged-input, direct REST table and RPC checks via real Auth/PostgREST. Validate cancellation, reapplication, private receipts, stale tabs, session expiry and name escaping in the eventual production-build UI. Repeat independent-session races as appropriate for hosted integration.
6. Preserve existing development data and clean up only identified fixtures. Record evidence and any limitations. Commit/push/deploy only when separately requested.

Limitations: local Auth tables emulate the fields used for eligibility, not full Supabase Auth/PostgREST. No new hosted API/browser validation was performed. Pending uniqueness does not stop submit/withdraw history churn; rate limits/abuse controls remain a wider-release gate, with no cooldown or notification system added. Request history retention beyond specified hard deletion remains unresolved. Non-blocking backend test follow-ups remain: explicit submit/instant-join race, simultaneous reapplication after a terminal attempt, stronger membership timestamp preservation, and stronger catalog/type/index assertions. Pass 2 addresses direct Server Action orchestration coverage.

Implementation detail beyond the plan's named objects: approve/reject share one revoked internal SQL helper to keep authorization/locking identical. One opt-in local concurrency test file was added beyond the listed file set. These do not change the approved product or security behavior.
