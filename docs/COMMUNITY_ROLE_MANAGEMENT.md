# Community role management — Pass 1

The frozen contract supplied for checkpoint `0a5a0cfa96413539c27aa896cffda94ce0a6a03c` is implemented locally, uncommitted. This pass includes database, services, Server Actions and tests only. **Independent backend/security review PASSED; local backend validation COMPLETE; all 125 independent-session PostgreSQL cases EXECUTED AND PASSED. Hosted rollout, hosted schema/security verification, hosted Auth/PostgREST acceptance, final management UI and browser acceptance are NOT DONE.** The feature as a whole and Phase 1 are not complete. Invitation application code, migrations and semantics remain unchanged.

## Migration and identity

`20261008104916_community_role_management.sql` is the only new migration, created with Supabase CLI `migration new community_role_management`. It adds a unique, nonnull, default-generated `membership_id` without replacing `(community_id,user_id)`. The volatile UUID default backfills each existing row once without an UPDATE. A populated six-membership fixture retains every original role, timestamp (including microseconds), tenant/user key and owner relationship; all UUIDs are distinct and all management names start NULL. Existing admission functions use the default unchanged.

`guard_community_membership_identity()` prevents changes to `membership_id`, `community_id`, `user_id` and `created_at`, including privileged SQL updates. Existing role, owner and updated-time constraints/triggers remain intact. A membership UUID identifies one membership lifetime, not a person, credential or permission. Readmission receives a new UUID and literal `member`, with no historical staff role or label restored.

`management_display_name` is a nullable, optional, unverified, nonunique membership label. Only the member can edit their exact current membership's label, including the owner. ASCII outer spaces are trimmed; empty input clears to NULL; names contain 1–80 Unicode codepoints and no control characters. No profile, provider or request name is copied. It is plain text, returned without HTML interpretation; a later UI must render it with normal escaping. Own-row RLS permits self reads; the manager roster is the only other application audience. Leaving/removal deletes it.

## Database entry points

| Authenticated RPC signature | Return |
| --- | --- |
| `list_community_members(p_community_id uuid, p_after_created_at timestamptz DEFAULT NULL, p_after_membership_id uuid DEFAULT NULL, p_limit integer DEFAULT 20)` | `membership_id uuid, management_display_name text, role text, joined_at timestamptz, is_self boolean` |
| `set_community_member_role(p_community_id uuid, p_membership_id uuid, p_role text)` | `outcome text`: changed / unchanged |
| `remove_community_member(p_community_id uuid, p_membership_id uuid)` | `outcome text`: removed / already_absent |
| `set_my_community_management_name(p_community_id uuid, p_membership_id uuid, p_name text)` | `management_display_name text` (nullable) |

All derive identity from `auth.uid()`, check current actor eligibility, use qualified relations with an empty search path, revoke PUBLIC/anon execution and grant authenticated execution explicitly. The mutation implementation and identity trigger have no client EXECUTE. No actor ID/role, target Auth ID, timestamp, owner field or audit input is accepted. Invalid arguments use `22023`; management denial uses generic `42501`, with no account-ineligibility reason.

| Actor | Other member | Other moderator | Other admin | Owner / self |
| --- | --- | --- | --- | --- |
| Owner | member/moderator/admin or remove | member/moderator/admin or remove | member/moderator/admin or remove | Denied |
| Admin | member/moderator or remove | member/moderator or remove | Denied, including no-op | Denied |
| Moderator/member/unrelated | Denied | Denied | Denied | Denied |

Owner is never a destination. Both owner role and `communities.owner_user_id` protect the owner target, even during an inconsistent deferred transaction. Self-target denial precedes no-op handling. Zero nonowner admins is valid. Same-role returns unchanged only after authorization, without UPDATE, timestamp changes or audit.

Promotions member→moderator/admin and moderator→admin require a currently verified, nonanonymous, undeleted, unbanned target. Demotions, authorized no-ops and removals permit cleanup of ineligible targets. Target checking uses internal Auth reads, not the actor-only `is_private_profile_owner(target)` predicate.

## Removal, requests and audit

