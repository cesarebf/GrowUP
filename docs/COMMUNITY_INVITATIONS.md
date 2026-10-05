# Phase 1 community invitations — accepted contract and local implementation

Status: **Pass 1 + Pass 2 implemented locally, uncommitted; ready for final integrated review**. The user reports independent backend/security review **PASS WITH NON-BLOCKING NOTES**, followed by the microsecond-precision correction and 152 passing targeted tests. Pass 2 preserves that backend. Work began from `699775f50ccd2537d2f64d50106213199ead68f0` (`docs: plan community invitations`), following requests at `937dbc4`. No hosted mutation, remote migration, tracking repair, commit, push or deployment. The numbered design remains the accepted contract; the records below distinguish local evidence from hosted release gates.

## Pass 2 UI/application record

- Dynamic `/c/[slug]/invitations` authorizes the current owner/admin before reading history; the existing RPC independently authorizes again. Landing navigation exposes management only to those roles. Successful list reads show newest-first safe history, 20 rows, with paired microsecond-preserving cursors. No historical token, hash or actor identity is rendered.
- A shared create/revoke action state prevents overlapping or repeated submissions. Revocation requires confirmation and targets the exact invitation. Returned accepted/expired states are reported without claiming revocation. Uncertain results lock further mutations until full refresh; no optimistic terminal state or retry. Existing Server Action revalidation reconciles history and request/community surfaces.
- Creation presents its response link once, with seven-day/168-hour, single-use, bearer and revocation guidance. Copy validates the relative route and uses `window.location.origin`; no hostname configuration or persistence. Clipboard denial focuses/selects the read-only field for manual copying. Dismiss/reload clears delivery; history never reconstructs it. Refresh is required before another mutation.
- Dynamic `/invite/[token]` uses strict token validation and the existing preview service. Active private previews expose only approved fields. Invalid/expired/revoked/other-accepter states share generic unavailable text. Same-accepter replay is informational; departed replay has no reconstructed community metadata. Errors render safe refresh guidance.
- Signed-out users submit fixed sign-in/sign-up choices through the existing HttpOnly return-cookie action. Successful sign-in returns without acceptance. Signup guidance explains verification, same-browser one-hour return, and reopening the original invitation when continuation expires or changes device. Provider callbacks and Auth semantics are unchanged.
- Authenticated nonmembers explicitly accept. Existing members see unchanged-role/unused-invite guidance and explicit Continue, as required because active previews omit the slug. Authoritative results replace earlier preview data entirely, including on errors/unavailable/departed replay. Confirmed membership offers an unprefetched, no-referrer, history-replacing community link. No browser request-cancellation logic is added; existing action invalidation and membership-first landing rendering reconcile pending requests.
- Generic metadata, force-dynamic routes, existing private/no-store/no-referrer/noindex headers, and disabled invitation-page link prefetch are preserved. All text uses React escaping; no analytics, third-party assets, custom token logging, persistent browser storage, new dependency, SQL or backend change. Controls have labels, semantic disabled/busy states, textual feedback and focused status/alerts. Layout wraps long text and uses a bounded selectable link field.

Validation on Node **24.21.0**, npm **11.19.0**: **707 tests passed, 0 failed, 0 skipped, 20 suites**, explicitly excluding the two independent PostgreSQL concurrency files as requested. This includes **62 new UI/application/copy tests**, the invitation PGlite/pgcrypto and service tests, Auth action/return/session tests, request action/UI/SQL regressions and existing foundation/profile tests. The targeted nine-file run passed **342 tests**. Existing request UI tests also assert invitation navigation and updated policy help. Lint, strict typecheck, production build with `NEXT_TELEMETRY_DISABLED=1`, and diff whitespace checks passed. No expensive independent concurrency rerun; prior backend concurrency evidence remains the Pass 1 record.

Actual headless Edge/Playwright smoke used the production build on **localhost:4317** and a **loopback-only fixture Auth/RPC API on 127.0.0.1:4318**. Passed: hydration/runtime checks; 320/375/1280 widths without horizontal overflow; long names/descriptions/URLs; keyboard creation and Auth navigation; clipboard success and denied-clipboard focus/selection; refresh removes raw delivery; revoke; owner/admin access and moderator/member management denial; private/unavailable/accepted/departed presentation; explicit acceptance; sign-in cookie consumption without auto-acceptance; signup verification guidance. Actual recipient response headers were private/no-store, no-referrer and noindex/nofollow. Browser requests had no third-party destinations, token query strings or token referrers; no local/session storage or synthetic token in captured production output. Browser payloads/screenshots/HARs were not retained.

This smoke **emulates provider responses and does not validate real Auth, PostgREST, SQL authorization or email delivery**. SQL behavior is separately covered by local PGlite tests. Reproduce with `tests/helpers/invitation-browser-smoke.mjs`: use the loopback build variables documented at its top, point `GROWUP_PLAYWRIGHT_MODULE` to an existing Playwright module file URL and optionally `GROWUP_BROWSER_EXECUTABLE` to an installed Chromium browser. No app test bypass or dependency was added. The helper starts/stops its own fixture API and production server; its output is redacted.

Remaining gates: final integrated review before commit/push; separately authorized targeted hosted invitation migration, hosted API/security validation, real multi-account browser/Auth/signup/request reconciliation, stale-session/multi-tab behavior, provider/access/body/bind/Cookie logging inspection, and production HTTPS cookies. No backend defect discovered or contract deviation introduced in Pass 2. Paid infrastructure required: **NONE**. Production-domain dependency: **NONE**.

## Pass 1 implementation record (historical validation)

Migration: **`supabase/migrations/20260930175249_community_invitations.sql`**, created by Supabase CLI 2.118.0 `migration new community_invitations`. One isolated transaction, no historical migration edits/backfill. Requires the existing `extensions.pgcrypto`. Read-only GitHub confirmed the clean base; read-only Supabase confirmed only `20260930000900 / community_membership_requests` in hosted tracking. Nothing was applied remotely or marked applied.

The exact ten-column table/constraints/indexes below are implemented. Finite creation/expiry, unique 32-byte bytea hash, exact `interval '168 hours'`, paired historical actor/timestamp fields, mutual accepted/revoked exclusion and resolution-time bounds are enforced. Audit UUIDs have no Auth FK; community FK cascades invitations after successful authorized cleanup. A revoked lifecycle guard prohibits same-state/base-field/terminal rewrites. Expiry stays derived. All supported operations use fresh database time after waits; the transition constraint checks the sampled decision timestamp rather than imposing a commit-time cutoff.

Five public RPCs implement the documented contract. Create derives actor/authority from current DB state and returns ID/creation/expiry only. List returns six safe ID/state/time fields, newest first, default 20/max 50 with paired microsecond-preserving cursor. Revoke serializes on exact tenant invitation and returns the same safe fields; repeated revoke preserves original audit, accepted/expired state is reported unchanged. Preview is read-only and returns the limited active capability projection (including private tenants), uniform unavailable for stale/invalid/other-accepter tokens, or the documented same-accepter exception. Acceptance derives tenant from the raw token hash and identity from auth.uid(), inserts only member, preserves every existing membership field and leaves active invites unused for existing members. Same-accepter replay never recreates membership; departed replay has NULL community metadata.

Pending requests use existing cancelled/already_member/NULL-reviewer representation atomically with successful admission. Invalid attempts never cancel requests; terminal histories remain exact. Approval-first produces already_member/unused invite; invite-first cancels the request and later review returns its existing resolution. No settings trigger invalidates invitations.

Internal revoked `authorize_community_invitation_manager(uuid)` shares the actor → community → membership lock prefix across create/list/revoke. Acceptance uses unlocked immutable routing hints, actor FOR UPDATE → community FOR SHARE → existing own membership FOR SHARE → pending request FOR UPDATE → invitation FOR UPDATE, then separately re-reads and samples clock_timestamp bounded below by creation. No creator/audit-account FK lock or community lock upgrade. Unsupported arbitrary administrator SQL is outside this protocol; successful deletion fixtures explicitly acquire sorted accounts **before** the community write lock. No deletion API was added.

All five RPCs use justified SECURITY DEFINER, qualified objects and empty search_path; manager helper/guard deny client EXECUTE. RLS and FORCE RLS are enabled with no direct policies or ordinary table/column privileges. Only preview allows anon; management/acceptance require authenticated eligible accounts. No service-role application client or direct invitation-table path. Application types contain only the client-executable functions, omitting internals.