Removal deletes the exact supplied lifetime and records one audit event. Missing, foreign and stale references return `already_absent` only after current manager authorization in the supplied tenant. This reveals only that the reference is absent there. Set-role instead returns generic unavailable for those references. Neither follows the hinted account to a replacement membership.

Only removal of an existing exact target searches for a pending request. Under the prescribed locks, an anomalous pending attempt becomes cancelled/already_member, with NULL reviewer and preserved ID, applicant, name snapshot and creation time. Terminal requests are unchanged. An absent reference never cancels a new application. All cancellation, deletion and audit changes commit or roll back together.

Removal creates no ban, cooldown, blacklist or invitation revocation and preserves the account/private profile. Eligible accounts may immediately join under current instant rules, submit a fresh approval request or accept an unused invitation. Consumed-invitation and terminal-approved-request replay cannot readmit. The admission functions are unchanged.

`community_member_management_events` contains exactly ID, community, historical actor/target Auth IDs, target membership UUID, old/new nonowner roles and finite database timestamp. NULL new role means removal; nonnull new role must differ from old. Actor cannot equal target. Only the community has an FK (ON DELETE CASCADE); no account/membership FKs erase or block historical IDs. No names, emails, reason text, token, request body or account status is recorded.

Only successful actual role changes and removals insert events, in the same transaction. Denials, no-ops, absent removals, label edits, voluntary leave and account deletion do not insert events. Injected audit failure rolls back the mutation and pending cleanup. The audit table has ENABLE/FORCE RLS, no policies or ordinary table/column grants, and no read RPC/UI. New indexes are the membership UUID unique constraint, `(community_id,created_at,membership_id)` roster index, audit PK and audit community index only.

## Privacy and concurrency

Roster access is current owner/admin only. The five-field projection includes no Auth UUID, email, profile, location, eligibility explanation, other tenant, audit information or total count. Names of all currently ineligible accounts are suppressed while their membership locator and role remain available for cleanup. Pages sort ascending by `(created_at,membership_id)`, require both cursor components or neither, default to 20 and cap at 50. Services preserve original timestamp strings and compare fractional microseconds as integers. Tests cover equal timestamps, a deleted cursor row and changing membership sets.

The same migration revokes table-wide communities SELECT and grants only `id,name,slug,description,visibility,join_policy,created_at,updated_at`. `owner_user_id` and the owner discriminator are excluded. Existing RLS semantics stay unchanged. Application reads already use safe projections; tests that used broad authenticated reads now select those safe fields. Privileged invariant snapshots still inspect ownership. Foundation/settings/requests/invitations regressions pass with the correction.

Staff mutations validate, perform an unlocked tenant-scoped routing lookup, lock deduplicated actor/target Auth rows in UUID order, reread actor eligibility, lock community FOR SHARE, reread owner, lock existing memberships FOR UPDATE ordered by `(community_id,user_id)`, reread/authorize exact current state, then lock any pending request before removal and audit. No late Auth lock, community lock upgrade or invitation lock is introduced. The private `mutate_community_member` helper shares this protocol between fixed role/removal wrappers; it is not a client permission API. Listing locks only the authority rows; self-label edits lock own Auth, community and exact own membership. Isolation remains READ COMMITTED; no role version is added.

## Server boundary

`members.ts` supplies four server-only services, using the existing verified-user check and ordinary caller-scoped Supabase client. Strict input and returned-projection checks reject extra fields, invalid roles/names/pages, malformed or out-of-order rows, duplicate roster locators and unexpected mutation results. Diagnostics use existing redacted operation/code logging. Mutation transport failures and malformed receipts return `reconciliation_required`; there is no automatic replay. Installed-SDK fetch tests verify one POST for thrown network errors and HTTP 503/520 responses.

Three thin Server Actions construct the existing writable cookie-bound client, validate exact form fields and invoke these services. They redirect unauthenticated callers, invalidate existing affected community/request/invitation reads on success and return safe reconciliation errors for ambiguous failures. No final management page, component or roster UI is included; server readers can call the roster service directly.

## Validation record — 2026-10-08

Pinned Node **24.21.0**, npm **11.19.0**; `npm ci` completed without dependency/lockfile edits. The install reported **12 high-severity dependency advisories in the existing pinned tree**; dependency remediation was outside this slice.

Local functional coverage:

- 216 new database tests: populated migration/backfill, identity, complete authority transitions/removals, self/owner defenses, target eligibility, no-op timestamps, label privacy, readmission, request cleanup, audit atomicity/history/constraints, roster pagination, safe community reads and grants/FORCE RLS.
- 144 new service/input/SDK tests: verified identity, strict minimal arguments/results, precise cursor handling, safe errors, reconciliation and no mutation retry.
- 29 new Server Action tests: cookie client, validation, auth redirect, real service orchestration, invalidation, safe failures and no replay.
- 707 existing Auth/profile/session/community/settings/request/invitation tests retained. Only schema-compatible fixture cleanup and privacy-corrected read assertions changed; invitation business assertions remain intact.

**Final aggregate:** **1,096 regression/feature tests + 125 real PostgreSQL concurrency cases = 1,221 local tests passed, 0 failures, 0 skips.** The regression/feature count comprises 707 existing tests plus 389 new tests. Concurrency was executed separately; an opt-in suite omitted for missing connection variables is not concurrency pass evidence. PGlite exercises actual PostgreSQL constraints/triggers/RLS with fixture Auth context; it is **not evidence for independent-session concurrency or hosted Auth/PostgREST**. No package/lockfile or historical migration changed.

### Independent-session execution verified

The supplied successful execution record used **Ubuntu / WSL2, PostgreSQL 17.11**: **51 role-management + 34 request + 40 invitation cases = 125 passed, 0 failed, 0 skipped**. Production/test source hashes were confirmed unchanged during that run. No deadlocks or lock/statement/client timeouts occurred. Disposable databases and fixture roles were cleaned up; hosted Supabase was not modified.

The 51 role-management cases use disposable randomly named loopback databases, separate sessions, observed blocking before release, explicit winner orders, rollback and invariant assertions. They cover set/set, set/remove, remove/remove, manager demotion/leave, target leave/rejoin, admission interactions, pending review/withdrawal/settings cleanup, inverse account sets, actor/target ban/soft/hard deletion, unrelated progress and roster lock scope. The 34 request and 40 invitation cases remain intact; those harnesses gained only the new audit table in fixture TRUNCATE lists to satisfy its community FK.

Independent review found no production defect but identified that the original inverse-account test started B after A had acquired both Auth locks. The corrected test was executed using actual set_community_member_role RPCs in both UUID orientations: C holds the larger Auth row; A holds the smaller row and waits on C; B's inverse RPC waits on A. Observed pg_blocking_pids and ungranted transaction-ID locks establish A → C and B → A → C; a NOWAIT probe returning SQLSTATE 55P03 confirms A holds the smaller row. C releases, A commits, then B commits. Persisted memberships, unchanged communities, exactly two audit events and ownership invariants are asserted. This proof passed on real PostgreSQL.

The earlier Windows execution block was resolved by the subsequent WSL2 run. It is no longer an outstanding validation gate. Future behavior changes can be checked with GROWUP_TEST_PSQL and GROWUP_TEST_PG_PORT using the existing loopback-only disposable harnesses.

### Final local integrated review — 2026-10-09

Current-source registration inspection confirms 51 / 34 / 40 concurrency cases and both corrected inverse-account orientations. A fresh regression/feature run excluding the three separately verified concurrency files passed **1,096 tests, 0 failures, 0 skips**. The accepted prior PostgreSQL execution supplies the other 125 passes; these are 1,221 distinct tests, not repeated runs added together. Documentation-only reconciliation does not require rerunning concurrency. Final local lint, strict typecheck, production build (NEXT_TELEMETRY_DISABLED=1) and tracked/untracked whitespace checks passed. SHA-256 comparison against review-start files confirmed no production or test source changed during this review; nothing was staged.

### Remaining gates

Local backend implementation, independent backend/security review and real PostgreSQL concurrency validation are complete. The role-management migration has **not** been applied to hosted Supabase. Hosted migration/type/schema/security verification and real Auth/PostgREST behavioral acceptance remain undone. Final member-management UI is not implemented and browser acceptance is not done. The complete role-management feature and Phase 1 remain incomplete. No paid infrastructure or production domain is required for this backend slice. No commit, push, deployment, ownership transfer, ban system or hosted configuration change was performed.