Server-only `invitations.ts` uses Node randomBytes(32) → 64 lowercase hexadecimal characters → SHA-256 of UTF-8 text. Creation transmits only the digest; PostgreSQL preview/acceptance use extensions.digest on raw text. The stored hash is hashed again if supplied as a raw credential and fails. No token/url/hostname/email is stored in rows. A raw secret exists transiently in generation/one-time relative action delivery, recipient/RPC transport and the approved short-lived HttpOnly return cookie; no cache or persistent browser/app storage was added. Clipboard/history are acknowledged future UI tradeoffs. No silent creation/admission retries.

Thin Server Actions use ordinary writable session clients, strict forms and safe result validation, with token-free pattern revalidation. Auth return uses a fixed sign-in/sign-up enum, exact token, host-only HttpOnly SameSite=Lax Path=/ cookie, Max-Age 3600, Secure for trusted configured HTTPS and non-Secure only on loopback HTTP, including local production-build testing. Sign-in consumes/deletes it and returns a validated relative invitation path without acceptance. Failed sign-in retains original expiry; logout clears it. Last-started flow wins across tabs; no cross-device relay. Provider confirmation/signup callbacks are unchanged.

Diagnostic controls: fixed operation names, bounded non-capability error codes, no provider messages/DETAIL/body/URL logging; exact RPC projections cannot return secret extras. Installed SDK tests prove raw-token preview uses POST JSON bodies, never URL/query arguments. Next incoming-request/Server Function development logs are disabled. Invitation/community/manager routes receive private/no-store, no-referrer, noindex/nofollow/nosnippet, nosniff and frame-denial headers and proxy session coverage. No invitation pages/controls/prefetch/analytics/assets were added in this pass.

Local validation on Node **24.21.0**, npm **11.19.0**, PGlite with **real pgcrypto**, and disposable loopback PostgreSQL **17.11**: **661 tests passed, 0 failed, 0 skipped, 19 suites**. Added 249 tests: 95 invitation SQL, 70 service/validation, 40 independent PostgreSQL, 20 action/Auth orchestration, 20 return-cookie and 4 SDK/header/logging checks. The existing 412 tests remain passing, including 34 independent request checks. PostgreSQL tests observe pg_blocking_pids before releasing barriers; both winner orders cover double acceptance, revoke, join, approval/rejection/withdrawal, membership creation, role changes/leave, settings, creator demotion, account eligibility/deletion and successful account-first community cleanup. Expiry lock-wait test crosses the actual wall-clock boundary. Transaction-local test clock injection proves minus-one-microsecond success, equality/plus-one-microsecond denial; production empty search_path is restored by fixture rollback. Spring/fall America/New_York assertions prove exactly 168 elapsed hours and reject seven-calendar-day intervals crossing DST.

Lint, strict typecheck, production build with process-local NEXT_TELEMETRY_DISABLED=1 and git diff --check pass. A local Next development synthetic path/Cookie probe found no secret in captured stdout/stderr. A production-start probe returned 404 (recipient page intentionally absent), with private/no-store, no-referrer, noindex/nofollow/nosnippet, DENY and nosniff headers; no secret appeared in body, Set-Cookie or production output. These probe results verify route-boundary controls, not an implemented recipient UI, browser hydration, or real HTTP invitation acceptance/cookie action delivery. Those remain Pass 2/hosted checks. No package/lockfile/environment changes or paid services.

**Required remaining gates:** independent backend/security review before Pass 2 UI; separately authorized targeted hosted migration and real Auth/PostgREST/API tests; provider/access/body/bind-parameter/Cookie/Set-Cookie log inspection with synthetic secrets and redacted retained evidence; final browser/clipboard/hydration/accessibility checks in Pass 2. Local emulated Auth and localhost header/log probes do not prove managed logs or public signup delivery safe. If provider secrets cannot be suppressed, revise verification transport before release. Clock rollback assumption, launch abuse controls and audit retention/erasure remain as reviewed. Paid infrastructure required: **NONE**. Production-domain dependency: **NONE**.

Implementation refinements within the approved contract: one revoked manager helper shares lock/authority code; revocation returns the six-field state/history projection without a redundant outcome flag. Presentation helpers, pages, controls and UI tests in the original manifest are intentionally deferred to Pass 2 under this task's explicit restriction.

## 1. Baseline, authority, and recommended product model

Read: repository `AGENTS.md`, PRODUCT, PHASE_1_DECISIONS, ARCHITECTURE, SECURITY_AND_PRIVACY, COMMUNITY_FOUNDATION, COMMUNITY_MEMBERSHIP_REQUESTS, DATA_MODEL, AUTH_SETUP, ROADMAP, and PAYMENTS. Inspected the five migrations, community services/actions/pages/forms, request services/actions/validation and test harnesses, Auth actions/services/confirmation, cookie adapters, proxy, configuration, and database types. The working tree was clean before this document. Local HEAD and connected GitHub confirm the supplied checkpoint.

The user's completion record supersedes stale documentation describing requests as local/uncommitted/unapplied. Those historical status paragraphs are not new validation results. Read-only inspection of development project `uyixafcoseuuprpfzhnz` confirmed:

- Communities, memberships, private profiles, and membership requests exist with ENABLE/FORCE RLS.
- Request table has no ordinary-client privileges. Reviewed request RPCs use restricted execution and empty search paths; hosted review logic follows the documented lock protocol.
- Request cancellation includes `already_member`; no new request state or cancellation reason is needed.
- `pgcrypto` exists in `extensions`; hosted PostgreSQL reports 17.6.1.166.
- Hosted tracking contains only version `20260930000900`, name `community_membership_requests`. Its tracked version differs from local filename `20260929140004_community_membership_requests.sql`. Do not repair either history or filename here.
- There is no existing invitations table or community deletion API. Existing membership/request community FKs are NO ACTION; owner deletion is restricted.

Recommend **single-use, revocable, seven-day opaque bearer links**, issued by current eligible owner/admin, not assigned to an email or account. Any currently eligible authenticated holder can explicitly accept. Exactly one successful new admission consumes the link. Admission creates only `member`, with no commercial/resource entitlements.

This explicitly replaces the older email-bound invitation proposal in PHASE_1_DECISIONS. Email addresses, contact lists, lookup/search, notifications, reusable links, staff invitations, bans, billing, referral systems, analytics, transfers, and general role management are excluded. Existing Auth account eligibility remains required; this does not add a new bans subsystem.

Multiple invitations per community are allowed, without a Phase 1 creation quota or new rate-limit service. Each is a separate capability. Bounded reads and existing provider protections suffice for development; wider-release abuse controls remain a project release gate, not an invitation infrastructure dependency.

## 2. Invitation state machine

Store resolution timestamps, not a redundant status column. For database time `t`, derive status in this order:

1. `accepted_at IS NOT NULL` → accepted.
2. `revoked_at IS NOT NULL` → revoked.
3. `t >= expires_at` → expired.
4. Otherwise → active.

Constraints prohibit accepted and revoked timestamps coexisting. Accepted/revoked remain their terminal state after expiry; status never changes to expired after acceptance/revocation.

| From | Event | To | Effects |
| --- | --- | --- | --- |
| New | Authorized creation | active | Immutable identity, tenant, hash, creator, creation and expiry recorded |
| active | Explicit eligible nonmember acceptance before expiry | accepted | Member insertion, pending-request cancellation, invite resolution in one transaction |
| active | Existing member explicitly accepts | active | Preserve membership; return already_member; cancel any anomalous pending own request |
| active | Authorized revocation before expiry | revoked | Record revocation time/actor once |
| active | Database time reaches expiry | expired | Derived without writes, scheduled jobs, or cleanup service |
| accepted | Same accepter retries | accepted | Informational accepted result only; never recreate membership |
| accepted | Another account retries | accepted | Generic unavailable; no metadata or accepter identity |
| revoked / expired | Any acceptance | unchanged | Generic unavailable; no membership/request effect |
| revoked | Authorized repeat revoke | revoked | Return existing state; preserve original audit |
| accepted / expired | Authorized revoke | unchanged | Return current state; do not relabel history |

Expired is terminal for supported operations: no extensions, reset, reuse, replacement of hash, or reopening. Derived expiry assumes a trustworthy database clock; a large clock rollback could make an unresolved timestamp-based invite appear active again. This is an operational clock assumption, not a claim of a monotonic database timer. No persisted expiry worker is justified here. All mutation decisions use a fresh `clock_timestamp()` after lock waits, never transaction-start `now()` for invitation expiry.

## 3. Proposed database schema and history

New `public.community_invitations`:

| Column | Type / rules |
| --- | --- |
| `id` | UUID PK, generated by database |
| `community_id` | Non-null UUID FK to communities, ON DELETE CASCADE |
| `token_hash` | Non-null bytea, exactly 32 bytes, globally unique |
| `created_by_user_id` | Non-null historical UUID, deliberately no Auth FK |
| `created_at` | Non-null finite timestamptz, database clock |
| `expires_at` | Non-null finite timestamptz, database-selected creation time + 168 hours |
| `revoked_at` | Nullable finite timestamptz |
| `revoked_by_user_id` | Nullable historical UUID, no Auth FK |
| `accepted_at` | Nullable finite timestamptz |
| `accepted_by_user_id` | Nullable historical UUID, no Auth FK |

Minimum audit includes revoker UUID as well as creator/accepter UUIDs. No names, emails, IP addresses, user agents, counters, labels, raw token, invitation URL, domain, recipient assignment, role, or billing fields.

Required constraints:

- `expires_at > created_at`; fixed 168-hour interval enforced for this slice.
- Finite timestamps; hash length; PK, unique hash, and tenant FK.
- Each resolution timestamp and its actor are either both NULL or both non-NULL. Write NULL checks explicitly; do not rely on SQL CHECK accepting UNKNOWN.
- At most one resolution; resolution time is at least creation and strictly less than expiry.
- Trigger guard requires unresolved insertion, immutable base fields, and one active-to-accepted/revoked transition. No same-state updates or terminal metadata rewrites. No client delete access; privileged fixture/closure deletion is a separate administrative boundary.
- Mutation code uses `max(clock_timestamp(), created_at)` for audit ordering if the wall clock moves slightly backwards, and rechecks that this decision time is still before expiry.

Indexes: unique hash for lookup, `(community_id, created_at DESC, id DESC)` for bounded manager history and FK deletion. No index predicate involving current time. Do not duplicate that community-prefix index with an unnecessary standalone FK index.

Audit UUIDs intentionally survive creator/accepter/revoker deletion without FK locks or SET NULL rewrites, consistent with request reviewer snapshots. Creation/acceptance derives and verifies a live actor under Auth locks; the historical UUID is not an authorization input. Managers receive status/times/ID only, never these UUIDs or profiles. UUIDs remain personal data for restricted operational purposes; no promise that this constitutes anonymization. Keep history for the community's lifetime in development, with no cleanup job; public-launch retention/export/erasure and backup policies remain unresolved project-wide. Hard community deletion erases invitation rows, including history/hash.

## 4. Tokens and cryptographic handling

Generate 32 bytes with Node's built-in `crypto.randomBytes`, encode as **64 lowercase hexadecimal characters**: 256 bits of entropy. Hex is slightly longer than 43-character base64url but avoids decoding/padding/canonicalization ambiguity and needs no package. Reject uppercase, whitespace, percent-encoded aliases after routing normalization, wrong length/alphabet, arrays, files, duplicate fields, and unexpected fields at appropriate boundaries. Database functions repeat exact token validation.

Hash the canonical token's UTF-8 text with SHA-256. Node computes it at creation; PostgreSQL uses schema-qualified `extensions.digest` for preview/acceptance. Tests prove both hash the identical bytes. Store the 32-byte digest; accept a validated 64-lowercase-hex digest parameter at creation and decode it internally. Hash is globally unique; no separate recipient-visible invitation identifier is needed. The internal UUID serves management/revocation only.

No salt, password KDF, pepper, or external secret manager is required for uniformly random 256-bit secrets. A deterministic cryptographic digest supports lookup; a leaked hash cannot feasibly recover a correctly generated raw token. This promise applies to app-generated tokens: a malicious authorized manager calling creation directly can choose a weak secret/hash for their own invitation. Database hash input cannot prove entropy; adding server signing/secret infrastructure solely to constrain that trusted issuer is outside this slice.

**Do not expose an accept-by-hash or preview-by-hash RPC.** Otherwise a database dump's hashes become directly redeemable credentials. Preview/accept take the raw secret, hash it inside the database, and look up the digest. A hash supplied as a raw token is hashed again and must fail. Creation accepting a digest does not let an attacker overwrite, rotate, or claim an existing invitation; duplicate digest creation fails atomically without disclosing another tenant's record.

Use indexed fixed-length digest equality, not sequential character comparison or partial-prefix errors. PostgreSQL index lookup is not guaranteed constant-time; do not claim it is. Generic failure projections and high entropy address practical information leakage. If a future application compares secrets in memory, use fixed-length constant-time comparison. No sleep-based timing equalization is proposed.

Raw secret exists only transiently in generation, delivery/copy UI, recipient URL, and necessary verification transport. It is never stored in a database column, retrievable manager history, logs, analytics, errors, or durable app/client storage. Preview/accept raw secrets necessarily traverse HTTPS request bodies to PostgREST and database function parameters; protect those paths as described in section 14. Database administrators with execution/logging control are outside the read-only-dump threat model.

## 5. Domain-agnostic URLs and copying

Canonical data is `/invite/<raw-secret>`, assembled by application code from a strictly validated generated token. Store neither path nor absolute URL in the database. Route is `src/app/invite/[token]/page.tsx`; slug is not part of token routing. Membership derives tenant only from the matched invitation.

Create action generates secret server-side, hashes it, calls the authorized create RPC, validates the returned ID/times, and returns the relative route once. Failed/ambiguous creation never returns a purported working link and never automatically retries. If the RPC committed but response was lost, manager history identifies the new unused invite; revoke it and explicitly create another. Secrets cannot be recovered or recopied after reload. No recoverable encrypted-token storage.

For **Copy invite link**, compute `new URL(relativeInvitePath, window.location.origin)` in the same-origin manager client component, after validating that the path exactly matches the invitation route and token format. The browser's actual loaded app origin is presentation context; never accept an origin from form fields or URL query parameters. Optionally an already validated configured origin can be provided if canonical-origin presentation is deliberately selected later; no new public environment variable is necessary now. A configured origin mismatch should be corrected, not silently copied to an unrelated hostname.

On localhost this produces, for example, `http://localhost:3000/invite/<secret>` (or the actual configured local port). Localhost links are usable on that machine, not remotely accessible to another person's computer. Remote reachability is not a requirement for local feature validation. Clipboard API works in the localhost secure-context exception; provide a focused/selectable read-only field and manual-copy fallback if denied. Clipboard/browser history and copies held by recipients cannot be recalled; revocation prevents future admission.

Server Actions/RSC/database logic use relative redirects and database-validated slugs. They never construct security-sensitive origins from arbitrary `Host`, `X-Forwarded-Host`, or caller-supplied Origin headers. Retain Next's same-origin action protections; no wildcard allowed origins. For Auth absolute callbacks keep existing `parseOrigin(APP_URL)` and exact provider allowlist.

**APP_URL should remain required for configured Auth locally**, because current `src/app/auth/actions.ts` parses it even for sign-in. Set it to free `http://localhost:3000`; making it optional would be unnecessary Auth refactoring. Invitation storage/acceptance does not intrinsically depend on it; copy uses current browser origin. Missing Auth configuration fails safely under the existing contract.

When the final hostname exists, change `APP_URL`, Supabase Site URL and exact callback allowlist, plus ordinary deployment/hosting configuration. Copied links use the new app origin automatically. No invitation schema, hashing, route, or RPC redesign. Previously distributed absolute URLs still point to their old origin; changing config cannot make old localhost URLs remotely reachable. The relative secret path remains valid on the new origin until consumed/revoked/expired.

## 6. Expiration

Recommend **one fixed seven-day (168-hour) expiry**, chosen by database at creation. No selector or caller-supplied expiry; changing the default in a later approved migration affects new invites only.

| Option | Assessment |
| --- | --- |
| 24 hours | Short exposure but inconvenient for manually shared links and asynchronous recipients |
| 7 days | Practical manual sharing window with bounded exposure; recommended |
| 14 days | More exposure without demonstrated Phase 1 need |
| 30 days | Too long for initial unbound bearer grants |

At `decision_time >= expires_at`, deny. Client countdowns are informational. Validate after all relevant lock waits, immediately before membership/resolution effects. Successful operations linearize at that check; commit may happen after expiry. A transaction that began before expiry but waited past it must fail. Never promise a commit-time cutoff PostgreSQL cannot enforce with this design.

## 7. Revocation

Any current eligible owner/admin may revoke any active invitation in their community, including another manager's. Inputs are community UUID and exact invite UUID. Recheck both tenant association and current authority before revealing state. Record `revoked_at` and `revoked_by_user_id` once. Revocation is terminal and does not remove someone already admitted.

Repeated authorized revoke returns unchanged revoked state. Accepted/expired invites return their unchanged state with “Already accepted” / “Already expired”; never report that revocation succeeded. No delete, undo, reopening, or expiry extension UI. Recipient sees a generic unavailable invitation page with no private community metadata; manager history retains the exact revoked state.

## 8. Creator authority and account lifecycle

Create/list/revoke derive identity from `auth.uid()` and existing verified, non-anonymous, undeleted, currently unbanned account eligibility. Lock actor, community, and actor membership, then re-read authority. Owner role must agree with `communities.owner_user_id`; admin must be a current member. Moderator/member/unrelated/anonymous/ineligible actors are denied. Caller-supplied role/creator/actor fields are not accepted.

An invitation becomes **community-owned after creation**. Later creator demotion, departure, ban, soft deletion, or nonowner hard deletion does not invalidate it. Current owner/admin can revoke it. This avoids hidden dependence on historical account state and permits predictable grants; removal of a compromised admin does not revoke their old grants automatically, so an owner should review/revoke them. Management remains community-wide, with no creator-filter search feature.

Current owner-account deletion remains blocked by existing ownership constraints; this feature does not change that rule. Creator audit has no FK. Acceptance locks the accepter's live Auth row before all other resources: deletion winning first denies; acceptance winning first can commit then normal nonowner hard deletion cascades membership and the user's requests. Invitation stays consumed with historical accepter UUID and cannot be replayed to recreate membership. Soft deletion/ban prevents future access under existing eligibility rules without rewriting invite audit.

## 9. Existing membership and retry semantics

For a currently active invite, accepting as member/moderator/admin/owner returns **already_member and leaves the invite unused**. Preserve every membership field, including role and timestamps. Spending a scarce bearer link on an existing member is surprising and unnecessary. An existing staff member cannot consume it to obtain member or change their authority.

Invitation validity is checked before already-member success: an invalid/revoked/expired/other-account-used secret never exposes its community, even if the caller belongs to many communities. The same eligible recorded accepter may receive an informational accepted replay result without any mutation. Return a community slug/link only if that account still has current membership; after leaving, return accepted with NULL community metadata. Leaving never makes a consumed invitation reusable; obtain a new link or follow the current ordinary admission policy.

Already-member acceptance may synchronously cancel an anomalous pending own request as already_member, while leaving the invite active. If instant join or approval won a race first, this is the same rule. Acceptance never updates a terminal request or revives a departed membership.

## 10. Community policy interaction and deletion

| Visibility | instant | approval_required | invitation_only |
| --- | --- | --- | --- |
| public | Valid invite admits | Valid invite bypasses request/review | Valid invite admits |
| unlisted | Valid invite admits | Valid invite bypasses request/review | Valid invite admits |
| private | Valid invite admits; ordinary instant still denied | Valid invite admits; unsolicited request still denied | Valid invite admits |

Owners/admins can issue invites in **all nine stored combinations**. Invites authorize deliberate admission independently of unsolicited admission policy, never member content before admission. They do not introduce discovery. Visibility/policy changes preserve existing invitations and members. Public→private, instant→approval_required, approval_required→invitation_only, invitation_only→instant, and other changes do not silently revoke grants. Settings help must say “Existing invitations remain valid until used, revoked, or expired.” Existing settings cancellation of pending requests remains unchanged.

Recheck the community exists under a shared row lock; no archive/suspension column exists to invent a new state gate. Future platform/community restrictions must be integrated under their own approved slice.

Recommend invitation FK **ON DELETE CASCADE**: a successfully deleted community has no surviving capability or invitation history. Existing NO ACTION membership/request FKs mean deleting a community currently requires an explicitly reviewed administrative cleanup/closure transaction; adding invitation cascade does not make community deletion possible through an app endpoint. Do not change those FKs or build closure now. A rolled-back/restricted deletion leaves community/invites unchanged.

## 11. Approval-request interaction

On valid acceptance, lock the accepter's pending request (if any) in the matched tenant before the invitation. After proving validity, insert member if absent; synchronously resolve any still-pending request as `cancelled`, `cancellation_reason=already_member`, `resolved_by_user_id=NULL`, and a database resolution time at least creation time. History/shared-name snapshot remains; request is immediately absent from the pending queue and cannot be approved later. No new request status/reason, lifecycle guard replacement, or change to reviewed request RPCs.

Cancellation and invite consumption/membership insertion share one transaction. Unexpected request update, invite update, or membership insertion failure rolls back all effects. Invalid/stale invite has no cancellation effect. Multiple anomalous pending rows cannot exist under the existing partial unique constraint.

If concurrent approval wins, request stays approved, membership exists, and invitation stays active with already_member. If invitation wins, request is cancelled/already_member and later review returns its existing terminal result. If rejection/withdrawal wins first, invitation can still admit and leaves that terminal request unchanged. Policy-driven cancellation similarly remains policy_changed; invitation does not rewrite it.

## 12. Concurrency and lock protocol

Supported isolation is READ COMMITTED. Preserve the existing prefix, adding invitation last:

**sorted relevant Auth accounts → community → sorted relevant memberships → own pending request → invitation**.

No community lock upgrade, no invitation lock followed by request/account locks, no creator Auth lock during acceptance, and no network call while holding database locks. Sorted multi-account operations use UUID order, matching request review. Membership fixtures/future demotion tools must follow this protocol; arbitrary administrator SQL is outside the supported caller boundary. See [PostgreSQL row locking and deadlocks](https://www.postgresql.org/docs/17/explicit-locking.html).

Acceptance algorithm:

1. Validate raw token, compute digest, and perform an **unlocked routing lookup** for immutable invite UUID/community. This hint grants no authority, returns no data, and takes no row lock.
2. Lock only accepter Auth row FOR UPDATE; re-read live eligibility in a separate statement. No valid live row means deny, even with a stale valid JWT.
3. Lock hinted community FOR SHARE and re-read existence/current fields. Settings/deletion cannot pass until commit.
4. Lock existing accepter membership FOR SHARE and re-read; absent rows cannot be locked, so the Auth lock serializes supported admissions/leave/role changes for that user.
5. Lock this user's pending request in that tenant FOR UPDATE, if present; do not change it yet.
6. Lock exact invitation FOR UPDATE; separately re-read/recheck ID, community, digest, resolution, and fresh database expiry after waiting. No routing-hint trust.
7. Handle same-accepter terminal replay or generic unavailable. For active existing member, cancel pending request only and return already_member without consuming.
8. For active nonmember, sample fresh decision time immediately before effects, insert literal member with ON CONFLICT DO NOTHING. Conflict is defense in depth: preserve role, use already_member/no consumption, reconcile pending request. Unexpected invalid writes abort.
9. Resolve pending request if present and resolve invitation with the same authorized actor/time; return accepted plus database slug. All effects commit together.

Creation/revocation/list lock actor FOR UPDATE → community FOR SHARE → actor membership FOR SHARE, then re-read current role/owner agreement. Creation inserts only after that check. Revocation locks exact tenant invitation FOR UPDATE last and samples fresh expiry. List uses an authorized snapshot and bounded rows without locking every invitation. Preview uses a limited snapshot; signed-in preview checks eligibility and own membership, but it is never acceptance authority. No read creates membership or consumes a token.

| Race | Required result |
| --- | --- |
| Two different accounts accept same invite | Invite row serializes; exactly one new membership/consumption, loser unavailable, loser pending request unchanged |
| Same account accepts twice | Auth row serializes; second is informational accepted, no extra writes |
| Same account accepts different invites | First admits; second returns already_member and remains active |
| Accept vs revoke | Invite row winner decides: accepted means revoke cannot undo; revoked means accept cannot admit |
| Waiting acceptance vs expiry | Recheck after waits; at/after expiry deny with no effects |
| Accept vs successful community deletion | Shared community lock serializes; admission-first then authorized deletion removes resources, deletion-first leaves unavailable; restricted deletion rolls back |
| Accept vs instant join | Actor Auth lock serializes; instant-first → invite unused; invite-first → instant join preserves member |
| Accept vs request approval | Approval locks sorted reviewer/requester accounts before community/request; invitation locks requester before request/invite; outcomes in section 11 |
| Accept vs leave / own role change | Relevant actor Auth lock serializes; preserve current existing role or create member only when absent |
| Two admins revoke | Invite row serializes; first audit preserved; second returns revoked |
| Creator authority changes vs create/revoke | Auth/membership locks serialize; authority lost first denies; authorized mutation first commits community-owned grant |
| Creator deletion vs recipient acceptance | No creator FK/lock; recipient acceptance independent, subject to community still existing |
| Accepter hard/soft deletion or eligibility change | Actor Auth lock serializes; deletion/ineligibility first denies; acceptance first followed by deletion never restores access/history |
| Settings cancellation vs acceptance | Exclusive/shared community lock serializes; existing terminal request never rewritten; invite remains valid |

Lock/serialization/timeout failures produce safe refresh guidance, no automatic admission retry. Independent tests must demonstrate blocking with `pg_blocking_pids`, not infer it from Promise ordering. Unrelated accounts/tenants must progress without a shared global lock.

## 13. RLS, privileges, RPCs, and application boundary

Invitation table ENABLE/FORCE RLS, revoke all PUBLIC/anon/authenticated table **and column** privileges, no direct read/write policies. No ordinary table mutation, SELECT of hashes, update/upsert, DELETE, TRUNCATE, or realtime subscription. Do not publish invitations to Realtime or add storage resources.

Five narrow client-callable RPCs are sufficient:

| RPC | Inputs | Access / output |
| --- | --- | --- |
| `create_community_invitation` | `p_community_id uuid`, `p_token_hash text` (64 lowercase hex) | authenticated current owner/admin; invitation ID, created_at, expires_at only |
| `revoke_community_invitation` | community UUID, exact invitation UUID | authenticated current owner/admin; ID, derived status, relevant timestamps/outcome |
| `list_community_invitations` | community UUID, paired before timestamp/UUID, limit | authenticated current owner/admin; ID, created/expiry/accepted/revoked times, derived status |
| `get_community_invitation_preview` | raw token only | anon/authenticated; limited active preview or generic unavailable; authenticated own replay exception below |
| `accept_community_invitation` | raw token only | authenticated eligible actor; accepted/already_member/unavailable, allowed community slug or NULL |

List is newest first, all states, default 20, maximum 50, tuple cursor `(created_at,id)` preserving microseconds. This gives active/recent management without filters, count queries, or token recovery. No UUIDs of creator/accepter/revoker in manager projections. Creation does not return the digest; application combines its retained raw secret with the safe returned receipt.

Preview returns one validated projection: `outcome` (`active`, `accepted`, `unavailable`), nullable `community_name`, `community_description`, `expires_at`, `already_member`, and `community_slug`. Active preview includes only name/description/expiry/own-membership boolean; slug is NULL. Accepted replay has community fields/slug only for the current eligible recorded accepter who still belongs; a departed accepter gets accepted with all community fields NULL. Unavailable has every other field NULL. Acceptance returns only `outcome` (`accepted`, `already_member`, `unavailable`) and nullable `community_slug`; active already-member or newly accepted results include the authorized slug, departed accepter replay does not. Before that result, the already-member preview offers an explicit Continue action rather than inferring a slug or fetching another tenant's metadata. No preview returns an invite/tenant/account UUID or hash.

Acceptance/preview take no invitation ID, tenant, role, user, email, or destination. Revoke ID is a locator and must match tenant after authorization. Fixed service RPC names, strict arguments and result validation, no overloaded generic management function. SQL authorization/malformed-input errors follow existing 42501/22023 conventions; valid-shaped invalid secrets return a uniform business unavailable projection. Do not include raw SQL/provider messages or supplied values in diagnostics.

SECURITY DEFINER is justified for authenticated operations on the otherwise inaccessible invitation/request/membership/Auth tables and the anonymous secret-gated preview. Match existing reviewed public RPC conventions: empty search_path, schema-qualified objects/crypto, no dynamic SQL, explicit auth/current authority checks, revoke default EXECUTE before narrowly granting authenticated or preview anon/authenticated. Restrict any internal helper/guard function from PUBLIC/anon/authenticated; create grants within one reviewed transaction. FORCE RLS does not constrain a BYPASSRLS owner; explicit definer authorization/projection checks are mandatory, not optional. [Supabase function security and execution privileges](https://supabase.com/docs/guides/database/functions) support these controls.

Server-only feature service uses ordinary cookie-bound Supabase client plus `getVerifiedUser` for authenticated operations. It generates tokens with built-in Node crypto, validates forms and RPC projections, and logs bounded operation/error codes through `reportError`. Thin Server Actions invoke services, with framework redirects outside error-catching. No service-role application key, Edge Function, worker, ORM, package, or new external service.

After mutations revalidate `/communities`, `/c/[slug]`, `/c/[slug]/requests`, `/communities/requests`, `/c/[slug]/invitations`, and `/invite/[token]` as route **patterns**, not logged token-bearing concrete paths. Settings/join/leave/request actions should invalidate invitation route patterns when their results affect current recipient/member presentation. Pages remain dynamic/private, and stale tabs reconcile on next request/manual refresh. No shared cache/realtime/optimistic admission.

## 14. Preview privacy and token exposure

Active secret possession authorizes **only community name, short description, invite expiry, and the eligible viewer's own already-member boolean**. No slug/community UUID before admission, owner/creator identity, profile, email, roster, counts, content, policy, or audit actors. This limited preview may be shown signed out, including for private communities. It is an explicit exception to private nonmember slug landing, not a public discovery function. Do not broaden `get_community_landing`.

Invalid/malformed/expired/revoked/accepted-by-other tokens produce the same generic “This invitation is unavailable. It may be invalid, expired, revoked, or already used. Ask the community owner or an admin for a new link.” No community metadata, echo of input, exact resolution reason/time, or redirect to a community. Use consistent page/projection shape for these states; transport authentication failures are handled separately. Exact expired/revoked/accepted badges are for authorized managers. Recipient-specific distinctions would unnecessarily turn stale secrets into a metadata oracle.

Exception: currently eligible authenticated recorded accepter may see “Invitation already accepted.” A community link is shown only if currently a member; a departed accepter sees no private community metadata. Active existing members see “You are already a member; this invitation remains unused” with an ordinary current-member link where authorized. Account ineligibility fails closed; do not reveal account ban/deletion details.

Path vs query: both are bearer URLs and can leak through history, access logs, referrers, screenshots, and copy/paste. A query parameter is not materially safer without logging redaction; path fits relative routes and avoids forwarding `next` secrets. A fragment would avoid HTTP URL logs but require a different client bootstrap/verification route and return-flow design. Prefer the requested path with tested protections; reconsider fragment only if mandatory provider logging cannot be controlled. No preview endpoint puts the token in a Supabase URL/query; use POST RPC bodies.

Required implementation controls:

- `/invite/:path*` and manager routes: private/no-store, no-referrer, noindex/nofollow/nosnippet, frame denial and nosniff. Generic document title; no secret or private metadata in Open Graph, sitemap, structured data, static params, assets, or shared caches. Extend existing proxy matching to invitation and community admission/manager routes so cookie refresh reaches renderer/browser; retain existing cookie behavior.
- Do not prefetch token-bearing links or add analytics/error replay/session capture on these routes. No third-party assets/embeds; never place secrets in logs, diagnostic URLs, error messages, database NOTICE/DETAIL, or action names. An intentional POST accepts; GET/HEAD/prefetch/scanners never mutate.
- In `next.config.ts`, suppress invite incoming-request development logs and Server Function argument logs (installed Next 16.3.6 types support `incomingRequests` and `serverFunctions`). Simplest option is disable these development logs; explicit safe operation/code diagnostics remain. Inspect dev stdout/stderr and production-start output with synthetic sentinel secrets. [Next logging controls](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging) are development controls, not production access-log protection.
- Protect request bodies, Cookie/Set-Cookie and SQL bind parameters from application/PostgREST/Postgres diagnostic logging. Use fixed messages and parameterized RPCs; never execute secret-bearing SQL literals through management tools. Check hosted logs/settings with synthetic fixtures under later validation authorization; do not assume provider logs are harmless. No new paid logging service. If managed logging demonstrably persists secret parameters and cannot be suppressed, stop and revise verification transport before release rather than claiming compliance.
- Raw creation link only in transient action/component memory until dismiss/navigation/reload; no localStorage, sessionStorage, IndexedDB, persisted reducers, server cache, or database recovery. Auth return uses the short-lived HttpOnly cookie described below, the sole deliberate temporary transport exception. Browser URL/history and clipboard inherently retain user-visible copies; no absolute erasure guarantee.
- After successful acceptance navigate to the authorized relative community route, removing the secret from the current address. Back/history may still contain it, but consumption prevents new admissions. Logging/screenshot/HAR validation evidence must redact sentinel secrets before retention.

## 15. Authentication return flow

Keep existing email/password and verified-account rules. No invitation email, SMTP change, OAuth, verification bypass, production host, or domain purchase.

Recommend a narrow **invitation-return cookie**, avoiding raw secrets in `/sign-in?next=...` or Auth callback URLs:

1. Signed-out invite preview offers explicit “Sign in to accept” and “Create account to accept” forms. A same-origin Server Action validates the exact raw-token field and a fixed destination enum, sets a host-only HttpOnly SameSite=Lax invitation-return cookie for 60 minutes (Path `/`, no Domain), and redirects to fixed `/sign-in` or `/sign-up`. No arbitrary next URL. Starting a newer invitation flow replaces the older cookie; document last-started-flow wins across tabs.
2. Cookie contains only the canonical 64-character secret, used as untrusted routing input, never membership authority. Mark Secure on HTTPS; allow non-Secure only for loopback HTTP development, including local production-build testing. Production HTTPS keeps Secure. Do not alter existing Supabase session-cookie policy in this slice.
3. Existing sign-up, resend, confirmation and verification remain unchanged. In the same browser, the temporary cookie survives these fixed routes. Confirmation still ends its temporary session and returns to sign-in. Do not embed the invite in provider emailRedirectTo, email templates, token_hash, or supplied identity fields.
4. After successful authoritative sign-in, read and delete the return cookie, validate again, and redirect only to `/invite/<canonical-token>`; invalid/missing cookie falls back to existing `/account`. Never auto-accept after login. Expired/revoked invite on return renders generic unavailable.
5. Failed sign-in retains cookie within its original expiry; logout clears it. Session expiry during Accept can use the same explicit return action or set the validated return cookie before a fixed sign-in redirect. Read-only RSC does not write cookies. Limit cookie setters to intended invitation flow; no GET mutation.
6. Verification opened in another browser/device, cookie expiry, or different origin cannot preserve local cookie context. Finish existing Auth, then reopen the original invite link. Do not invent a cross-device email relay or store tokens in profiles to automate this.

The invitation cookie is a bounded, intentional credential transport, with no persistent client-readable storage. Tampering can only change which valid secret the holder later previews; it never overrides DB authentication or accepts an external redirect. Validate cookie size/alphabet and deny all absolute URLs, encoded separators, control characters, double decoding, and protocol-relative targets. Clear it on successful return/logout. Existing same-origin action protections apply.

Hosted signup confirmation depends on the development project's existing working Auth delivery/recipient restrictions, not on invitation email. Test new accounts through that existing behavior or explicitly authorized disposable verified fixtures; do not claim arbitrary public email signup delivery was validated from database fixtures. General public Auth delivery/recovery readiness remains a separate deferred project concern and cannot block implementation/validation of invite admission for eligible development users.

## 16. Owner/admin UI

Dynamic `/c/<slug>/invitations`, linked from the current owner/admin landing beside request review. Authorize page and RPC independently from current membership; unauthorized/private targets use safe unavailable behavior. Owner-only settings permission is unchanged.

- One Create invitation button; no recipient entry, role selector, expiry selector, search, filters, or batch creation.
- Explain: “Anyone with this link and an eligible verified account can join as a member. One new member can use it. It expires after seven days. Existing invitations stay valid if settings or the creator's role change.”
- Creation shows one-time relative/absolute link, expiry, Copy invite link and Dismiss. Clearly say link cannot be recovered after leaving/reloading. Clipboard failure provides manual copy. Do not offer Copy on historical rows.
- Newest-first paged history (20 rows): short invite identifier, created/expiry timestamps, active/accepted/revoked/expired badge; active rows offer confirmed Revoke. No identity/email data or usage metrics.
- Disable overlapping create/revoke operations; loading text, status/alert with focus, readable dates, no color-only status. Reconcile using fresh read after mutation; expiry timer is cosmetic and must not authorize Revoke/Accept.
- Lost response: refresh history, revoke an uncertain newly created row if necessary, then explicitly create another. Do not silently retry creation or infer acceptance from UI.

## 17. Recipient UI

Dynamic `/invite/<token>` with escaped limited preview, expiry, and explicit acceptance. Signed-out users get fixed sign-in/sign-up actions preserving return cookie. Eligible active nonmembers get Accept invitation; acceptance grants member only. No request-name/email collection and no automatic acceptance on view/login.

Accepted: report success and navigate to DB-returned current-member path. Already member: explain no role change/no invite use, provide member landing navigation. Same-accepter replay: informational used result, current-member link only where permitted. Invalid/expired/revoked/other-account-used: one generic unavailable page. Server/provider read failure: separate “temporarily unavailable; refresh” without assuming invalidity or retaining previously authorized preview.

Refresh after uncertain outcome; no blind retry or optimistic membership. A fresh read can identify same-accepter success, current membership, or unavailable state. Stale invitation/role/session/private-preview pages recheck on each action/read. Token-bearing fields/links never enter analytics. Keyboard operability, focus feedback, wrapping long link text, copy fallback, and narrow layouts are required.

## 18. Comprehensive local validation matrix

Use existing pinned Node 24.21.0/npm 11.19.0 and Node test runner; `npm ci` if installation needed. No new testing dependency. PGlite runs real constraints/RLS with emulated Auth; check pgcrypto/digest support before choosing how to supply crypto in that harness. If its available build lacks pgcrypto, isolate a clearly labelled test-only digest shim for state/grant tests and verify real hashing on independent PostgreSQL 17; never count the shim as cryptographic evidence.

| Area / cases | Required assertions |
| --- | --- |
| Create: owner, admin | Valid hash-only row, seven days, correct tenant/creator, no raw-secret DB column/projection |
| Create: moderator, member, unrelated owner/user, anon | Deny; no row or information about target |
| Eligibility: unverified, anonymous Auth user, banned, soft/hard deleted, stale JWT | Create/list/revoke/accept denied from current database state |
| Token creation | CSPRNG input length, canonical encoding, independent unique samples; duplicate digest fails without modifying another row; test Node/Postgres known vectors |
| Hash leakage | Stored hash cannot be redeemed as raw token; no accept-by-hash endpoint; direct SELECT/hash projections denied |
| Valid acceptance | One member row literal role=member, invite accepted once, actor from auth.uid, allowed slug only after admission |
| Anonymous acceptance | EXECUTE denied; UI offers Auth return; GET never consumes; noneligible authenticated denied |
| Existing member/moderator/admin/owner | Each role/timestamps unchanged; active invite remains unused; deterministic already_member |
| Accepter replay/leave | Same actor informative accepted, no timestamp changes; leave then replay never readmits or reveals private community metadata |
| Other-account replay | Uniform unavailable, no second membership, no private metadata, no request cancellation |
| Expiry | Just before valid, exactly at and after deny; long lock wait crossing boundary deny; no caller override/extension |
| Revocation | Owner/admin revoke each other's invites; moderator/member/etc denied; repeat preserves actor/time; expired/accepted untouched |
| Policies | All nine visibility/policy combinations admit by valid invite; ordinary instant/request rules unchanged |
| Settings changes | Explicit listed transitions plus all visibility changes preserve grants; pending policy_changed history stays terminal |
| Private privacy | Active secret limited preview; invalid/stale same unavailable shape; normal private slug remains unavailable to nonmember |
| Cross tenant | Mixed invite/community UUID revoke/list denied; token A never used to admit community B; another tenant's history/hash never returned |
| Forged fields | user/accepter/creator IDs, roles, invite IDs/tenant on accept, expiry, status, redirect/origin, extra/duplicate/file/null fields rejected |
| Direct API-equivalent access | anon/authenticated table/column SELECT, INSERT, UPDATE, DELETE, UPSERT, TRUNCATE denied; no PUBLIC/internal EXECUTE; FORCE RLS/catalog verified |
| Pending request + invite | Membership/invite/request resolve atomically; cancelled/already_member/NULL reviewer; immutable shared name; old review harmless; history retained |
| Terminal requests | Approved/rejected/withdrawn/cancelled never rewritten by invite; invalid invite has no effects |
| Already-member + anomalous pending | Pending cancelled as already_member, invite unused, membership unchanged |
| Community deletion | Invitation cascade on successful authorized fixture cleanup; currently restricted delete rolls back; other tenants preserved |
| Creator demotion/leave/ban/soft/hard deletion | Existing invites valid; current create/revoke/list permission lost; audit unchanged; owner deletion restriction retained |
| Accepter deletion | Deletion-first denied; acceptance-first then deletion consumes history permanently; no dangling authorization |
| History guard | Immutable IDs/tenant/hash/creator/times; accepted/revoked exclusivity and paired NULL rules; terminal rewrites/reset prohibited |
| Rollback injection | Membership insert, request cancellation, invite resolution errors roll back every effect |
| Pagination | Paired finite cursor, bounds, timestamp precision, stable same-time ordering; no cross-tenant rows; no secret/audit actors |
| Services/actions | Fixed RPC/args, current getUser, safe errors/codes, exact projection validation, revalidation patterns, no automatic retries |
| Auth return | Valid cookie roundtrip, missing/malformed/expired fallback, signup-confirm-signin, same-browser requirement, logout cleanup, no open redirect, no token in provider callback |
| URL origin | localhost/custom port/current browser origin; future configured HTTPS origin, malformed APP_URL, hostile Host/forwarded Host/form origin; no schema host dependence |
| Token privacy | Sentinel absent from database storage, safe diagnostics, Next request/function logs, client storage, referrer, cached output, metadata/static build, retained test artifacts |
| Regression | Existing Auth/profile/session/community/settings/instant/request suites remain passing, including stale eligibility and role preservation |

Independent PostgreSQL sessions must cover both winner orders where applicable: double accept (same/different accounts), two invites/same actor, accept/revoke, two admins revoke, accept/expiry-after-lock-wait, accept/community deletion, accept/instant join, accept/request approve/reject/withdraw, accept/leave/role change, accept/accepter deletion/ban, create or revoke/creator demotion/deletion, accept/settings cancellation. Use barriers plus observed blockers, bounded timeouts, rollback checks, membership uniqueness, request terminality, invite terminality, owner integrity, and unrelated-tenant progress. The existing loopback-only disposable harness is the pattern; do not point it at hosted or working databases.

Run `npm run lint`, `npm run typecheck`, `npm test` with independent sessions enabled, `npm run build`, and `git diff --check`. Record skips/environment limitations honestly. PGlite and static rendering alone are insufficient evidence of concurrent behavior, Auth integration, browser hydration or clipboard support.

## 19. Hosted development validation matrix

Future separate authorization is required for migration and fixture writes. Planning inspection was catalog-only/read-only; it did not rerun the user's 202 prior behavioral checks or inspect Auth user content.

| Gate | Required evidence |
| --- | --- |
| Preflight | Confirm project, checkpoint/schema, existing request lifecycle, extensions, migration tracking, current advisors and no invitation objects; no history repair |
| Catalog/security | Exact columns/hash constraints, immutable guards, indexes/FK deletion, RLS/FORCE, table/column ACLs, RPC signatures/grants/search paths; internal execution denied |
| Crypto/storage | Actual extensions.digest agrees with Node; inspect only synthetic invite rows for hash-only persistence; neither raw secret nor recoverable URL present |
| Real Auth/PostgREST | Ordinary publishable-key sessions for owner/admin/moderator/member/nonmember/unverified/anon; current ban/deletion and stale tokens; no service-role substitute for allow/deny checks |
| Direct REST | Table/column reads and every direct mutation denied; preview raw-token-only limited projection; forged IDs/role/user/tenant/expiry rejected |
| Lifecycle/policy/privacy | All local product outcomes across nine configs, policy changes, private active preview, uniform invalid/expired/revoked/used errors, member-role preservation, same-accepter replay |
| Request integration | Pending cancellation/history/queue disappearance, concurrent approval/instant join, no terminal rewrite; existing request checks preserved |
| Hosted concurrency | Independent ordinary RPC calls with trusted authorized fixture orchestration/lock barriers as available; both double-accept and revoke/expiry/approval/instant/delete/authority race outcomes; report inability to prove blocked state separately |
| Provider logs | Synthetic sentinel token does not persist in accessible application/API/DB error or parameter logs; inspect configuration where visible; record provider visibility limits rather than guarantee invisible logs |
| Types/advisors | Regenerate/compare hosted types against narrow application contract; review new warnings individually; no broad Auth/config/security exceptions |
| Cleanup | Track exact disposable Auth/community/request/invite IDs; preserve existing development data; remove fixtures in ownership/FK-safe order; verify cleanup |

Never issue token-bearing SQL literals through the management connector or retain unredacted HTTP/HAR payloads in evidence. Real raw tokens may be passed in necessary RPC request bodies by a dedicated local validation harness that never prints them. Privileged setup is restricted to explicit disposable fixtures and is not an application dependency.

## 20. Local production-build browser acceptance matrix

Run the production build on localhost against development Supabase after authorized rollout, using existing session cookies and eligible disposable test accounts. Also run development-mode privacy checks because framework logging differs. No Vercel deployment/domain/SMTP setup is needed.

| Journey | Pass condition |
| --- | --- |
| Owner/admin creation | Management visible only to roles; create once; correct expiry; one-time link; no historical Copy after reload |
| Clipboard/manual fallback | Absolute URL matches actual localhost origin/port; clipboard success status; denied clipboard supports keyboard/manual copy |
| Signed-out acceptance | Limited preview, fixed sign-in/sign-up return, explicit accept after verified login; no login-triggered membership |
| Signup continuation | Same-browser existing verification then signin returns to invite; cross-device/expired cookie guidance to reopen link; no SMTP/domain dependency added |
| Every existing role | Member/moderator/admin/owner preserved and invite unused; current-member navigation works |
| Single-use/revoked/expired | Second recipient cannot admit; manager exact statuses; recipient generic unavailable without metadata; no misleading success |
| Private community | Only active secret preview, admission then member landing; direct private slug remains hidden before membership |
| Request integration | Pending request disappears synchronously after invitation admission; own receipt cancelled/already_member; stale reviewer cannot approve it |
| Stale tabs/authorization | Revoke/consume/demote/change policy/delete/ban from another session; next read/action reconciles; no stale role or preview authorizes writes |
| Session expiry | Renderer/browser receive refreshed cookies, expiry redirects preserve invite, stale deleted/banned JWT denied; no automatic retry |
| Ambiguous network result | Clear refresh guidance, no duplicate create/retry; accepted replay vs still-active/already-member outcomes reconciled |
| Accessibility | Practical keyboard navigation, visible focus, descriptive labels, focused status/alert, disabled controls, manual-copy field, status not color-only |
| Narrow/mobile | 320–375px layouts, long URLs/names wrap, readable buttons/status/timestamps, no horizontal page overflow |
| Privacy/network | private/no-store/no-referrer/noindex headers, no token to third-party referrer/request/query/callback/client storage; no prefetch mutation; synthetic token absent from stdout/stderr and diagnostics |
| Regression | Signup/signin/verify/logout, profiles, communities, settings, instant join/leave and request screens retain existing behavior |

Local HTTP with NODE_ENV=production must be tested explicitly: existing Supabase cookies use Secure in production. Do not assume new invitation return cookies work simply because existing session tests passed. The invitation cookie must use the trusted loopback exception described above; report any unrelated Auth-cookie issue rather than silently broadening cookie security.

## 21. Migration and rollout strategy

1. Approve this narrow product/security plan separately from implementing it. Resolve only actual blockers in section 24; do not purchase anything.
2. Future implementation creates **one isolated new `community_invitations` migration** using the installed CLI's discovered `migration new` command; timestamp is assigned then, not invented in this plan. Do not edit/replay any of the five historical migrations. New migration creates invitation table/indexes/guards/RPCs/grants atomically and depends on existing schema plus pgcrypto; no backfill, tracking repair, old function replacement, or Auth setting change.
3. Review schema/functions/security and run complete local suites, real PostgreSQL races, lint/typecheck/build. Validate actual pgcrypto behavior, log controls, and strict return-cookie handling. No hosted writes are implicit in implementation approval.
4. Under a separately explicit targeted rollout authorization, reconfirm development project and prerequisite schema; apply only reviewed new SQL once with a new tracking entry through a targeted migration operation. **Never whole-repository migration push/reset/pull replay or historical version reconciliation.** Existing tracking mismatch is preserved and recorded.
5. Inspect schema/privileges/types/advisors, then separately authorized hosted fixtures/API/race/browser checks. Preserve application compatibility during rollout: DB objects first; UI only after backend readiness. No deployment implied.
6. If rollout fails inside its transaction, rollback leaves baseline unchanged. After a successful migration, prefer reviewed forward fixes or keeping new UI unavailable while investigating; dropping consumed/audited records is not a routine rollback. No production migration/deployment, commit/push, or infrastructure purchase without later explicit scope.

## 22. Expected implementation files

Paths below are the scoped expected file manifest, not permission to create them now. One CLI-assigned migration basename is the only unavoidable filename placeholder.

| Change | Exact path(s) | Purpose |
| --- | --- | --- |
| Add | `supabase/migrations/<CLI-assigned-timestamp>_community_invitations.sql` | One isolated schema/RPC/privilege transaction |
| Add | `src/lib/communities/invitation-validation.ts` | Canonical tokens/forms/result/cursor types |
| Add | `src/lib/communities/invitations.ts` | Server-only crypto, user-scoped RPC services/projection checks |
| Add | `src/lib/communities/invitation-presentation.ts` | Status/receipt/cursor display helpers |
| Add | `src/app/communities/invitation-actions.ts` | Create/revoke/accept and fixed Auth-return actions |
| Add | `src/app/c/[slug]/invitations/page.tsx` | Authorized dynamic manager page |
| Add | `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/error.tsx` | Limited preview/accept and safe unavailable/error UI |
| Add | `src/components/community-invitations.tsx`, `src/components/community-invitation-accept.tsx` | One-time copy/history/revoke and recipient controls |
| Add | `src/lib/auth/invitation-return.ts` | Server-only bounded host-only cookie handling; no generic redirect framework |
| Modify | `src/lib/supabase/database.types.ts` | Exact new schema/client-callable RPC contract |
| Modify | `src/app/c/[slug]/page.tsx` | Owner/admin invitation management link, accurate invitation-only text |
| Modify | `src/components/community-form.tsx`, `src/components/community-settings-form.tsx` | Limited-preview and preserved-grant help |
| Modify | `src/app/auth/actions.ts` | Validated invite return after signin, clear on logout; provider confirmation behavior preserved |
| Modify | `src/app/communities/actions.ts`, `src/app/communities/request-actions.ts` | Pattern revalidation for new views only |
| Modify | `src/proxy.ts`, `next.config.ts` | Session/header coverage and token-safe development logging |
| Add | `tests/community-invitations.test.mts` | Services, token vectors, projection validation |
| Add | `tests/community-invitations-rls.test.mts` | Database schema/allow-deny/lifecycle/tenancy |
| Add | `tests/community-invitations-concurrency.test.mts` | Independent disposable PostgreSQL sessions |
| Add | `tests/community-invitation-actions.test.mts`, `tests/community-invitation-ui.test.mts` | Action/page/component/copy/status behavior |
| Add | `tests/invitation-return.test.mts` | Cookie lifecycle and strict redirect validation |
| Modify as needed | `tests/community-rls.test.mts`, `tests/community-requests-rls.test.mts`, `tests/community-requests-concurrency.test.mts` | Explicit migration loading where hardcoded; preserve regression fixture compatibility |
| Modify | `tests/auth.test.mts`, `tests/session.test.mts`, `tests/community-request-actions.test.mts`, `tests/community-request-ui.test.mts` | Return/session coverage and updated invalidation/help expectations |
| Modify | `README.md`, `docs/PRODUCT.md`, `docs/PHASE_1_DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/COMMUNITY_FOUNDATION.md`, `docs/COMMUNITY_MEMBERSHIP_REQUESTS.md`, `docs/DATA_MODEL.md`, `docs/AUTH_SETUP.md`, `docs/ROADMAP.md`, `docs/COMMUNITY_INVITATIONS.md` | Correct completed checkpoint and approved invitation contract, token handling, auth/local rollout guidance |

No expected package/lockfile changes, paid dependencies, environment secret additions, email templates, OAuth, storage, Stripe, infrastructure manifests, or service integrations. Existing sign-up/confirm pages and AuthForm need no token/next prop because cookie carries the narrow return context. A reproducible hosted fixture harness may warrant a later separately scoped local script; its exact authorization and file are not assumed here.

## 23. Security invariants

1. A raw generated secret is never durably stored by the database and a stored hash is not accepted as a bearer credential.
2. Only current eligible owner/admin creates/revokes/lists, from current DB membership; historical creator authority does not authorize present actions.
3. Recipient identity is auth.uid; tenant comes from the matched hash; no supplied role/user/community chooses an acceptance target.
4. A valid active invitation permits at most one new admission and only literal member; existing memberships are never downgraded, elevated, or rewritten.
5. Membership, invite resolution, and pending-request cancellation are atomic; unsuccessful/invalid acceptance has no side effects.
6. Accepted/revoked records are immutable and replay cannot re-enroll someone after leave/deletion.
7. Expiry is checked with fresh database time after lock waits, with equality denied; no client clock or transaction-start cutoff.
8. Visibility/policy changes do not widen public preview or revoke invitation grants implicitly; ordinary unsolicited admission remains unchanged.
9. Private metadata is available only through active-secret limited preview or current-membership authorization; stale/invalid secrets reveal no community.
10. Direct client table/column access and internal function execution are denied; every definer boundary explicitly authenticates/authorizes its allowed surface.
11. Auth→community→membership→request→invitation order is preserved; no invite-first lock or community upgrade.
12. Raw tokens do not enter logs/analytics/error messages/referrers/shared caches/persistent client storage; temporary HttpOnly return transport is narrowly bounded.
13. URLs and origin configuration are application concerns, absent from schema semantics. Trusted relative redirects never use arbitrary Host-derived targets.
14. Auth/account/community state is rechecked for each mutation; preview and hidden controls are not authorization.

## 24. Open decisions and validation limits

The product owner accepted all narrow decisions for Pass 1: single use, exactly 168 elapsed hours, owner/admin authority, community ownership, all nine combinations, no consumption for existing members, pending-request already_member cancellation, derived status, historical UUIDs without Auth FKs, invitation cascade on successful cleanup, limited active-secret preview, generic unavailable states and narrow Auth-return cookie. The implementation record above distinguishes completed local work from later gates.

No missing current schema decision blocks beginning the separate implementation. Three implementation/validation findings must not be invented in advance:

- Whether the installed PGlite distribution can run real pgcrypto; use independent PostgreSQL as the cryptographic authority if not.
- Whether accessible managed API/Postgres logs retain raw RPC parameters on success/errors. The application can enforce its own redaction; provider parameter persistence must be verified with synthetic secrets before declaring the slice complete. If unavoidable, revise transport instead of weakening hash-leak security or claiming “never logged.”
- Whether the existing development Auth delivery supports the intended disposable signup confirmation recipients. Existing limitations require honest fixture/evidence boundaries, not custom SMTP, disabling verification, or a purchased domain.

Community closure/account erasure and long-term audit/backup retention remain later approved project policies. This plan preserves present NO ACTION/ownership restrictions and defines invitations' own deletion behavior without creating those workflows. Public launch abuse controls and arbitrary-recipient Auth delivery/recovery readiness remain separate gates.

## 25. Readiness, cost, and domain timing

**Local Pass 1 + Pass 2 are ready for final integrated review before commit/push.** The reported independent Pass 1 review and corrective validation precede the locally validated UI described above. Hosted rollout/validation and public release remain later authorized work; planning matrices do not claim hosted completion.

**Can the entire Phase 1 invitation admission slice be developed and validated with localhost + existing development Supabase and no purchased domain? Yes.** Localhost supplies route/copy/production-build browser behavior; disposable local PostgreSQL supplies deterministic races; existing eligible development Auth sessions supply real PostgREST acceptance. Signup continuation uses the existing development verification flow or transparently identified authorized fixtures, not newly purchased email infrastructure.

**Paid infrastructure required: NONE.** No domain, DNS, SMTP, email invitation delivery, paid email/logging service, Vercel deployment, production hostname, Edge Function, managed branch, new hosted project, or other purchase is part of this design. Use existing development resources within their available allowances; the feature introduces no paid provisioning requirement.

**Nothing in invitation implementation or development validation waits for the final production domain.** Only eventual public reachability and production Auth/hostname configuration wait for wider launch readiness. At that point update configured origin and exact Auth allowlists, plus hosting configuration; no invitation data-model redesign. Production-wide email/recovery/operations remain their own readiness work, not dependencies of this invitation slice.

Technical references checked during planning: [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html), [PostgreSQL 17 pgcrypto](https://www.postgresql.org/docs/17/pgcrypto.html), [Next data security](https://nextjs.org/docs/app/guides/data-security), and [Supabase's relevant PostgreSQL minor-release notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). The latter concerns legacy pgcrypto PGP ciphers, not this proposed SHA-256 digest use; no database upgrade or repair was performed or authorized.
